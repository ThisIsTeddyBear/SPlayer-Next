use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    mpsc, Arc,
};
use std::thread;

use anyhow::{bail, Context, Result};
use windows::core::{GUID, PCWSTR};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_EVENT, WAIT_OBJECT_0, WAIT_TIMEOUT},
    Media::Audio::{
        eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
    },
    System::{
        Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED},
        Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, INFINITE},
    },
};

use crate::audio_output::OutputFailureCallback;
use crate::priority;
use crate::source::DecoderSource;

const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
/// Windows 声道掩码位。
const SPEAKER_FRONT_LEFT: u32 = 0x1;
const SPEAKER_FRONT_RIGHT: u32 = 0x2;
const SPEAKER_FRONT_CENTER: u32 = 0x4;
const KSDATAFORMAT_SUBTYPE_PCM: GUID =
    GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

#[derive(Clone, Copy)]
enum ExclusiveSampleFormat {
    Pcm16,
    Pcm24,
    Pcm32,
    Float32,
}

impl ExclusiveSampleFormat {
    fn bits_per_sample(self) -> u16 {
        match self {
            Self::Pcm16 => 16,
            Self::Pcm24 | Self::Pcm32 | Self::Float32 => 32,
        }
    }

    fn valid_bits_per_sample(self) -> u16 {
        match self {
            Self::Pcm16 => 16,
            Self::Pcm24 => 24,
            Self::Pcm32 | Self::Float32 => 32,
        }
    }

    fn sub_format(self) -> GUID {
        match self {
            Self::Float32 => KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
            Self::Pcm16 | Self::Pcm24 | Self::Pcm32 => KSDATAFORMAT_SUBTYPE_PCM,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Pcm16 => "pcm16",
            Self::Pcm24 => "pcm24",
            Self::Pcm32 => "pcm32",
            Self::Float32 => "f32",
        }
    }
}

/// 独占流的协商结果。只保存值类型，实际 COM 对象只在输出线程使用。
#[derive(Clone)]
pub struct ExclusiveConfig {
    device_id: Option<String>,
    sample_rate: u32,
    channels: u16,
    sample_format: ExclusiveSampleFormat,
}

impl ExclusiveConfig {
    pub fn new(
        device_id: Option<&str>,
        sample_rate: u32,
        source_channels: u16,
        source_bits_per_sample: u32,
    ) -> Result<Self> {
        if sample_rate == 0 || source_channels == 0 {
            bail!("独占音频需要有效的采样率和声道数");
        }

        let device = open_device(device_id)?;
        let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
            .context("激活独占音频设备失败")?;
        let channels = candidate_channels(source_channels);
        let formats = candidate_formats(source_bits_per_sample);

        for channels in channels {
            for sample_format in formats {
                let config = Self {
                    device_id: device_id.map(str::to_owned),
                    sample_rate,
                    channels,
                    sample_format,
                };
                let wave_format = config.wave_format();
                let supported = unsafe {
                    client.IsFormatSupported(
                        AUDCLNT_SHAREMODE_EXCLUSIVE,
                        &wave_format as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX,
                        None,
                    )
                }
                .is_ok();
                if supported {
                    return Ok(config);
                }
            }
        }

        bail!(
            "所选输出设备不支持 {} Hz 的独占播放格式；请关闭其他占用音频的应用，或选择支持该采样率的设备",
            sample_rate
        )
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn sample_format_name(&self) -> &'static str {
        self.sample_format.name()
    }

    fn wave_format(&self) -> WAVEFORMATEXTENSIBLE {
        let bits_per_sample = self.sample_format.bits_per_sample();
        let block_align = self.channels * (bits_per_sample / 8);
        WAVEFORMATEXTENSIBLE {
            Format: WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_EXTENSIBLE,
                nChannels: self.channels,
                nSamplesPerSec: self.sample_rate,
                nAvgBytesPerSec: self.sample_rate * u32::from(block_align),
                nBlockAlign: block_align,
                wBitsPerSample: bits_per_sample,
                cbSize: 22,
            },
            Samples: WAVEFORMATEXTENSIBLE_0 {
                wValidBitsPerSample: self.sample_format.valid_bits_per_sample(),
            },
            dwChannelMask: channel_mask(self.channels),
            SubFormat: self.sample_format.sub_format(),
        }
    }
}

fn channel_mask(channels: u16) -> u32 {
    match channels {
        1 => SPEAKER_FRONT_CENTER,
        2 => SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT,
        _ => 0,
    }
}

fn candidate_channels(source_channels: u16) -> Vec<u16> {
    match source_channels {
        1 => vec![2, 1],
        2 => vec![2],
        _ => vec![source_channels, 2],
    }
}

fn candidate_formats(source_bits_per_sample: u32) -> &'static [ExclusiveSampleFormat] {
    match source_bits_per_sample {
        0..=16 => &[
            ExclusiveSampleFormat::Pcm16,
            ExclusiveSampleFormat::Float32,
            ExclusiveSampleFormat::Pcm24,
            ExclusiveSampleFormat::Pcm32,
        ],
        17..=24 => &[
            ExclusiveSampleFormat::Pcm24,
            ExclusiveSampleFormat::Float32,
            ExclusiveSampleFormat::Pcm32,
            ExclusiveSampleFormat::Pcm16,
        ],
        _ => &[
            ExclusiveSampleFormat::Pcm32,
            ExclusiveSampleFormat::Float32,
            ExclusiveSampleFormat::Pcm24,
            ExclusiveSampleFormat::Pcm16,
        ],
    }
}

fn open_device(device_id: Option<&str>) -> Result<IMMDevice> {
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .context("创建音频设备枚举器失败")?;
    match device_id {
        Some(device_id) => {
            let endpoint_id = device_id
                .strip_prefix("wasapi:")
                .context("独占音频仅支持 WASAPI 输出设备")?;
            let wide_id: Vec<u16> = endpoint_id.encode_utf16().chain(Some(0)).collect();
            unsafe { enumerator.GetDevice(PCWSTR(wide_id.as_ptr())) }
                .with_context(|| format!("输出设备 '{device_id}' 不存在"))
        }
        None => unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
            .context("没有可用的默认输出设备"),
    }
}

struct ComApartmentGuard;

impl ComApartmentGuard {
    fn init() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .context("初始化独占音频 COM 线程失败")?;
        Ok(Self)
    }
}

impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

struct StreamControl {
    playing: AtomicBool,
    stopped: AtomicBool,
    control_event: HANDLE,
}

// Windows 事件句柄允许控制线程发信号，同时由输出线程等待。
unsafe impl Send for StreamControl {}
unsafe impl Sync for StreamControl {}

impl Drop for StreamControl {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.control_event);
        }
    }
}

/// WASAPI 独占输出流。COM 接口始终由同一输出线程拥有，跨线程只传递原子控制信号。
pub struct ExclusiveStream {
    control: Arc<StreamControl>,
    thread: Option<thread::JoinHandle<()>>,
}

impl ExclusiveStream {
    pub fn new(
        config: ExclusiveConfig,
        source: DecoderSource,
        volume: Arc<AtomicU32>,
        stopped: Arc<AtomicBool>,
        on_failure: OutputFailureCallback,
    ) -> Result<Self> {
        let control_event = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }
            .context("创建独占音频控制事件失败")?;
        let control = Arc::new(StreamControl {
            playing: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            control_event,
        });
        let worker_control = Arc::clone(&control);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("wasapi-exclusive-output".into())
            .spawn(move || {
                let result = run_stream(
                    config,
                    source,
                    volume,
                    stopped,
                    Arc::clone(&worker_control),
                    ready_tx.clone(),
                );
                if let Err(error) = result {
                    if ready_tx.send(Err(error.to_string())).is_err() {
                        on_failure();
                    }
                }
            })
            .context("启动独占音频输出线程失败")?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                control,
                thread: Some(worker),
            }),
            Ok(Err(error)) => {
                control.stopped.store(true, Ordering::Release);
                let _ = unsafe { SetEvent(control.control_event) };
                let _ = worker.join();
                bail!("初始化独占音频输出失败: {error}")
            }
            Err(_) => {
                control.stopped.store(true, Ordering::Release);
                let _ = unsafe { SetEvent(control.control_event) };
                let _ = worker.join();
                bail!("独占音频输出线程在初始化前退出")
            }
        }
    }

    pub fn play(&self) -> Result<()> {
        self.control.playing.store(true, Ordering::Release);
        unsafe { SetEvent(self.control.control_event) }.context("恢复独占音频输出失败")
    }

    pub fn pause(&self) -> Result<()> {
        self.control.playing.store(false, Ordering::Release);
        unsafe { SetEvent(self.control.control_event) }.context("暂停独占音频输出失败")
    }

    pub fn stop(&self) {
        self.control.stopped.store(true, Ordering::Release);
        let _ = unsafe { SetEvent(self.control.control_event) };
    }
}

impl Drop for ExclusiveStream {
    fn drop(&mut self) {
        self.stop();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run_stream(
    config: ExclusiveConfig,
    mut source: DecoderSource,
    volume: Arc<AtomicU32>,
    stopped: Arc<AtomicBool>,
    control: Arc<StreamControl>,
    ready_tx: mpsc::SyncSender<std::result::Result<(), String>>,
) -> Result<()> {
    let _com = ComApartmentGuard::init()?;
    priority::boost_current_audio_thread("wasapi-exclusive-output");
    let device = open_device(config.device_id.as_deref())?;
    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
        .context("激活独占音频设备失败")?;
    let wave_format = config.wave_format();
    let mut period_hns = 0;
    unsafe { client.GetDevicePeriod(Some(&mut period_hns), None) }
        .context("读取独占音频设备周期失败")?;
    if period_hns <= 0 {
        bail!("独占音频设备返回了无效周期");
    }
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            period_hns,
            period_hns,
            &wave_format as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX,
            None,
        )
    }
    .context("设备拒绝独占音频输出")?;

    let buffer_frames = unsafe { client.GetBufferSize() }.context("读取独占音频缓冲区失败")?;
    let render_client: IAudioRenderClient =
        unsafe { client.GetService() }.context("获取独占音频渲染接口失败")?;
    let audio_event = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }
        .context("创建独占音频事件失败")?;
    if let Err(error) = unsafe { client.SetEventHandle(audio_event) } {
        unsafe {
            let _ = CloseHandle(audio_event);
        }
        return Err(error).context("设置独占音频事件失败");
    }

    ready_tx
        .send(Ok(()))
        .map_err(|_| anyhow::anyhow!("独占音频初始化结果接收端已关闭"))?;
    run_loop(
        &client,
        &render_client,
        audio_event,
        buffer_frames,
        config.channels,
        config.sample_format,
        &mut source,
        &volume,
        &stopped,
        &control,
    )
}

#[allow(clippy::too_many_arguments)]
fn run_loop(
    client: &IAudioClient,
    render_client: &IAudioRenderClient,
    audio_event: HANDLE,
    buffer_frames: u32,
    channels: u16,
    sample_format: ExclusiveSampleFormat,
    source: &mut DecoderSource,
    volume: &AtomicU32,
    stopped: &AtomicBool,
    control: &StreamControl,
) -> Result<()> {
    struct AudioEvent(HANDLE);

    impl Drop for AudioEvent {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    let _audio_event = AudioEvent(audio_event);
    let mut running = false;
    let handles = [audio_event, control.control_event];

    loop {
        let wait = unsafe { WaitForMultipleObjects(&handles, false, INFINITE) };
        if wait == WAIT_EVENT(WAIT_OBJECT_0.0 + 1) {
            if control.stopped.load(Ordering::Acquire) || stopped.load(Ordering::Acquire) {
                if running {
                    stop_client(client)?;
                }
                return Ok(());
            }
            if control.playing.load(Ordering::Acquire) && !running {
                write_buffer(
                    render_client,
                    buffer_frames,
                    channels,
                    sample_format,
                    source,
                    volume,
                )?;
                unsafe { client.Start() }.context("启动独占音频输出失败")?;
                running = true;
            } else if !control.playing.load(Ordering::Acquire) && running {
                stop_client(client)?;
                running = false;
            }
            continue;
        }
        if wait == WAIT_OBJECT_0 {
            if running {
                write_buffer(
                    render_client,
                    buffer_frames,
                    channels,
                    sample_format,
                    source,
                    volume,
                )?;
            }
            continue;
        }
        if wait == WAIT_TIMEOUT {
            continue;
        }
        bail!("等待独占音频事件失败");
    }
}

fn stop_client(client: &IAudioClient) -> Result<()> {
    unsafe { client.Stop() }.context("停止独占音频输出失败")?;
    unsafe { client.Reset() }.context("重置独占音频缓冲区失败")
}

fn write_buffer(
    render_client: &IAudioRenderClient,
    frames: u32,
    channels: u16,
    sample_format: ExclusiveSampleFormat,
    source: &mut DecoderSource,
    volume: &AtomicU32,
) -> Result<()> {
    let buffer = unsafe { render_client.GetBuffer(frames) }.context("获取独占音频缓冲区失败")?;
    let gain = f32::from_bits(volume.load(Ordering::Relaxed));
    let samples = match sample_format {
        ExclusiveSampleFormat::Pcm16 => {
            let output = unsafe {
                std::slice::from_raw_parts_mut(
                    buffer.cast::<i16>(),
                    frames as usize * channels as usize,
                )
            };
            for value in output {
                *value = to_i16(source.next().unwrap_or(0.0) * gain);
            }
            output.len()
        }
        ExclusiveSampleFormat::Pcm24 => {
            let output = unsafe {
                std::slice::from_raw_parts_mut(
                    buffer.cast::<i32>(),
                    frames as usize * channels as usize,
                )
            };
            for value in output {
                *value = to_i24_in_i32(source.next().unwrap_or(0.0) * gain);
            }
            output.len()
        }
        ExclusiveSampleFormat::Pcm32 => {
            let output = unsafe {
                std::slice::from_raw_parts_mut(
                    buffer.cast::<i32>(),
                    frames as usize * channels as usize,
                )
            };
            for value in output {
                *value = to_i32(source.next().unwrap_or(0.0) * gain);
            }
            output.len()
        }
        ExclusiveSampleFormat::Float32 => {
            let output = unsafe {
                std::slice::from_raw_parts_mut(
                    buffer.cast::<f32>(),
                    frames as usize * channels as usize,
                )
            };
            for value in output {
                *value = source.next().unwrap_or(0.0) * gain;
            }
            output.len()
        }
    };
    debug_assert_eq!(samples, frames as usize * channels as usize);
    unsafe { render_client.ReleaseBuffer(frames, 0) }.context("提交独占音频缓冲区失败")
}

fn to_i16(value: f32) -> i16 {
    if value <= -1.0 {
        i16::MIN
    } else {
        (value.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
    }
}

fn to_i24_in_i32(value: f32) -> i32 {
    if value <= -1.0 {
        i32::MIN
    } else {
        ((value.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32) << 8
    }
}

fn to_i32(value: f32) -> i32 {
    if value <= -1.0 {
        i32::MIN
    } else {
        (value.clamp(-1.0, 1.0) * i32::MAX as f32).round() as i32
    }
}
