//!

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig, SupportedStreamConfig};
use tracing::{debug, info, warn};

use crate::decoder;
use crate::error::{AudioErrorKind, AudioResultExt};
use crate::source::DecoderSource;

#[cfg(target_os = "windows")]
mod exclusive;

pub type OutputFailureCallback = Arc<dyn Fn() + Send + Sync + 'static>;

pub enum OutputStream {
    Shared(cpal::Stream),
    #[cfg(target_os = "windows")]
    Exclusive(exclusive::ExclusiveStream),
}

impl OutputStream {
    pub fn play(&self) -> Result<()> {
        match self {
            Self::Shared(stream) => stream.play().map_err(Into::into),
            #[cfg(target_os = "windows")]
            Self::Exclusive(stream) => stream.play(),
        }
    }

    pub fn pause(&self) -> Result<()> {
        match self {
            Self::Shared(stream) => stream.pause().map_err(Into::into),
            #[cfg(target_os = "windows")]
            Self::Exclusive(stream) => stream.pause(),
        }
    }

    pub fn stop(&self) {
        #[cfg(target_os = "windows")]
        if let Self::Exclusive(stream) = self {
            stream.stop();
        }
    }
}

enum OutputBackend {
    Shared {
        device: cpal::Device,
        config: SupportedStreamConfig,
    },
    #[cfg(target_os = "windows")]
    Exclusive(exclusive::ExclusiveConfig),
}

///
pub struct AudioOutput {
    backend: OutputBackend,
    generation: u64,
    on_failure: OutputFailureCallback,
}

impl AudioOutput {
    ///
    /// # Arguments
    ///
    /// # Errors
    pub fn new(
        device_id: Option<&str>,
        requested_sample_rate: Option<u32>,
        requested_channels: Option<u16>,
        requested_bits_per_sample: Option<u32>,
        exclusive_audio: bool,
        generation: u64,
        on_failure: OutputFailureCallback,
    ) -> Result<Self> {
        #[cfg(target_os = "windows")]
        if exclusive_audio {
            let device_id = device_id.map(str::to_owned);
            let config_device_id = device_id.clone();
            let config = run_in_mta(move || {
                exclusive::ExclusiveConfig::new(
                    config_device_id.as_deref(),
                    requested_sample_rate.unwrap_or(decoder::DEFAULT_TARGET_SAMPLE_RATE),
                    requested_channels.unwrap_or(decoder::DEFAULT_OUTPUT_CHANNELS),
                    requested_bits_per_sample.unwrap_or(24),
                    true,
                )
            })
            .with_audio_kind(AudioErrorKind::Device)?;
            info!(
                device = device_id.as_deref().unwrap_or("system-default"),
                sample_rate = config.sample_rate(),
                channels = config.channels(),
                sample_format = config.sample_format_name(),
                "打开 WASAPI 独占音频输出"
            );
            return Ok(Self {
                backend: OutputBackend::Exclusive(config),
                generation,
                on_failure,
            });
        }
        #[cfg(not(target_os = "windows"))]
        let _ = exclusive_audio;

        let (device, config) = open_device(device_id, requested_sample_rate)
            .with_audio_kind(AudioErrorKind::Device)?;
        info!(
            id = device_id_string(&device).as_deref().unwrap_or("-"),
            name = %device,
            sample_rate = config.sample_rate(),
            "打开音频输出配置"
        );
        Ok(Self {
            backend: OutputBackend::Shared { device, config },
            generation,
            on_failure,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        match &self.backend {
            OutputBackend::Shared { config, .. } => config.sample_rate(),
            #[cfg(target_os = "windows")]
            OutputBackend::Exclusive(config) => config.sample_rate(),
        }
    }

    pub fn channels(&self) -> u16 {
        match &self.backend {
            OutputBackend::Shared { config, .. } => config.channels(),
            #[cfg(target_os = "windows")]
            OutputBackend::Exclusive(config) => config.channels(),
        }
    }

    pub fn is_bit_perfect(&self) -> bool {
        match &self.backend {
            OutputBackend::Shared { .. } => false,
            #[cfg(target_os = "windows")]
            OutputBackend::Exclusive(config) => config.is_bit_perfect(),
        }
    }

    pub(crate) fn build_stream(
        &self,
        source: DecoderSource,
        volume: Arc<AtomicU32>,
        stopped: Arc<AtomicBool>,
    ) -> Result<OutputStream> {
        match &self.backend {
            OutputBackend::Shared { device, config } => {
                let device = device.clone();
                let config = config.clone();
                let on_failure = Arc::clone(&self.on_failure);
                run_in_mta(move || {
                    build_typed_stream_for_format(
                        &device, &config, source, volume, stopped, on_failure,
                    )
                    .map(OutputStream::Shared)
                })
                .with_audio_kind(AudioErrorKind::Device)
            }
            #[cfg(target_os = "windows")]
            OutputBackend::Exclusive(config) => exclusive::ExclusiveStream::new(
                config.clone(),
                source,
                volume,
                stopped,
                Arc::clone(&self.on_failure),
            )
            .map(OutputStream::Exclusive)
            .with_audio_kind(AudioErrorKind::Device),
        }
    }
}

impl Drop for AudioOutput {
    fn drop(&mut self) {
        debug!(generation = self.generation, "Releasing audio output configuration");
    }
}

#[cfg(target_os = "windows")]
mod mta {
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::mpsc::{channel, sync_channel, SyncSender};
    use std::sync::OnceLock;
    use std::thread;

    use anyhow::{anyhow, Result};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    type Job = Box<dyn FnOnce() + Send + 'static>;

    static WORKER: OnceLock<Option<SyncSender<Job>>> = OnceLock::new();

    fn worker() -> Result<&'static SyncSender<Job>> {
        WORKER
            .get_or_init(|| {
                let (job_tx, job_rx) = sync_channel::<Job>(1);
                thread::Builder::new()
                    .name("audio-mta-worker".into())
                    .spawn(move || {
                        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                        for job in job_rx {
                            let _ = catch_unwind(AssertUnwindSafe(job));
                        }
                    })
                    .ok()
                    .map(|_| job_tx)
            })
            .as_ref()
            .ok_or_else(|| anyhow!("Failed to start the MTA thread"))
    }

    pub(super) fn run<T: Send + 'static>(
        f: impl FnOnce() -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (result_tx, result_rx) = channel();
        worker()?
            .send(Box::new(move || {
                let _ = result_tx.send(f());
            }))
            .map_err(|_| anyhow!("The MTA thread has exited"))?;
        result_rx.recv().map_err(|_| anyhow!("The MTA thread panicked"))?
    }
}

#[cfg(target_os = "windows")]
use mta::run as run_in_mta;

#[cfg(not(target_os = "windows"))]
fn run_in_mta<T, F: FnOnce() -> Result<T>>(f: F) -> Result<T> {
    f()
}

fn persisted_device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|desc| desc.name().to_owned())
}

fn device_id_string(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn is_synthetic_default_device(name: &str) -> bool {
    cfg!(target_os = "linux") && matches!(name, "default_output" | "default_sink")
}

///
fn find_device(host: &cpal::Host, selector: &str) -> Option<cpal::Device> {
    if let Ok(parsed) = selector.parse::<cpal::DeviceId>() {
        return host.device_by_id(&parsed);
    }
    host.output_devices()
        .ok()?
        .find(|device| persisted_device_name(device).as_deref() == Some(selector))
}

pub fn list_output_devices() -> Vec<(String, String, bool)> {
    run_in_mta(|| {
        let host = cpal::default_host();
        let default_id = host
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        let list = host
            .output_devices()
            .map(|devices| {
                devices
                    .filter_map(|device| {
                        let name = persisted_device_name(&device)?;
                        if is_synthetic_default_device(&name) {
                            return None;
                        }
                        let id = device_id_string(&device)?;
                        let is_default = default_id.as_deref() == Some(id.as_str());
                        Some((id, name, is_default))
                    })
                    .collect()
            })
            .unwrap_or_default();
        debug!(
            default_id = default_id.as_deref().unwrap_or("-"),
            devices = ?list,
            "枚举音频输出设备"
        );
        Ok(list)
    })
    .unwrap_or_default()
}

pub fn default_device_name() -> Option<String> {
    run_in_mta(|| {
        let name = cpal::default_host()
            .default_output_device()
            .and_then(|device| persisted_device_name(&device));
        Ok(name)
    })
    .unwrap_or_default()
}

pub fn default_device_id() -> Option<String> {
    run_in_mta(|| {
        let id = cpal::default_host()
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        Ok(id)
    })
    .unwrap_or_default()
}

fn open_device_internal(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
) -> Result<(cpal::Device, SupportedStreamConfig)> {
    let host = cpal::default_host();
    let device = match device_id {
        Some(selector) => {
            find_device(&host, selector).with_context(|| format!("Output device '{selector}' was not found"))?
        }
        None => {
            let default = host.default_output_device().context("No output device is available")?;
            let default_id = device_id_string(&default).context("Failed to read the default output device ID")?;
            find_device(&host, &default_id).context("Failed to resolve the default output device endpoint")?
        }
    };
    let default_config = device
        .default_output_config()
        .context("Failed to read the output device configuration")?;
    #[cfg(target_os = "windows")]
    {
        let _ = requested_sample_rate;
        Ok((device, default_config))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let config = match requested_sample_rate {
            Some(rate) => {
                if rate == default_config.sample_rate() {
                    default_config
                } else {
                    let default_format = default_config.sample_format();
                    let default_channels = default_config.channels();
                    let at_rate = device.supported_output_configs().ok().and_then(|configs| {
                        let configs: Vec<_> = configs.collect();
                        configs
                            .iter()
                            .copied()
                            .find(|range| {
                                range.min_sample_rate() <= rate
                                    && rate <= range.max_sample_rate()
                                    && range.sample_format() == default_format
                                    && range.channels() == default_channels
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                        && range.sample_format() == default_format
                                })
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                        && range.channels() == default_channels
                                })
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                })
                            })
                            .map(|range| range.with_sample_rate(rate))
                    });
                    at_rate.unwrap_or(default_config)
                }
            }
            None => default_config,
        };
        Ok((device, config))
    }
}

fn open_device(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
) -> Result<(cpal::Device, SupportedStreamConfig)> {
    let id_owned = device_id.map(String::from);
    run_in_mta(move || open_device_internal(id_owned.as_deref(), requested_sample_rate))
}

fn build_typed_stream_for_format(
    device: &cpal::Device,
    config: &SupportedStreamConfig,
    source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    on_failure: OutputFailureCallback,
) -> Result<cpal::Stream> {
    let sample_format = config.sample_format();
    let config: StreamConfig = config.config();
    macro_rules! build {
        ($sample:ty) => {
            build_typed_stream::<$sample>(device, config, source, volume, stopped, on_failure)
        };
    }
    match sample_format {
        SampleFormat::I8 => build!(i8),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I24 => build!(cpal::I24),
        SampleFormat::I32 => build!(i32),
        SampleFormat::I64 => build!(i64),
        SampleFormat::U8 => build!(u8),
        SampleFormat::U16 => build!(u16),
        SampleFormat::U32 => build!(u32),
        SampleFormat::U64 => build!(u64),
        SampleFormat::F32 => build!(f32),
        SampleFormat::F64 => build!(f64),
        _ => Err(anyhow!("Unsupported output sample format: {sample_format}")),
    }
}

fn build_typed_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    on_failure: OutputFailureCallback,
) -> Result<cpal::Stream>
where
    T: SizedSample + Sample + FromSample<f32>,
{
    let stream = device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            let gain = f32::from_bits(volume.load(Ordering::Relaxed));
            if stopped.load(Ordering::Acquire) {
                data.fill(T::EQUILIBRIUM);
                return;
            }
            for output in data {
                *output = T::from_sample(source.next().unwrap_or(0.0) * gain);
            }
        },
        move |error| {
            let err_msg = error.to_string();
            let invalidated =
                err_msg.contains("no longer valid") || err_msg.contains("-2004287484");
            if invalidated {
                info!("Audio output stream became invalid after a device change; rebuilding");
            } else {
                warn!(%error, "Audio output stream failed");
            }
            on_failure();
        },
        None,
    )?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_synthetic_default_devices_from_the_selectable_list() {
        assert_eq!(
            is_synthetic_default_device("default_output"),
            cfg!(target_os = "linux")
        );
        assert_eq!(
            is_synthetic_default_device("default_sink"),
            cfg!(target_os = "linux")
        );
    }

    #[test]
    fn keeps_real_devices_in_the_selectable_list() {
        assert!(!is_synthetic_default_device("Built-in Audio Analog Stereo"));
        assert!(!is_synthetic_default_device("Speakers (Realtek(R) Audio)"));
    }

    #[test]
    fn legacy_display_names_do_not_parse_as_device_ids() {
        assert!("Speakers (Realtek(R) Audio)"
            .parse::<cpal::DeviceId>()
            .is_err());
        assert!("Built-in Audio Analog Stereo"
            .parse::<cpal::DeviceId>()
            .is_err());
        assert!("AppleHDAEngineOutput:1B,0,1,0:0"
            .parse::<cpal::DeviceId>()
            .is_err());
    }
}
