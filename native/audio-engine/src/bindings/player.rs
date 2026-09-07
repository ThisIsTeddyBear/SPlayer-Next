use std::sync::Arc;
use std::thread::JoinHandle;

use ffmpeg_audio::HttpCancelHandle;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use parking_lot::Mutex;
use tracing::{info, warn};

use crate::player::{self, InnerPlayer, PlayerEvent, PlayerState, SeekTake};
use crate::{audio_output, decoder, device_watcher};

use super::IntoNapiResult;

enum SeekOutcome {
    Resumed {
        shared: Arc<crate::shared::Shared>,
        handle: JoinHandle<crate::decoder::DecoderData>,
    },
    Fallback,
}

enum ReinitOutcome {
    Resumed {
        shared: Arc<crate::shared::Shared>,
        handle: JoinHandle<crate::decoder::DecoderData>,
        output: Box<audio_output::AudioOutput>,
    },
    Reload {
        source: Option<String>,
        was_playing: bool,
    },
    OutputFailed { error: anyhow::Error },
}

const LOAD_SUPERSEDED_REASON: &str = "[Cancelled] load was superseded by a newer load";

fn is_cancelled_napi_error(error: &Error) -> bool {
    error.reason.starts_with("[Cancelled]")
}

fn is_device_napi_error(error: &Error) -> bool {
    error.reason.starts_with("[Device]")
}

#[napi(object)]
pub struct JsExternalLyric {
    pub format: String,
    pub path: String,
}

#[napi(object)]
pub struct JsMusicMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub comment: Option<String>,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub original_sample_rate: u32,
    pub bits_per_sample: u32,
    pub bit_rate: i64,
    pub codec: String,
    pub embedded_lyric: Option<String>,
    pub external_lyrics: Vec<JsExternalLyric>,
    pub cover: Option<String>,
}

#[napi(object)]
pub struct JsAudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[napi(object)]
pub struct JsFftData {
    pub ldata: Vec<f64>,
    pub rdata: Vec<f64>,
}

#[napi(object)]
#[derive(Default)]
pub struct JsPlayerEvent {
    #[napi(js_name = "type")]
    pub event_type: String,
    pub state: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub fft_data: Option<JsFftData>,
}

#[napi(object)]
pub struct JsPlayerStatus {
    pub state: String,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub is_finished: bool,
}

fn state_to_str(state: PlayerState) -> &'static str {
    match state {
        PlayerState::Idle => "idle",
        PlayerState::Playing => "playing",
        PlayerState::Paused => "paused",
        PlayerState::Stopped => "stopped",
    }
}

#[napi]
pub struct AudioPlayer {
    inner: Arc<Mutex<InnerPlayer>>,
    device_watcher: Mutex<Option<device_watcher::DeviceWatcher>>,
}

#[napi]
impl AudioPlayer {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let inner = InnerPlayer::new().into_napi()?;
        info!("AudioPlayer instance created");
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
            device_watcher: Mutex::new(None),
        })
    }

    ///
    #[napi]
    pub async fn reinit_output(&self) -> Result<()> {
        info!("Reinitializing the audio output device");

        let (
            seek_take_opt,
            fallback_source,
            position,
            was_playing_fallback,
            output_generation,
            on_failure,
            device_id,
            exclusive_audio,
        ) = {
            let mut player = self.inner.lock();
            let position = player.position();
            let is_playing = player.state() == PlayerState::Playing;
            let device_id = player.selected_device().map(String::from);
            let exclusive_audio = player.exclusive_audio();
            let output_generation = player.reserve_output_generation();
            let on_failure = player.make_failure_callback(output_generation);
            let seek_take = player.take_for_async_seek();
            let fallback_source = player.current_source().map(String::from);
            (
                seek_take,
                fallback_source,
                position,
                is_playing,
                output_generation,
                on_failure,
                device_id,
                exclusive_audio,
            )
        };

        if let Some(take) = seek_take_opt {
            let SeekTake {
                old_threads,
                normalization_enabled,
                normalization_gain,
                current_source,
                was_playing,
                original_sample_rate,
                original_channels,
                original_bits_per_sample,
                output_sample_rate: _,
                output_channels: _,
                token,
                equalizer,
                tempo,
            } = take;

            let outcome: ReinitOutcome = tokio::task::spawn_blocking(move || {
                let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());

                let output = match audio_output::AudioOutput::new(
                    device_id.as_deref(),
                    Some(original_sample_rate),
                    Some(original_channels),
                    Some(original_bits_per_sample),
                    exclusive_audio,
                    output_generation,
                    on_failure,
                ) {
                    Ok(output) => output,
                    Err(error) => return ReinitOutcome::OutputFailed { error },
                };
                let Some(mut decoder_data) = decoder_data else {
                    return ReinitOutcome::Reload {
                        source: current_source,
                        was_playing,
                    };
                };
                if !decoder_data.seek(position) {
                    return ReinitOutcome::Reload {
                        source: current_source,
                        was_playing,
                    };
                }
                if let Err(error) =
                    decoder_data.reconfigure_player_output(output.sample_rate(), output.channels())
                {
                    warn!(error = %error, "Failed to rebuild the resampler after an output format change");
                    return ReinitOutcome::Reload {
                        source: current_source,
                        was_playing,
                    };
                }

                let shared = crate::shared::Shared::new(output.sample_rate(), output.channels());
                shared.set_normalization_enabled(normalization_enabled);
                shared.set_normalization_gain(normalization_gain);
                equalizer
                    .lock()
                    .set_output_format(output.sample_rate(), output.channels());
                equalizer.lock().reset_state();
                tempo
                    .lock()
                    .set_output_format(output.sample_rate(), output.channels());
                tempo.lock().reset();
                let handle = match crate::decoder::resume_decode(
                    decoder_data,
                    std::sync::Arc::clone(&shared),
                    equalizer,
                    tempo,
                ) {
                    Ok(handle) => handle,
                    Err(error) => {
                        warn!(error = %error, "Failed to start the decoder thread after rebuilding output");
                        return ReinitOutcome::Reload {
                            source: current_source,
                            was_playing,
                        };
                    }
                };

                ReinitOutcome::Resumed {
                    shared,
                    handle,
                    output: Box::new(output),
                }
            })
            .await
            .map_err(|e| Error::from_reason(format!("reinit task join error: {e}")))?;

            match outcome {
                ReinitOutcome::Resumed {
                    shared,
                    handle,
                    output,
                } => {
                    let mut player = self.inner.lock();
                    let committed = player
                        .commit_seeked(token, position, shared, handle, Some(*output))
                        .into_napi()?;
                    if !committed {
                        info!("Reinitialization was superseded by a newer load, seek, or stop; discarding result");
                    }
                    return Ok(());
                }
                ReinitOutcome::Reload {
                    source,
                    was_playing,
                } => {
                    if !self.inner.lock().is_load_token_current(token) {
                        return Ok(());
                    }
                    if let Some(src) = source {
                        let is_remote = src.starts_with("http://") || src.starts_with("https://");
                        if let Err(e) = self.load(src, Some(was_playing)).await {
                            if is_cancelled_napi_error(&e) {
                                return Ok(());
                            }
                            if is_remote && !is_device_napi_error(&e) {
                                self.inner.lock().emit_source_error();
                                return Ok(());
                            }
                            return Err(e);
                        }
                        if position > 0.0 {
                            let _ = self.seek(position).await;
                        }
                    }
                    return Ok(());
                }
                ReinitOutcome::OutputFailed { error } => {
                    let mut player = self.inner.lock();
                    if !player.is_load_token_current(token) {
                        return Ok(());
                    }
                    player.enter_paused_for_recovery();
                    warn!(error = %error, "Failed to rebuild output; player is entering the paused state");
                    return Err(error).into_napi();
                }
            }
        }

        if let Some(src) = fallback_source {
            let is_remote = src.starts_with("http://") || src.starts_with("https://");
            if let Err(e) = self.load(src, Some(was_playing_fallback)).await {
                if is_cancelled_napi_error(&e) {
                    return Ok(());
                }
                if is_remote && !is_device_napi_error(&e) {
                    self.inner.lock().emit_source_error();
                    return Ok(());
                }
                return Err(e);
            }
            if position > 0.0 {
                let _ = self.seek(position).await;
            }
            return Ok(());
        }

        Ok(())
    }

    #[napi]
    pub fn set_cover_cache_dir(&self, dir: String) {
        self.inner.lock().set_cover_cache_dir(dir);
    }

    #[napi(ts_args_type = "callback: (event: JsPlayerEvent) => void")]
    pub fn on_event(&self, callback: Function<JsPlayerEvent, ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function().build()?;

        let emitter: player::EventEmitter = Arc::new(move |event: PlayerEvent| {
            let js_event = match event {
                PlayerEvent::StateChanged { state } => JsPlayerEvent {
                    event_type: "stateChanged".into(),
                    state: Some(state_to_str(state).into()),
                    ..Default::default()
                },
                PlayerEvent::Ended => JsPlayerEvent {
                    event_type: "ended".into(),
                    ..Default::default()
                },
                PlayerEvent::SourceError => JsPlayerEvent {
                    event_type: "sourceError".into(),
                    ..Default::default()
                },
                PlayerEvent::Position { position, duration } => JsPlayerEvent {
                    event_type: "position".into(),
                    position: Some(position),
                    duration: Some(duration),
                    ..Default::default()
                },
                PlayerEvent::FftData { ldata, rdata } => JsPlayerEvent {
                    event_type: "fftData".into(),
                    fft_data: Some(JsFftData {
                        ldata: ldata.into_iter().map(|v| v as f64).collect(),
                        rdata: rdata.into_iter().map(|v| v as f64).collect(),
                    }),
                    ..Default::default()
                },
                PlayerEvent::OutputStalled => JsPlayerEvent {
                    event_type: "outputStalled".into(),
                    ..Default::default()
                },
                PlayerEvent::OutputFailed => JsPlayerEvent {
                    event_type: "outputFailed".into(),
                    ..Default::default()
                },
            };
            tsfn.call(js_event, ThreadsafeFunctionCallMode::NonBlocking);
        });

        self.inner.lock().set_event_callback(emitter);
        Ok(())
    }

    #[napi]
    pub fn supports_device_watcher(&self) -> bool {
        device_watcher::is_supported()
    }

    #[napi(ts_args_type = "callback: (defaultChanged: boolean) => void")]
    pub fn on_device_change(&self, callback: Function<bool, ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function().build()?;
        let watcher = device_watcher::DeviceWatcher::new(Box::new(move |default_changed| {
            tsfn.call(default_changed, ThreadsafeFunctionCallMode::NonBlocking);
        }))
        .into_napi()?;
        info!("Native audio device watcher started");
        Ok(())
    }

    #[napi]
    pub fn stop_device_watcher(&self) {
        if let Some(mut watcher) = self.device_watcher.lock().take() {
            watcher.stop();
            info!("Native audio device watcher stopped");
        }
    }

    ///
    #[napi]
    pub async fn load(
        &self,
        source: String,
        #[napi(ts_arg_type = "boolean")] auto_play: Option<bool>,
    ) -> Result<JsMusicMetadata> {
        use crate::shared::Shared;

        let auto_play = auto_play.unwrap_or(true);
        info!(source = %source, auto_play, "Loading audio source");

        let handle = HttpCancelHandle::new();
        let (
            old_threads,
            token,
            load_token,
            cover_dir,
            normalization_enabled,
            device_id,
            output_generation,
            failure_callback,
            exclusive_audio,
            equalizer,
            tempo,
        ) = {
            let mut player = self.inner.lock();
            let (old_threads, token) = player.take_for_async_load(handle.clone());
            let output_generation = player.reserve_output_generation();
            let failure_callback = player.make_failure_callback(output_generation);
            (
                old_threads,
                token,
                player.load_token_handle(),
                player.cover_cache_dir().map(String::from),
                player.is_normalization_enabled(),
                player.selected_device().map(String::from),
                output_generation,
                failure_callback,
                player.exclusive_audio(),
                player.equalizer_handle(),
                player.tempo_handle(),
            )
        };

        let source_for_decoder = source.clone();

        let result = tokio::task::spawn_blocking(move || {
            if let Some(h) = old_threads.join_aux() {
                let _ = h.join();
            }
            let prepared =
                decoder::prepare_decode(&source_for_decoder, cover_dir.as_deref(), handle)?;
            if load_token.load(std::sync::atomic::Ordering::Acquire) != token {
                anyhow::bail!(LOAD_SUPERSEDED_REASON);
            }
            let output = audio_output::AudioOutput::new(
                device_id.as_deref(),
                Some(prepared.original_sample_rate()),
                Some(prepared.original_channels()),
                Some(prepared.bits_per_sample()),
                exclusive_audio,
                output_generation,
                failure_callback,
            )?;
            let shared = Shared::new(output.sample_rate(), output.channels());
            shared.set_normalization_enabled(normalization_enabled);
            equalizer
                .lock()
                .set_output_format(output.sample_rate(), output.channels());
            equalizer.lock().reset_state();
            tempo
                .lock()
                .set_output_format(output.sample_rate(), output.channels());
            tempo.lock().reset();
            let (metadata, decode_handle, cancel) =
                decoder::start_prepared_decode(prepared, Arc::clone(&shared), equalizer, tempo)?;
            Ok::<_, anyhow::Error>((metadata, decode_handle, shared, output, cancel))
        })
        .await
        .map_err(|e| Error::from_reason(format!("load task join error: {e}")))?;

        let (metadata, decode_handle, shared, output, cancel) = match result {
            Ok(result) => result,
            Err(error) => {
                let mut player = self.inner.lock();
                if !player.is_load_token_current(token) {
                    return Err(Error::from_reason(LOAD_SUPERSEDED_REASON));
                }
                player.clear_pending_load(token);
                return Err(error).into_napi();
            }
        };

        let returned_meta = {
            let mut player = self.inner.lock();
            player
                .commit_loaded(
                    token,
                    &source,
                    auto_play,
                    crate::player::LoadedPlayback {
                        metadata,
                        decode_handle,
                        shared,
                        output,
                        cancel,
                    },
                )
                .into_napi()?
        };

        match returned_meta {
            Some(meta) => Ok(Self::meta_to_js(meta)),
            None => Err(Error::from_reason(LOAD_SUPERSEDED_REASON)),
        }
    }

    fn meta_to_js(meta: crate::metadata::AudioMetadata) -> JsMusicMetadata {
        JsMusicMetadata {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            comment: meta.comment,
            duration: meta.duration_secs,
            sample_rate: meta.sample_rate,
            channels: meta.channels as u32,
            original_sample_rate: meta.original_sample_rate,
            bits_per_sample: meta.bits_per_sample,
            bit_rate: meta.bit_rate,
            codec: meta.codec,
            embedded_lyric: meta.embedded_lyric,
            external_lyrics: meta
                .external_lyrics
                .into_iter()
                .map(|l| JsExternalLyric {
                    format: l.format,
                    path: l.path,
                })
                .collect(),
            cover: meta.cover,
        }
    }

    #[napi]
    pub async fn play(&self) -> Result<()> {
        let (revival_source, position) = {
            let mut player = self.inner.lock();
            let pos = player.position();
            let src = player.play().into_napi()?;
            (src, pos)
        };
        if let Some(source) = revival_source {
            let is_remote = source.starts_with("http://") || source.starts_with("https://");
            if let Err(e) = self.load(source, Some(true)).await {
                if is_cancelled_napi_error(&e) {
                    return Ok(());
                }
                if is_remote {
                    self.inner.lock().emit_source_error();
                    return Ok(());
                }
                return Err(e);
            }
            if position > 0.0 {
                let _ = self.seek(position).await;
            }
        }
        Ok(())
    }

    #[napi]
    pub fn pause(&self) {
        self.inner.lock().pause();
    }

    #[napi]
    pub fn pause_immediately(&self) {
        self.inner.lock().pause_immediately();
    }

    #[napi]
    pub fn stop(&self) {
        self.inner.lock().stop();
    }

    ///
    #[napi]
    pub async fn seek(&self, position: f64) -> Result<()> {
        use crate::shared::Shared;

        let take = {
            let mut player = self.inner.lock();
            player.take_for_async_seek()
        };
        let Some(take) = take else {
            return Ok(());
        };

        let SeekTake {
            old_threads,
            normalization_enabled,
            normalization_gain,
            current_source,
            was_playing,
            original_sample_rate: _,
            original_channels: _,
            original_bits_per_sample: _,
            output_sample_rate,
            output_channels,
            token,
            equalizer,
            tempo,
        } = take;

        let outcome: SeekOutcome = tokio::task::spawn_blocking(move || {
            let decoder_data = old_threads.join_aux().and_then(|h| h.join().ok());
            let mut decoder_data = match decoder_data {
                Some(d) => d,
                None => return SeekOutcome::Fallback,
            };
            if !decoder_data.seek(position) {
                return SeekOutcome::Fallback;
            }
            let shared = Shared::new(output_sample_rate, output_channels);
            shared.set_normalization_enabled(normalization_enabled);
            shared.set_normalization_gain(normalization_gain);
            equalizer
                .lock()
                .set_output_format(output_sample_rate, output_channels);
            equalizer.lock().reset_state();
            tempo
                .lock()
                .set_output_format(output_sample_rate, output_channels);
            tempo.lock().reset();
            let handle =
                match decoder::resume_decode(decoder_data, Arc::clone(&shared), equalizer, tempo) {
                    Ok(handle) => handle,
                    Err(err) => {
                        warn!(error = %err, "Failed to start the decoder thread after seeking; falling back to reload");
                        return SeekOutcome::Fallback;
                    }
                };
            SeekOutcome::Resumed { shared, handle }
        })
        .await
        .map_err(|e| Error::from_reason(format!("seek task join error: {e}")))?;

        match outcome {
            SeekOutcome::Resumed { shared, handle } => {
                let mut player = self.inner.lock();
                let committed = player
                    .commit_seeked(token, position, shared, handle, None)
                    .into_napi()?;
                if !committed {
                    info!(position, "Seek was superseded by a newer load, seek, or stop; discarding result");
                }
                Ok(())
            }
            SeekOutcome::Fallback => {
                if !self.inner.lock().is_load_token_current(token) {
                    info!(position, "Seek failed but was superseded; skipping fallback reload");
                    return Ok(());
                }
                if let Some(src) = current_source {
                    let is_remote = src.starts_with("http://") || src.starts_with("https://");
                    if let Err(e) = self.load(src, Some(was_playing)).await {
                        if is_cancelled_napi_error(&e) {
                            return Ok(());
                        }
                        if is_remote {
                            self.inner.lock().emit_source_error();
                            return Ok(());
                        }
                        return Err(e);
                    }
                    Ok(())
                } else {
                    Err(Error::from_reason("Seek failed and there is no current source"))
                }
            }
        }
    }

    #[napi]
    pub fn set_volume(&self, volume: f64) {
        self.inner.lock().set_volume(volume as f32);
    }

    #[napi]
    pub fn get_volume(&self) -> f64 {
        self.inner.lock().volume() as f64
    }

    #[napi]
    pub fn set_fade_duration(&self, duration_ms: f64) {
        self.inner.lock().set_fade_duration(duration_ms as u64);
    }

    #[napi]
    pub fn get_fade_duration(&self) -> f64 {
        self.inner.lock().fade_duration() as f64
    }

    #[napi]
    pub fn get_position(&self) -> f64 {
        self.inner.lock().position()
    }

    #[napi]
    pub fn get_duration(&self) -> f64 {
        self.inner.lock().duration()
    }

    #[napi]
    pub fn get_status(&self) -> JsPlayerStatus {
        let player = self.inner.lock();
        JsPlayerStatus {
            state: state_to_str(player.state()).to_string(),
            position: player.position(),
            duration: player.duration(),
            volume: player.volume() as f64,
            is_finished: player.is_finished(),
        }
    }

    #[napi]
    pub fn set_fft_enabled(&self, enabled: bool) {
        self.inner.lock().set_fft_enabled(enabled);
    }

    #[napi]
    pub fn get_fft_enabled(&self) -> bool {
        self.inner.lock().fft_enabled()
    }

    #[napi]
    pub fn set_normalization_enabled(&self, enabled: bool) {
        self.inner.lock().set_normalization_enabled(enabled);
    }

    #[napi]
    pub fn get_normalization_enabled(&self) -> bool {
        self.inner.lock().normalization_enabled()
    }

    #[napi]
    pub fn set_equalizer_enabled(&self, enabled: bool) {
        self.inner.lock().set_equalizer_enabled(enabled);
    }

    #[napi]
    pub fn get_equalizer_enabled(&self) -> bool {
        self.inner.lock().equalizer_enabled()
    }

    #[napi]
    pub fn set_equalizer_bands(&self, gains_db: Vec<f64>) {
        let bands: Vec<f32> = gains_db.into_iter().map(|v| v as f32).collect();
        self.inner.lock().set_equalizer_bands(&bands);
    }

    #[napi]
    pub fn get_equalizer_bands(&self) -> Vec<f64> {
        self.inner
            .lock()
            .equalizer_bands()
            .iter()
            .map(|v| *v as f64)
            .collect()
    }

    #[napi]
    pub fn set_preamp_gain(&self, preamp_db: f64) {
        self.inner.lock().set_preamp_gain(preamp_db as f32);
    }

    #[napi]
    pub fn get_preamp_gain(&self) -> f64 {
        self.inner.lock().preamp_gain() as f64
    }

    #[napi]
    pub fn get_fft_data(&self) -> JsFftData {
        let (ldata, rdata) = self.inner.lock().fft_data();
        let ldata = ldata.into_iter().map(|v| v as f64).collect();
        let rdata = rdata.into_iter().map(|v| v as f64).collect();
        JsFftData { ldata, rdata }
    }

    #[napi]
    pub fn get_cover_raw(&self) -> Option<napi::bindgen_prelude::Buffer> {
        let player = self.inner.lock();
        let data = player.cover_raw()?;
        Some(data.to_vec().into())
    }

    #[napi]
    pub fn get_output_devices(&self) -> Vec<JsAudioDevice> {
        audio_output::list_output_devices()
            .into_iter()
            .map(|(id, name, is_default)| JsAudioDevice {
                id,
                name,
                is_default,
            })
            .collect()
    }

    #[napi]
    pub fn get_default_device_name(&self) -> Option<String> {
        audio_output::default_device_name()
    }

    #[napi]
    pub fn get_default_device_id(&self) -> Option<String> {
        audio_output::default_device_id()
    }

    #[napi]
    pub async fn set_output_device(&self, device_id: Option<String>) -> Result<()> {
        self.inner.lock().set_output_device(device_id);
        self.reinit_output().await
    }

    #[napi]
    pub async fn set_exclusive_audio(&self, enabled: bool) -> Result<()> {
        #[cfg(not(target_os = "windows"))]
        {
            if enabled {
                return Err(Error::from_reason("WASAPI exclusive audio is supported on Windows only"));
            }
            return Ok(());
        }

        #[cfg(target_os = "windows")]
        {
            let (previous, was_playing) = {
                let player = self.inner.lock();
                (
                    player.exclusive_audio(),
                    player.state() == PlayerState::Playing,
                )
            };
            if previous == enabled {
                return Ok(());
            }

            self.inner.lock().set_exclusive_audio(enabled);
            if let Err(error) = self.reinit_output().await {
                self.inner.lock().set_exclusive_audio(previous);
                match self.reinit_output().await {
                    Ok(()) if was_playing => {
                        let _ = self.play().await;
                    }
                    Ok(()) => {}
                    Err(recovery_error) => {
                        warn!(error = %recovery_error, "Could not restore the previous output after exclusive output switching failed");
                    }
                }
                return Err(error);
            }
            Ok(())
        }
    }

    ///
    #[napi]
    pub fn get_selected_device_name(&self) -> Option<String> {
        self.inner.lock().selected_device().map(String::from)
    }

    #[napi]
    pub fn set_speed(&self, speed: f64) {
        self.inner.lock().set_speed(speed as f32);
    }

    #[napi]
    pub fn set_pitch(&self, semitones: i32) {
        self.inner.lock().set_pitch(semitones.clamp(-12, 12) as i8);
    }

    #[napi]
    pub fn set_pitch_sync(&self, sync: bool) {
        self.inner.lock().set_pitch_sync(sync);
    }

    #[napi]
    pub fn get_speed(&self) -> f64 {
        self.inner.lock().speed() as f64
    }

    #[napi]
    pub fn get_pitch(&self) -> i32 {
        self.inner.lock().pitch() as i32
    }

    #[napi]
    pub fn get_pitch_sync(&self) -> bool {
        self.inner.lock().pitch_sync()
    }
}
