use anyhow::{anyhow, Result};

use super::{DeviceChangedCallback, PlatformBackend};

pub(super) struct Backend;

impl PlatformBackend for Backend {
    const SUPPORTED: bool = false;

    fn new(_callback: DeviceChangedCallback) -> Result<Self> {
        Err(anyhow!("Native audio device watching is not supported on this platform"))
    }

    fn stop(&mut self) {}
}
