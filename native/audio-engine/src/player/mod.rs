use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::Result;
use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;
use tracing::{debug, info};

use crate::audio_output::{AudioOutput, OutputFailureCallback};
use crate::decoder;
use crate::equalizer::{Equalizer, EQ_BAND_COUNT};
use crate::fft::FftAnalyzer;
use crate::playback::PlaybackHandle;
use crate::shared::Shared;
use crate::tempo::StretchProcessor;

mod background;
mod events;
mod transition;

#[cfg(test)]
use events::playback_completion_event;
pub use events::{EventEmitter, PlayerEvent, PlayerState};
pub use transition::{LoadedPlayback, SeekTake};

pub struct InnerPlayer {
    output: Option<AudioOutput>,
    playback: Option<Arc<PlaybackHandle>>,
    shared: Option<Arc<Shared>>,
    decoder_thread: Option<JoinHandle<decoder::DecoderData>>,
    fft: Arc<FftAnalyzer>,
    audio_duration: f64,
    cover_raw: Option<Vec<u8>>,
    state: PlayerState,
    seek_base: f64,
    current_source: Option<String>,
    target_volume: f32,
    fade_duration_ms: u64,
    cover_cache_dir: Option<String>,
    event_callback: Option<EventEmitter>,
    position_timer_stop: Option<Arc<AtomicBool>>,
    position_timer_handle: Option<JoinHandle<()>>,
    fade_cancel: Option<Arc<AtomicBool>>,
    fade_handle: Option<JoinHandle<()>>,
    fft_enabled: Arc<AtomicBool>,
    fft_timer_stop: Option<Arc<AtomicBool>>,
    fft_timer_handle: Option<JoinHandle<()>>,
    selected_device: Option<String>,
    exclusive_audio: bool,
    normalization_enabled: bool,
    equalizer: Arc<Mutex<Equalizer>>,
    tempo: Arc<Mutex<StretchProcessor>>,
    load_token: Arc<AtomicU64>,
    output_generation: Arc<AtomicU64>,
    original_sample_rate: u32,
    original_channels: u16,
    original_bits_per_sample: u32,
    pending_load_handle: Option<HttpCancelHandle>,
}

const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<InnerPlayer>();
};

impl InnerPlayer {
    fn ensure_output(&mut self, requested_sample_rate: Option<u32>) -> Result<&AudioOutput> {
        if self.output.is_none() {
            let generation = self.reserve_output_generation();
            let on_failure = self.make_failure_callback(generation);
            self.output = Some(AudioOutput::new(
                self.selected_device.as_deref(),
                requested_sample_rate,
                None,
                None,
                self.exclusive_audio,
                generation,
                on_failure,
            )?);
        }
        self.output
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("ensure_output postcondition was violated"))
    }

    pub fn make_failure_callback(&self, generation: u64) -> OutputFailureCallback {
        let Some(cb) = self.event_callback.as_ref().map(Arc::clone) else {
            return std::sync::Arc::new(|| {});
        };
        let active_generation = Arc::clone(&self.output_generation);
        std::sync::Arc::new(move || {
            if active_generation.load(Ordering::Acquire) == generation {
                cb(PlayerEvent::OutputFailed);
            }
        })
    }

    pub fn reserve_output_generation(&self) -> u64 {
        self.output_generation.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub fn output_sample_rate(&self) -> u32 {
        self.output
            .as_ref()
            .map(|out| out.sample_rate())
            .unwrap_or(decoder::DEFAULT_TARGET_SAMPLE_RATE)
    }

    pub fn output_channels(&self) -> u16 {
        self.output
            .as_ref()
            .map(AudioOutput::channels)
            .unwrap_or(decoder::DEFAULT_OUTPUT_CHANNELS)
    }

    pub fn new() -> Result<Self> {
        let output = None;
        let initial_rate = decoder::DEFAULT_TARGET_SAMPLE_RATE;
        debug!("InnerPlayer created");

        Ok(Self {
            output,
            playback: None,
            shared: None,
            decoder_thread: None,
            fft: Arc::new(FftAnalyzer::new()),
            audio_duration: 0.0,
            cover_raw: None,
            state: PlayerState::Idle,
            seek_base: 0.0,
            current_source: None,
            target_volume: 1.0,
            fade_duration_ms: 200,
            cover_cache_dir: None,
            event_callback: None,
            position_timer_stop: None,
            position_timer_handle: None,
            fade_cancel: None,
            fade_handle: None,
            fft_enabled: Arc::new(AtomicBool::new(false)),
            fft_timer_stop: None,
            fft_timer_handle: None,
            selected_device: None,
            exclusive_audio: false,
            normalization_enabled: false,
            equalizer: Arc::new(Mutex::new(Equalizer::new(
                initial_rate,
                decoder::DEFAULT_OUTPUT_CHANNELS,
            ))),
            tempo: Arc::new(Mutex::new(StretchProcessor::new(
                decoder::DEFAULT_OUTPUT_CHANNELS,
                initial_rate,
            ))),
            load_token: Arc::new(AtomicU64::new(0)),
            output_generation: Arc::new(AtomicU64::new(0)),
            original_sample_rate: decoder::DEFAULT_TARGET_SAMPLE_RATE,
            original_channels: decoder::DEFAULT_OUTPUT_CHANNELS,
            original_bits_per_sample: 24,
            pending_load_handle: None,
        })
    }

    pub fn set_output_device(&mut self, device_id: Option<String>) {
        info!(device = ?device_id, "Switching output device");
        self.selected_device = device_id;
    }

    pub fn selected_device(&self) -> Option<&str> {
        self.selected_device.as_deref()
    }

    pub fn set_exclusive_audio(&mut self, enabled: bool) {
        self.exclusive_audio = enabled;
        if enabled {
            self.cancel_fade();
            self.target_volume = 1.0;
            self.fade_duration_ms = 0;
            if let Some(playback) = &self.playback {
                playback.set_volume(1.0);
            }
            self.normalization_enabled = false;
            if let Some(shared) = &self.shared {
                shared.set_normalization_enabled(false);
            }
            self.equalizer.lock().set_enabled(false);
            self.equalizer.lock().reset_state();
            let mut tempo = self.tempo.lock();
            tempo.set_speed(1.0);
            tempo.set_pitch(0);
            tempo.set_pitch_sync(true);
            tempo.reset();
        }
    }

    pub fn exclusive_audio(&self) -> bool {
        self.exclusive_audio
    }

    pub fn bit_perfect_active(&self) -> bool {
        self.exclusive_audio
            && self
                .shared
                .as_ref()
                .is_some_and(|shared| shared.is_bit_perfect())
            && self
                .output
                .as_ref()
                .is_some_and(AudioOutput::is_bit_perfect)
    }

    pub fn set_event_callback(&mut self, cb: EventEmitter) {
        self.stop_position_timer();
        self.stop_fft_timer();
        self.cancel_fade();
        self.event_callback = Some(cb);
    }

    fn emit(&self, event: PlayerEvent) {
        if let Some(cb) = &self.event_callback {
            cb(event);
        }
    }

    pub fn emit_source_error(&self) {
        self.emit(PlayerEvent::SourceError);
    }

    pub fn set_cover_cache_dir(&mut self, dir: String) {
        self.cover_cache_dir = Some(dir);
    }

    pub fn cover_cache_dir(&self) -> Option<&str> {
        self.cover_cache_dir.as_deref()
    }

    pub fn is_normalization_enabled(&self) -> bool {
        self.normalization_enabled
    }

    pub fn current_source(&self) -> Option<&str> {
        self.current_source.as_deref()
    }

    pub fn play(&mut self) -> Result<Option<String>> {
        if self.state == PlayerState::Playing && self.is_finished() {
            self.stop_internal();
            self.state = PlayerState::Stopped;
        }

        match self.state {
            PlayerState::Playing => Ok(None),
            PlayerState::Paused => {
                if self.playback.is_none() || self.decoder_thread.is_none() {
                    return Ok(self.current_source.clone());
                }

                self.cancel_fade();
                if let Some(ref playback) = self.playback {
                    if self.exclusive_audio {
                        playback.set_volume(1.0);
                    } else {
                        playback.set_volume(0.0);
                    }
                    playback.play();
                }

                self.state = PlayerState::Playing;
                self.emit(PlayerEvent::StateChanged {
                    state: PlayerState::Playing,
                });
                self.start_position_timer();
                self.start_fft_timer();

                if !self.exclusive_audio {
                    self.start_fade(0.0, self.target_volume, None);
                }
                Ok(None)
            }
            PlayerState::Stopped | PlayerState::Idle => Ok(self.current_source.clone()),
        }
    }

    pub fn pause(&mut self) {
        if self.state != PlayerState::Playing {
            return;
        }
        if self.exclusive_audio {
            self.pause_immediately();
            return;
        }

        self.state = PlayerState::Paused;
        self.emit(PlayerEvent::StateChanged {
            state: PlayerState::Paused,
        });

        let playback_for_callback = self.playback.as_ref().map(Arc::clone);
        self.start_fade(
            self.target_volume,
            0.0,
            Some(Box::new(move || {
                if let Some(playback) = playback_for_callback {
                    playback.pause();
                }
            })),
        );

        self.stop_position_timer();
        self.stop_fft_timer();
    }

    pub fn pause_immediately(&mut self) {
        if self.state != PlayerState::Playing {
            return;
        }
        self.cancel_fade();
        if let Some(ref playback) = self.playback {
            playback.pause();
        }
        self.state = PlayerState::Paused;
        self.emit(PlayerEvent::StateChanged {
            state: PlayerState::Paused,
        });
        self.stop_position_timer();
        self.stop_fft_timer();
    }

    ///
    pub fn enter_paused_for_recovery(&mut self) {
        if self.state != PlayerState::Paused {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Paused,
            });
        }
    }

    pub fn stop(&mut self) {
        self.load_token.fetch_add(1, Ordering::AcqRel);
        if let Some(handle) = self.pending_load_handle.take() {
            handle.cancel();
        }
        self.stop_internal();
        self.current_source = None;
        self.state = PlayerState::Stopped;
        self.emit(PlayerEvent::StateChanged {
            state: PlayerState::Stopped,
        });
    }

    fn stop_internal(&mut self) {
        self.cancel_fade();
        self.stop_position_timer();
        self.stop_fft_timer();
        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(playback) = self.playback.take() {
            playback.stop();
        }
        if let Some(handle) = self.decoder_thread.take() {
            let _ = handle.join();
        }
        if let Some(ref shared) = self.shared {
            shared.drain_buffer();
        }
        self.shared = None;
        self.cover_raw = None;
        self.seek_base = 0.0;
    }

    pub fn set_volume(&mut self, volume: f32) {
        if self.exclusive_audio {
            self.target_volume = 1.0;
            if let Some(playback) = &self.playback {
                playback.set_volume(1.0);
            }
            return;
        }
        self.target_volume = volume;
        if let Some(ref playback) = self.playback {
            playback.set_volume(volume);
        }
    }

    pub fn volume(&self) -> f32 {
        self.target_volume
    }

    pub fn set_fade_duration(&mut self, duration_ms: u64) {
        if self.exclusive_audio {
            self.fade_duration_ms = 0;
            return;
        }
        self.fade_duration_ms = duration_ms;
    }

    pub fn fade_duration(&self) -> u64 {
        self.fade_duration_ms
    }

    pub fn position(&self) -> f64 {
        match &self.shared {
            Some(shared) => self.seek_base + shared.consumed_position(),
            None => self.seek_base,
        }
    }

    pub fn duration(&self) -> f64 {
        self.audio_duration
    }

    pub fn state(&self) -> PlayerState {
        self.state
    }

    pub fn fft_data(&self) -> (Vec<f32>, Vec<f32>) {
        self.fft.analyze()
    }

    pub fn cover_raw(&self) -> Option<&[u8]> {
        self.cover_raw.as_deref()
    }

    pub fn is_finished(&self) -> bool {
        match (&self.shared, &self.playback) {
            (Some(shared), Some(_)) => shared.is_all_consumed(),
            _ => false,
        }
    }

    pub fn set_normalization_enabled(&mut self, enabled: bool) {
        if self.exclusive_audio {
            self.normalization_enabled = false;
            if let Some(shared) = &self.shared {
                shared.set_normalization_enabled(false);
            }
            return;
        }
        self.normalization_enabled = enabled;
        if let Some(ref shared) = self.shared {
            shared.set_normalization_enabled(enabled);
        }
    }

    pub fn normalization_enabled(&self) -> bool {
        self.normalization_enabled
    }

    pub fn set_equalizer_enabled(&mut self, enabled: bool) {
        if self.exclusive_audio {
            self.equalizer.lock().set_enabled(false);
            return;
        }
        self.equalizer.lock().set_enabled(enabled);
    }

    pub fn equalizer_enabled(&self) -> bool {
        self.equalizer.lock().enabled()
    }

    pub fn set_equalizer_bands(&mut self, gains_db: &[f32]) {
        self.equalizer.lock().set_band_gains(gains_db);
    }

    pub fn equalizer_bands(&self) -> [f32; EQ_BAND_COUNT] {
        self.equalizer.lock().band_gains_db()
    }

    pub fn set_preamp_gain(&mut self, db: f32) {
        self.equalizer.lock().set_preamp_db(db);
    }

    pub fn preamp_gain(&self) -> f32 {
        self.equalizer.lock().preamp_db()
    }

    pub fn set_speed(&mut self, speed: f32) {
        if self.exclusive_audio {
            return;
        }
        self.tempo.lock().set_speed(speed);
    }

    pub fn set_pitch(&mut self, semitones: i8) {
        if self.exclusive_audio {
            return;
        }
        self.tempo.lock().set_pitch(semitones);
    }

    pub fn set_pitch_sync(&mut self, sync: bool) {
        if self.exclusive_audio {
            return;
        }
        self.tempo.lock().set_pitch_sync(sync);
    }

    pub fn speed(&self) -> f32 {
        self.tempo.lock().speed()
    }

    pub fn pitch(&self) -> i8 {
        self.tempo.lock().pitch()
    }

    pub fn pitch_sync(&self) -> bool {
        self.tempo.lock().pitch_sync()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn decode_failure_mid_stream_emits_source_error() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();

        assert!(matches!(
            playback_completion_event(&shared, 120.0, 30.0),
            PlayerEvent::SourceError
        ));
    }

    #[test]
    fn decode_failure_near_end_is_treated_as_ended() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();

        assert!(matches!(
            playback_completion_event(&shared, 120.0, 118.0),
            PlayerEvent::Ended
        ));
    }

    #[test]
    fn unknown_duration_failure_emits_source_error() {
        let shared = Shared::new(48_000, 2);
        shared.mark_decode_failed();

        assert!(matches!(
            playback_completion_event(&shared, 0.0, 30.0),
            PlayerEvent::SourceError
        ));
    }

    #[test]
    fn stale_output_failure_callback_is_ignored() {
        let mut player = InnerPlayer::new().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_event = Arc::clone(&calls);
        player.set_event_callback(Arc::new(move |event| {
            if matches!(event, PlayerEvent::OutputFailed) {
                calls_for_event.fetch_add(1, Ordering::Relaxed);
            }
        }));

        let generation = player.reserve_output_generation();
        let callback = player.make_failure_callback(generation);
        callback();
        assert_eq!(calls.load(Ordering::Relaxed), 1);

        player.reserve_output_generation();
        callback();
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }
}
