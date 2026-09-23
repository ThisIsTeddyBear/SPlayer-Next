use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use ffmpeg_audio::HttpCancelHandle;
use parking_lot::{Condvar, Mutex};

pub struct AudioChunk {
    pub player_samples: Vec<f32>,
    pub fft_samples: Vec<f32>,
    pub source_sample_count: u64,
}

pub enum PopResult {
    Chunk(AudioChunk),
    Pending,
    Finished,
}

struct OutputBuffer {
    chunks: VecDeque<AudioChunk>,
    samples: u64,
}

pub struct Shared {
    decoded_buffer: Mutex<VecDeque<AudioChunk>>,
    decoded_condvar: Condvar,
    output_buffer: Mutex<OutputBuffer>,
    output_condvar: Condvar,
    player_buffer_pool: Mutex<Vec<Vec<f32>>>,
    fft_buffer_pool: Mutex<Vec<Vec<f32>>>,
    decode_eof: AtomicBool,
    output_eof: AtomicBool,
    is_stopping: AtomicBool,
    samples_consumed: AtomicU64,
    sample_rate: u32,
    channels: u16,
    all_consumed: AtomicBool,
    decode_failed: AtomicBool,
    normalization_gain: AtomicU32,
    has_replay_gain: AtomicBool,
    normalization_enabled: AtomicBool,
    bit_perfect: AtomicBool,
    cancel_handle: Mutex<Option<HttpCancelHandle>>,
}

pub const FRAME_BUFFER_CAPACITY: usize = 192;

const OUTPUT_BUFFER_CAPACITY: usize = 256;
const OUTPUT_BUFFER_MS: u64 = 100;

const STARTUP_BUFFER_MS: u64 = 50;

const BUFFER_POOL_CAPACITY: usize = FRAME_BUFFER_CAPACITY + 64;

impl Shared {
    pub fn new(sample_rate: u32, channels: u16) -> Arc<Self> {
        assert!(
            sample_rate > 0 && channels > 0,
            "sample_rate/channels 必须为正"
        );
        Arc::new(Self {
            decoded_buffer: Mutex::new(VecDeque::with_capacity(FRAME_BUFFER_CAPACITY)),
            decoded_condvar: Condvar::new(),
            output_buffer: Mutex::new(OutputBuffer {
                chunks: VecDeque::with_capacity(OUTPUT_BUFFER_CAPACITY),
                samples: 0,
            }),
            output_condvar: Condvar::new(),
            player_buffer_pool: Mutex::new(Vec::with_capacity(BUFFER_POOL_CAPACITY)),
            fft_buffer_pool: Mutex::new(Vec::with_capacity(BUFFER_POOL_CAPACITY)),
            decode_eof: AtomicBool::new(false),
            output_eof: AtomicBool::new(false),
            is_stopping: AtomicBool::new(false),
            samples_consumed: AtomicU64::new(0),
            sample_rate,
            channels,
            all_consumed: AtomicBool::new(false),
            decode_failed: AtomicBool::new(false),
            normalization_gain: AtomicU32::new(1.0_f32.to_bits()),
            has_replay_gain: AtomicBool::new(false),
            normalization_enabled: AtomicBool::new(false),
            bit_perfect: AtomicBool::new(false),
            cancel_handle: Mutex::new(None),
        })
    }

    pub fn bind_cancel_handle(&self, cancel_handle: HttpCancelHandle) {
        *self.cancel_handle.lock() = Some(cancel_handle);
    }

    pub fn set_normalization_gain(&self, gain: f32) {
        self.normalization_gain
            .store(gain.to_bits(), Ordering::Relaxed);
    }

    pub fn set_has_replay_gain(&self, has_replay_gain: bool) {
        self.has_replay_gain
            .store(has_replay_gain, Ordering::Relaxed);
    }

    pub fn has_replay_gain(&self) -> bool {
        self.has_replay_gain.load(Ordering::Relaxed)
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn set_normalization_enabled(&self, enabled: bool) {
        self.normalization_enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn is_normalization_enabled(&self) -> bool {
        self.normalization_enabled.load(Ordering::Relaxed)
    }

    pub fn set_bit_perfect(&self, enabled: bool) {
        self.bit_perfect.store(enabled, Ordering::Relaxed);
    }

    pub fn is_bit_perfect(&self) -> bool {
        self.bit_perfect.load(Ordering::Relaxed)
    }

    pub fn normalization_gain(&self) -> f32 {
        f32::from_bits(self.normalization_gain.load(Ordering::Relaxed))
    }

    pub fn take_player_buffer(&self) -> Vec<f32> {
        self.player_buffer_pool.lock().pop().unwrap_or_default()
    }

    pub fn recycle_player_buffer(&self, mut buffer: Vec<f32>) {
        buffer.clear();
        let mut pool = self.player_buffer_pool.lock();
        if pool.len() < BUFFER_POOL_CAPACITY {
            pool.push(buffer);
        }
    }

    pub fn take_fft_buffer(&self) -> Vec<f32> {
        self.fft_buffer_pool.lock().pop().unwrap_or_default()
    }

    pub fn recycle_fft_buffer(&self, mut buffer: Vec<f32>) {
        buffer.clear();
        let mut pool = self.fft_buffer_pool.lock();
        if pool.len() < BUFFER_POOL_CAPACITY {
            pool.push(buffer);
        }
    }

    pub fn advance_consumed(&self, count: u64) {
        self.samples_consumed.fetch_add(count, Ordering::Relaxed);
    }

    pub fn samples_consumed_count(&self) -> u64 {
        self.samples_consumed.load(Ordering::Relaxed)
    }

    pub fn is_buffer_empty(&self) -> bool {
        self.output_buffer.lock().chunks.is_empty()
    }

    pub fn mark_all_consumed(&self) {
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        self.all_consumed.store(true, Ordering::Release);
    }

    pub fn is_stopping(&self) -> bool {
        self.is_stopping.load(Ordering::Acquire)
    }

    pub fn is_all_consumed(&self) -> bool {
        self.all_consumed.load(Ordering::Acquire)
    }

    pub fn mark_decode_failed(&self) {
        self.decode_failed.store(true, Ordering::Release);
    }

    pub fn is_decode_failed(&self) -> bool {
        self.decode_failed.load(Ordering::Acquire)
    }

    pub fn consumed_position(&self) -> f64 {
        let samples = self.samples_consumed.load(Ordering::Relaxed);
        samples as f64 / self.sample_rate as f64 / self.channels as f64
    }

    pub fn wait_for_space(&self) -> bool {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.len() >= FRAME_BUFFER_CAPACITY
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        !self.is_stopping.load(Ordering::Acquire) && !self.output_eof.load(Ordering::Acquire)
    }

    pub fn push(&self, chunk: AudioChunk) {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.len() >= FRAME_BUFFER_CAPACITY
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        if self.is_stopping.load(Ordering::Acquire) || self.output_eof.load(Ordering::Acquire) {
            return;
        }
        buffer.push_back(chunk);
        self.decoded_condvar.notify_one();
    }

    pub fn pop_decoded(&self) -> Option<AudioChunk> {
        let mut buffer = self.decoded_buffer.lock();
        while buffer.is_empty()
            && !self.decode_eof.load(Ordering::Acquire)
            && !self.is_stopping.load(Ordering::Acquire)
            && !self.output_eof.load(Ordering::Acquire)
        {
            self.decoded_condvar.wait(&mut buffer);
        }
        let chunk = buffer.pop_front();
        if chunk.is_some() {
            self.decoded_condvar.notify_one();
        }
        chunk
    }

    pub fn push_output(&self, chunk: AudioChunk) {
        let mut buffer = self.output_buffer.lock();
        let target_samples = u64::from(self.sample_rate)
            .saturating_mul(u64::from(self.channels))
            .saturating_mul(OUTPUT_BUFFER_MS)
            / 1000;
        while (buffer.chunks.len() >= OUTPUT_BUFFER_CAPACITY || buffer.samples >= target_samples)
            && !self.is_stopping.load(Ordering::Acquire)
        {
            self.output_condvar.wait(&mut buffer);
        }
        if self.is_stopping.load(Ordering::Acquire) {
            return;
        }
        buffer.samples += chunk.player_samples.len() as u64;
        buffer.chunks.push_back(chunk);
        self.output_condvar.notify_one();
    }

    /// 启动输出前等待少量 PCM，避免首帧解码抖动立即触发欠载。
    pub fn wait_for_playback_ready(&self) {
        let mut buffer = self.output_buffer.lock();
        while !self.playback_buffer_ready(&buffer) {
            self.output_condvar.wait(&mut buffer);
        }
    }

    fn playback_buffer_ready(&self, buffer: &OutputBuffer) -> bool {
        let target_samples = u64::from(self.sample_rate)
            .saturating_mul(u64::from(self.channels))
            .saturating_mul(STARTUP_BUFFER_MS)
            / 1000;
        self.is_stopping.load(Ordering::Acquire)
            || self.output_eof.load(Ordering::Acquire)
            || buffer.chunks.len() >= OUTPUT_BUFFER_CAPACITY
            || buffer.samples >= target_samples
    }

    pub fn try_pop(&self) -> PopResult {
        let mut buffer = self.output_buffer.lock();
        if let Some(chunk) = buffer.chunks.pop_front() {
            buffer.samples -= chunk.player_samples.len() as u64;
            self.output_condvar.notify_one();
            return PopResult::Chunk(chunk);
        }
        if self.output_eof.load(Ordering::Acquire) || self.is_stopping.load(Ordering::Acquire) {
            PopResult::Finished
        } else {
            PopResult::Pending
        }
    }

    pub fn mark_eof(&self) {
        self.decode_eof.store(true, Ordering::Release);
        self.decoded_condvar.notify_all();
    }

    pub fn mark_output_eof(&self) {
        self.output_eof.store(true, Ordering::Release);
        self.decoded_condvar.notify_all();
        self.output_condvar.notify_all();
    }

    pub fn stop(&self) {
        self.is_stopping.store(true, Ordering::Release);
        if let Some(handle) = self.cancel_handle.lock().as_ref() {
            handle.cancel();
        }
        self.decoded_condvar.notify_all();
        self.output_condvar.notify_all();
    }

    pub fn drain_buffer(&self) {
        let mut decoded = self.decoded_buffer.lock();
        let decoded_chunks = std::mem::take(&mut *decoded);
        decoded.shrink_to_fit();
        drop(decoded);
        let mut output = self.output_buffer.lock();
        let output_chunks = std::mem::take(&mut output.chunks);
        output.samples = 0;
        output.chunks.shrink_to_fit();
        drop(output);
        for chunk in decoded_chunks.into_iter().chain(output_chunks) {
            self.recycle_player_buffer(chunk.player_samples);
            self.recycle_fft_buffer(chunk.fft_samples);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_buffer_pools_are_bounded() {
        let shared = Shared::new(48_000, 2);

        for _ in 0..(BUFFER_POOL_CAPACITY + 20) {
            shared.recycle_player_buffer(Vec::with_capacity(16));
            shared.recycle_fft_buffer(Vec::with_capacity(16));
        }

        assert_eq!(shared.player_buffer_pool.lock().len(), BUFFER_POOL_CAPACITY);
        assert_eq!(shared.fft_buffer_pool.lock().len(), BUFFER_POOL_CAPACITY);
    }

    #[test]
    fn playback_waits_for_a_small_startup_buffer() {
        let shared = Shared::new(1000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![0.0; 50],
            fft_samples: Vec::new(),
            source_sample_count: 50,
        });
        assert!(!shared.playback_buffer_ready(&shared.output_buffer.lock()));
        shared.push_output(AudioChunk {
            player_samples: vec![0.0; 50],
            fft_samples: Vec::new(),
            source_sample_count: 50,
        });
        assert!(shared.playback_buffer_ready(&shared.output_buffer.lock()));
    }

    #[test]
    fn high_rate_output_buffers_by_duration_instead_of_chunk_count() {
        let shared = Shared::new(384_000, 2);
        for _ in 0..5 {
            shared.push_output(AudioChunk {
                player_samples: vec![0.0; 768],
                fft_samples: Vec::new(),
                source_sample_count: 768,
            });
        }
        assert_eq!(shared.output_buffer.lock().chunks.len(), 5);
        assert!(!shared.playback_buffer_ready(&shared.output_buffer.lock()));
        for _ in 0..45 {
            shared.push_output(AudioChunk {
                player_samples: vec![0.0; 768],
                fft_samples: Vec::new(),
                source_sample_count: 768,
            });
        }
        assert!(shared.playback_buffer_ready(&shared.output_buffer.lock()));
        assert!(matches!(shared.try_pop(), PopResult::Chunk(_)));
        assert_eq!(shared.output_buffer.lock().samples, 49 * 768);
        shared.drain_buffer();
        assert_eq!(shared.output_buffer.lock().samples, 0);
    }
}
