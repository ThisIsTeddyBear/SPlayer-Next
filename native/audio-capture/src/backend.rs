
use std::fmt;
use std::sync::Arc;

use napi::bindgen_prelude::Buffer;
use tracing::{debug, info};

use crate::JsCaptureEvent;

pub type CaptureEmitter = Arc<dyn Fn(JsCaptureEvent) + Send + Sync>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CaptureSource {
    System,
    Microphone,
}

#[derive(Clone)]
pub struct CaptureConfig {
    pub source: CaptureSource,
    pub duration_ms: u32,
}

#[derive(Debug)]
pub enum BackendError {
    #[allow(dead_code)]
    Unsupported,
    NoDevice,
    #[allow(dead_code)]
    PermissionDenied,
    CaptureFailed(String),
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(f, "Native audio capture is not supported on this platform"),
            Self::NoDevice => write!(f, "No audio capture device is available"),
            Self::PermissionDenied => write!(f, "Audio capture permission is required"),
            Self::CaptureFailed(msg) => write!(f, "{msg}"),
        }
    }
}

impl BackendError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::NoDevice => "no-device",
            Self::PermissionDenied => "permission-denied",
            Self::CaptureFailed(_) => "capture-failed",
        }
    }
}

pub const TARGET_SAMPLE_RATE: u32 = 8000;

const LEVEL_INTERVAL_MS: u32 = 100;

pub trait CaptureBackend: Send + Sync {
    fn sample_rate(&self) -> u32;
    fn run(&self, sink: &mut CaptureSink) -> Result<(), BackendError>;
    fn cancel(&self);
    fn is_cancelled(&self) -> bool;
}

pub struct CaptureSink {
    emitter: CaptureEmitter,
    mono: Vec<f32>,
    sample_rate: u32,
    duration_ms: u32,
    target_samples: usize,
    level_energy: f64,
    level_count: usize,
    level_pending: usize,
    level_interval: usize,
    next_snapshot_seconds: u32,
}

impl CaptureSink {
    pub fn new(emitter: CaptureEmitter, sample_rate: u32, duration_ms: u32) -> Self {
        let mut sink = Self {
            emitter,
            mono: Vec::new(),
            sample_rate,
            duration_ms,
            target_samples: 0,
            level_energy: 0.0,
            level_count: 0,
            level_pending: 0,
            level_interval: 1,
            next_snapshot_seconds: 3,
        };
        sink.set_sample_rate(sample_rate);
        sink.mono.reserve(sink.target_samples);
        sink
    }

    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        self.sample_rate = sample_rate;
        self.target_samples = (sample_rate as u64 * self.duration_ms as u64 / 1000) as usize;
        self.level_interval = (sample_rate as u64 * LEVEL_INTERVAL_MS as u64 / 1000) as usize;
    }

    pub fn push_mono(&mut self, samples: &[f32]) {
        for &s in samples {
            self.level_energy += (s as f64) * (s as f64);
            self.level_count += 1;
            self.level_pending += 1;
            if self.level_pending >= self.level_interval {
                self.emit_level();
            }
        }
        self.mono.extend_from_slice(samples);
        self.emit_ready_snapshots();
    }

    pub fn push_silence(&mut self, frames: usize) {
        for _ in 0..frames {
            self.level_pending += 1;
            if self.level_pending >= self.level_interval {
                self.emit_level();
            }
        }
        self.mono.extend(std::iter::repeat_n(0.0f32, frames));
        self.emit_ready_snapshots();
    }

    pub fn ready(&self) -> bool {
        self.mono.len() >= self.target_samples
    }

    pub fn pad_to_target(&mut self) {
        let remaining = self.target_samples.saturating_sub(self.mono.len());
        if remaining > 0 {
            self.push_silence(remaining);
        }
    }

    fn emit_level(&mut self) {
        let level = if self.level_count == 0 {
            0.0
        } else {
            (self.level_energy / self.level_count as f64).sqrt()
        };
        self.level_energy = 0.0;
        self.level_count = 0;
        self.level_pending = 0;
        (self.emitter)(JsCaptureEvent {
            event_type: "level".into(),
            data: None,
            level: Some(level),
            error: None,
            error_code: None,
            sample_rate: None,
        });
    }

    fn emit_ready_snapshots(&mut self) {
        while self.next_snapshot_seconds * 1000 <= self.duration_ms {
            let sample_count = self.sample_rate as usize * self.next_snapshot_seconds as usize;
            if self.mono.len() < sample_count {
                break;
            }
            let mut bytes = Vec::with_capacity(sample_count * 4);
            for sample in &self.mono[..sample_count] {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            (self.emitter)(JsCaptureEvent {
                event_type: "snapshot".into(),
                data: Some(Buffer::from(bytes)),
                level: None,
                error: None,
                error_code: None,
                sample_rate: Some(self.sample_rate),
            });
            self.next_snapshot_seconds += 3;
        }
    }

    pub fn emit_done(&mut self, cancelled: bool) {
        debug!(samples = self.mono.len(), "Capture complete; starting downsampling");
        let data = if cancelled {
            None
        } else {
            let mono_8k = downsample_mono(&self.mono, self.sample_rate, TARGET_SAMPLE_RATE);
            info!(samples = mono_8k.len(), "Capture complete; returning 8 kHz PCM");
            let mut bytes = Vec::with_capacity(mono_8k.len() * 4);
            for v in mono_8k {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            Some(Buffer::from(bytes))
        };
        (self.emitter)(JsCaptureEvent {
            event_type: "done".into(),
            data,
            level: None,
            error: None,
            error_code: None,
            sample_rate: None,
        });
        self.mono.clear();
    }

    pub fn emit_error(&self, error: BackendError) {
        tracing::error!(%error, code = error.code(), "Audio capture failed");
        (self.emitter)(JsCaptureEvent {
            event_type: "error".into(),
            data: None,
            level: None,
            error: Some(error.to_string()),
            error_code: Some(error.code().into()),
            sample_rate: None,
        });
    }
}

fn downsample_mono(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if input.is_empty() || in_rate <= out_rate {
        return input.to_vec();
    }
    let ratio = in_rate as f64 / out_rate as f64;
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let start = (i as f64 * ratio) as usize;
        let end = (((i + 1) as f64) * ratio).ceil() as usize;
        let end = end.min(input.len());
        let mut sum = 0.0f32;
        let mut count = 0usize;
        for &v in &input[start..end] {
            sum += v;
            count += 1;
        }
        out.push(sum / count.max(1) as f32);
    }
    out
}
