use std::sync::Arc;

use crate::fft::FftAnalyzer;
use crate::shared::{PopResult, Shared};

const UNDERRUN_FADE_MS: u32 = 5;

/// 平台无关的解码样本读取器。
/// DSP 已在后台线程完成；这里不获取 DSP 锁、不扩容，欠载时平滑衰减并快速重试。
/// 所有平台的 CPAL 输出回调都从该读取器拉取样本。
pub struct DecoderSampleReader {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// DSP 后样本缓冲，直接接管 chunk 的 Vec，不复制也不扩容
    local_buffer: Vec<f32>,
    local_index: usize,
    /// 欠载时保持声道对齐的短重试窗口
    underrun_samples_remaining: usize,
    underrun_frames_emitted: usize,
    recovery_frames_remaining: usize,
    /// 用上一帧做短衰减，避免音频与静音之间的波形突变
    last_frame: Vec<f32>,
    channel_index: usize,
    finished: bool,
    sample_rate: u32,
    channels: u16,
}

impl DecoderSampleReader {
    pub fn new(shared: Arc<Shared>, fft: Arc<FftAnalyzer>) -> Self {
        let sample_rate = shared.sample_rate();
        let channels = shared.channels();
        Self {
            shared,
            fft,
            local_buffer: Vec::new(),
            local_index: 0,
            underrun_samples_remaining: 0,
            underrun_frames_emitted: 0,
            recovery_frames_remaining: 0,
            last_frame: vec![0.0; usize::from(channels)],
            channel_index: 0,
            finished: false,
            sample_rate,
            channels,
        }
    }

    fn frames_for_ms(&self, duration_ms: u32) -> usize {
        ((u64::from(self.sample_rate) * u64::from(duration_ms) / 1000) as usize).max(1)
    }

    fn advance_channel(&mut self) -> bool {
        self.channel_index += 1;
        if self.channel_index < usize::from(self.channels) {
            return false;
        }
        self.channel_index = 0;
        true
    }

    fn next_audio_sample(&mut self, sample: f32) -> f32 {
        let sample = if sample.is_finite() { sample } else { 0.0 };
        let output = if self.recovery_frames_remaining == 0 {
            sample
        } else {
            let fade_frames = self.frames_for_ms(UNDERRUN_FADE_MS);
            let completed = fade_frames.saturating_sub(self.recovery_frames_remaining);
            sample * (completed + 1) as f32 / fade_frames as f32
        };
        self.last_frame[self.channel_index] = output;
        if self.advance_channel() && self.recovery_frames_remaining > 0 {
            self.recovery_frames_remaining -= 1;
        }
        output
    }

    fn next_underrun_sample(&mut self) -> f32 {
        let fade_frames = self.frames_for_ms(UNDERRUN_FADE_MS);
        let gain = 1.0
            - (self.underrun_frames_emitted + 1).min(fade_frames) as f32 / fade_frames as f32;
        let output = self.last_frame[self.channel_index] * gain;
        self.underrun_samples_remaining -= 1;
        if self.advance_channel() {
            self.underrun_frames_emitted += 1;
        }
        output
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    pub fn mark_finished_played(&self) {
        if self.finished {
            self.shared.mark_all_consumed();
        }
    }
}

impl Iterator for DecoderSampleReader {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.finished {
            return None;
        }
        if let Some(sample) = self.local_buffer.get(self.local_index).copied() {
            self.local_index += 1;
            return Some(self.next_audio_sample(sample));
        }
        if !self.local_buffer.is_empty() {
            self.shared
                .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
            self.local_index = 0;
        }
        if self.underrun_samples_remaining > 0 {
            return Some(self.next_underrun_sample());
        }

        // 慢速路径：从共享缓冲区非阻塞获取，跳过空数据块
        loop {
            match self.shared.try_pop() {
                // 将 FFT 样本推送给分析器
                PopResult::Chunk(mut chunk) => {
                    if self.fft.is_enabled() {
                        self.fft.push_interleaved_samples(&chunk.fft_samples);
                    }
                    self.shared
                        .recycle_fft_buffer(std::mem::take(&mut chunk.fft_samples));

                    self.shared.advance_consumed(chunk.source_sample_count);
                    if !chunk.player_samples.is_empty() {
                        debug_assert!(chunk
                            .player_samples
                            .len()
                            .is_multiple_of(usize::from(self.channels)));
                        self.local_buffer = chunk.player_samples;
                        self.local_index = 1;
                        if self.underrun_frames_emitted > 0 {
                            self.recovery_frames_remaining = self.frames_for_ms(UNDERRUN_FADE_MS);
                            self.underrun_frames_emitted = 0;
                        }
                        let sample = self.local_buffer[0];
                        return Some(self.next_audio_sample(sample));
                    }
                    self.shared.recycle_player_buffer(chunk.player_samples);
                }
                PopResult::Pending => {
                    debug_assert_eq!(self.channel_index, 0);
                    self.underrun_samples_remaining = self
                        .frames_for_ms(UNDERRUN_FADE_MS)
                        .saturating_mul(usize::from(self.channels));
                    return Some(self.next_underrun_sample());
                }
                PopResult::Finished => {
                    self.finished = true;
                    return None;
                }
            }
        }
    }
}

impl Drop for DecoderSampleReader {
    fn drop(&mut self) {
        self.shared
            .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
    }
}

/// 解码样本读取器别名，作为播放输出链路的输入类型
pub type DecoderSource = DecoderSampleReader;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::AudioChunk;

    fn assert_next_sample(source: &mut DecoderSource, expected: f32) {
        assert!((source.next().unwrap() - expected).abs() < 1e-6);
    }

    #[test]
    fn returns_preprocessed_samples_without_copying() {
        let shared = Shared::new(48_000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![0.1, -0.1, 2.0, -2.0],
            fft_samples: vec![],
            source_sample_count: 4,
        });

        let mut source = DecoderSource::new(shared, Arc::new(FftAnalyzer::new()));

        assert!((source.next().unwrap() - 0.1).abs() < 1e-6);
        assert!((source.next().unwrap() + 0.1).abs() < 1e-6);
        assert!((source.next().unwrap() - 2.0).abs() < 1e-6);
        assert!((source.next().unwrap() + 2.0).abs() < 1e-6);
    }

    #[test]
    fn replaces_non_finite_decoder_samples_with_silence() {
        let shared = Shared::new(48_000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![f32::NAN, f32::INFINITY],
            fft_samples: vec![],
            source_sample_count: 2,
        });
        let mut source = DecoderSource::new(shared, Arc::new(FftAnalyzer::new()));

        assert_eq!(source.next(), Some(0.0));
        assert_eq!(source.next(), Some(0.0));
    }

    #[test]
    fn position_uses_source_sample_count_after_tempo_processing() {
        let shared = Shared::new(1000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![0.25, -0.25],
            fft_samples: vec![],
            source_sample_count: 8,
        });
        let mut source = DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()));

        assert_eq!(source.next(), Some(0.25));
        assert!((shared.consumed_position() - 0.004).abs() < f64::EPSILON);
    }

    #[test]
    fn tempo_warmup_without_output_still_advances_source_position() {
        let shared = Shared::new(1000, 2);
        shared.push_output(AudioChunk {
            player_samples: Vec::new(),
            fft_samples: Vec::new(),
            source_sample_count: 8,
        });
        let mut source = DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()));

        assert_eq!(source.next(), Some(0.0));
        assert!((shared.consumed_position() - 0.004).abs() < f64::EPSILON);
    }

    #[test]
    fn smooths_the_edges_of_a_temporary_underrun() {
        let shared = Shared::new(1000, 2);
        shared.push_output(AudioChunk {
            player_samples: vec![1.0, -1.0],
            fft_samples: vec![],
            source_sample_count: 2,
        });
        let mut source = DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()));

        assert_next_sample(&mut source, 1.0);
        assert_next_sample(&mut source, -1.0);
        assert_next_sample(&mut source, 0.8);
        shared.push_output(AudioChunk {
            player_samples: vec![
                1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0,
            ],
            fft_samples: vec![],
            source_sample_count: 10,
        });
        for expected in [-0.8, 0.6, -0.6, 0.4, -0.4, 0.2, -0.2, 0.0, 0.0] {
            assert_next_sample(&mut source, expected);
        }
        for gain in [0.2, 0.4, 0.6, 0.8, 1.0] {
            assert_next_sample(&mut source, gain);
            assert_next_sample(&mut source, -gain);
        }
    }

    #[test]
    fn completion_waits_until_the_output_confirms_the_tail_was_played() {
        let shared = Shared::new(1000, 2);
        shared.mark_output_eof();
        let mut source = DecoderSource::new(Arc::clone(&shared), Arc::new(FftAnalyzer::new()));

        assert_eq!(source.next(), None);
        assert!(!shared.is_all_consumed());
        source.mark_finished_played();
        assert!(shared.is_all_consumed());
    }
}
