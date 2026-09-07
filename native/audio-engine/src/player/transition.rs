use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use crate::audio_output::AudioOutput;
use crate::decoder;
use crate::equalizer::Equalizer;
use crate::metadata::AudioMetadata;
use crate::playback::PlaybackHandle;
use crate::shared::Shared;
use crate::source::DecoderSource;
use crate::tempo::StretchProcessor;
use anyhow::Result;
use ffmpeg_audio::HttpCancelHandle;
use parking_lot::Mutex;

use super::{InnerPlayer, PlayerEvent, PlayerState};

pub struct OldThreads {
    pub decoder_thread: Option<JoinHandle<decoder::DecoderData>>,
    pub position_timer: Option<JoinHandle<()>>,
    pub fft_timer: Option<JoinHandle<()>>,
    pub fade_handle: Option<JoinHandle<()>>,
}

impl OldThreads {
    pub fn join_aux(self) -> Option<JoinHandle<decoder::DecoderData>> {
        for h in [self.position_timer, self.fft_timer, self.fade_handle]
            .into_iter()
            .flatten()
        {
            let _ = h.join();
        }
        self.decoder_thread
    }
}

pub struct SeekTake {
    pub old_threads: OldThreads,
    pub normalization_enabled: bool,
    pub normalization_gain: f32,
    pub current_source: Option<String>,
    pub was_playing: bool,
    pub original_sample_rate: u32,
    pub original_channels: u16,
    pub original_bits_per_sample: u32,
    pub output_sample_rate: u32,
    pub output_channels: u16,
    pub token: u64,
    pub equalizer: Arc<Mutex<Equalizer>>,
    pub tempo: Arc<Mutex<StretchProcessor>>,
}

pub struct LoadedPlayback {
    pub metadata: AudioMetadata,
    pub decode_handle: JoinHandle<decoder::DecoderData>,
    pub shared: Arc<Shared>,
    pub output: AudioOutput,
    pub cancel: Option<HttpCancelHandle>,
}

impl InnerPlayer {
    pub fn take_for_async_load(&mut self, handle: HttpCancelHandle) -> (OldThreads, u64) {
        let token = self.load_token.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some(previous) = self.pending_load_handle.replace(handle) {
            previous.cancel();
        }

        if let Some(flag) = self.fade_cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.position_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.fft_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }

        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(playback) = self.playback.take() {
            playback.stop();
        }
        if let Some(ref shared) = self.shared {
            shared.drain_buffer();
        }
        self.shared = None;
        self.cover_raw = None;
        self.seek_base = 0.0;
        self.fft.reset();
        self.equalizer.lock().reset_state();
        self.tempo.lock().reset();

        let old_threads = OldThreads {
            decoder_thread: self.decoder_thread.take(),
            position_timer: self.position_timer_handle.take(),
            fft_timer: self.fft_timer_handle.take(),
            fade_handle: self.fade_handle.take(),
        };
        (old_threads, token)
    }

    pub fn is_load_token_current(&self, token: u64) -> bool {
        token == self.load_token.load(Ordering::Acquire)
    }

    pub fn load_token_handle(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.load_token)
    }

    pub fn equalizer_handle(&self) -> Arc<Mutex<Equalizer>> {
        Arc::clone(&self.equalizer)
    }

    pub fn tempo_handle(&self) -> Arc<Mutex<StretchProcessor>> {
        Arc::clone(&self.tempo)
    }

    pub fn clear_pending_load(&mut self, token: u64) {
        if self.is_load_token_current(token) {
            self.pending_load_handle = None;
        }
    }

    ///
    pub fn take_for_async_seek(&mut self) -> Option<SeekTake> {
        self.decoder_thread.as_ref()?;

        let token = self.load_token.fetch_add(1, Ordering::AcqRel) + 1;

        if let Some(flag) = self.fade_cancel.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.position_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }
        if let Some(flag) = self.fft_timer_stop.take() {
            flag.store(true, Ordering::Relaxed);
        }

        if let Some(ref shared) = self.shared {
            shared.stop();
        }
        if let Some(playback) = self.playback.take() {
            playback.stop();
        }

        let old_threads = OldThreads {
            decoder_thread: self.decoder_thread.take(),
            position_timer: self.position_timer_handle.take(),
            fft_timer: self.fft_timer_handle.take(),
            fade_handle: self.fade_handle.take(),
        };

        let (norm_enabled, norm_gain) = match self.shared.take() {
            Some(s) => {
                s.drain_buffer();
                (s.is_normalization_enabled(), s.normalization_gain())
            }
            None => (self.normalization_enabled, 0.0),
        };

        self.fft.reset();

        Some(SeekTake {
            old_threads,
            normalization_enabled: norm_enabled,
            normalization_gain: norm_gain,
            current_source: self.current_source.clone(),
            was_playing: self.state == PlayerState::Playing,
            original_sample_rate: self.original_sample_rate,
            original_channels: self.original_channels,
            original_bits_per_sample: self.original_bits_per_sample,
            output_sample_rate: self.output_sample_rate(),
            output_channels: self.output_channels(),
            token,
            equalizer: Arc::clone(&self.equalizer),
            tempo: Arc::clone(&self.tempo),
        })
    }

    ///
    pub fn commit_seeked(
        &mut self,
        token: u64,
        position_secs: f64,
        shared: Arc<Shared>,
        handle: JoinHandle<decoder::DecoderData>,
        output: Option<AudioOutput>,
    ) -> Result<bool> {
        if token != self.load_token.load(Ordering::Acquire) {
            shared.stop();
            drop(handle);
            return Ok(false);
        }

        if let Some(out) = output {
            self.output = Some(out);
        }
        let reader = DecoderSource::new(Arc::clone(&shared), Arc::clone(&self.fft));
        let was_paused = self.state == PlayerState::Paused;
        let volume = self.target_volume;
        let playback = {
            let output = self.ensure_output(None)?;
            Arc::new(PlaybackHandle::attach(output, reader, volume, was_paused)?)
        };

        self.playback = Some(playback);
        self.shared = Some(shared);
        self.decoder_thread = Some(handle);
        self.seek_base = position_secs;

        if was_paused {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Paused,
            });
        } else {
            self.state = PlayerState::Playing;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Playing,
            });
            self.start_position_timer();
            self.start_fft_timer();
        }

        Ok(true)
    }

    ///
    pub fn commit_loaded(
        &mut self,
        token: u64,
        source: &str,
        auto_play: bool,
        loaded: LoadedPlayback,
    ) -> Result<Option<AudioMetadata>> {
        let LoadedPlayback {
            mut metadata,
            decode_handle,
            shared,
            output,
            cancel,
        } = loaded;
        if token != self.load_token.load(Ordering::Acquire) {
            if let Some(h) = cancel {
                h.cancel();
            }
            shared.stop();
            drop(decode_handle);
            return Ok(None);
        }

        self.pending_load_handle = cancel;
        self.output = Some(output);

        let reader = DecoderSource::new(Arc::clone(&shared), Arc::clone(&self.fft));
        let volume = self.target_volume;
        let playback = {
            let output = self.ensure_output(None)?;
            Arc::new(PlaybackHandle::attach(output, reader, volume, !auto_play)?)
        };

        self.playback = Some(playback);
        self.shared = Some(shared);
        self.decoder_thread = Some(decode_handle);
        self.seek_base = 0.0;
        self.current_source = Some(source.to_string());

        self.audio_duration = metadata.duration_secs;
        self.original_sample_rate = metadata.original_sample_rate;
        self.original_channels = metadata.channels;
        self.original_bits_per_sample = metadata.bits_per_sample;
        self.cover_raw = metadata.cover_raw.take();

        if auto_play {
            self.state = PlayerState::Playing;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Playing,
            });
            self.start_position_timer();
            self.start_fft_timer();
        } else {
            self.state = PlayerState::Paused;
            self.emit(PlayerEvent::StateChanged {
                state: PlayerState::Paused,
            });
        }

        Ok(Some(metadata))
    }
}
