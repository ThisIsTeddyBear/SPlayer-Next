#[cfg(target_os = "windows")]
mod imp {
    use tracing::{debug, warn};
    use windows::core::w;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Threading::{
        AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority,
        GetCurrentThread, SetThreadPriority, AVRT_PRIORITY_HIGH, THREAD_PRIORITY_HIGHEST,
    };

    pub struct RenderThreadPriority(HANDLE);

    impl RenderThreadPriority {
        pub fn new() -> Option<Self> {
            let mut task_index = 0;
            let handle = match unsafe {
                AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index)
            } {
                Ok(handle) => handle,
                Err(error) => {
                    warn!(%error, "Could not register the exclusive render thread with MMCSS");
                    boost_current_audio_thread("wasapi-exclusive-output");
                    return None;
                }
            };
            if let Err(error) = unsafe { AvSetMmThreadPriority(handle, AVRT_PRIORITY_HIGH) } {
                warn!(%error, "Could not set the exclusive render thread MMCSS priority");
            }
            debug!(task_index, "Registered exclusive render thread as MMCSS Pro Audio");
            Some(Self(handle))
        }
    }

    impl Drop for RenderThreadPriority {
        fn drop(&mut self) {
            if let Err(error) = unsafe { AvRevertMmThreadCharacteristics(self.0) } {
                warn!(%error, "Could not release the exclusive render thread MMCSS registration");
            }
        }
    }

    pub fn boost_current_audio_thread(name: &str) {
        unsafe {
            if let Err(err) = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) {
                warn!(thread = name, error = %err, "Failed to set audio thread priority");
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn boost_current_audio_thread(_name: &str) {}
}

pub use imp::boost_current_audio_thread;
#[cfg(target_os = "windows")]
pub use imp::RenderThreadPriority;
