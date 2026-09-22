#[cfg(target_os = "windows")]
mod imp {
    use tracing::warn;
    use windows::core::w;
    use windows::Win32::{
        Foundation::HANDLE,
        System::Threading::{
            AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority,
            GetCurrentThread, SetThreadPriority, AVRT_PRIORITY_HIGH, THREAD_PRIORITY_HIGHEST,
        },
    };

    /// 当前音频线程的 MMCSS 注册。析构时恢复普通调度，避免线程池复用后遗留高优先级。
    pub struct AudioThreadPriority {
        task: Option<HANDLE>,
    }

    impl Drop for AudioThreadPriority {
        fn drop(&mut self) {
            let Some(task) = self.task.take() else {
                return;
            };
            unsafe {
                if let Err(error) = AvRevertMmThreadCharacteristics(task) {
                    warn!(%error, "Failed to release MMCSS audio thread registration");
                }
            }
        }
    }

    /// 将当前音频工作线程注册为 MMCSS Pro Audio 任务。
    ///
    /// `THREAD_PRIORITY_HIGHEST` 仅提升普通调度优先级，不能在前台应用切换时保障
    /// WASAPI 周期回调。MMCSS 不可用时才保留该兼容回退。
    pub fn boost_current_audio_thread(name: &str) -> AudioThreadPriority {
        let mut task_index = 0;
        match unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index) } {
            Ok(task) => {
                if let Err(error) = unsafe { AvSetMmThreadPriority(task, AVRT_PRIORITY_HIGH) } {
                    warn!(thread = name, %error, "Failed to set MMCSS audio thread priority");
                }
                return AudioThreadPriority { task: Some(task) };
            }
            Err(error) => {
                warn!(thread = name, %error, "MMCSS Pro Audio registration unavailable");
            }
        }

        unsafe {
            if let Err(error) = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) {
                warn!(thread = name, %error, "Failed to apply fallback audio thread priority");
            }
        }
        warn!(thread = name, "Using thread-priority fallback for audio scheduling");
        AudioThreadPriority { task: None }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    /// 非 Windows 平台没有 MMCSS 注册需求。
    pub struct AudioThreadPriority;

    pub fn boost_current_audio_thread(_name: &str) -> AudioThreadPriority {
        AudioThreadPriority
    }
}

pub use imp::{boost_current_audio_thread, AudioThreadPriority};
