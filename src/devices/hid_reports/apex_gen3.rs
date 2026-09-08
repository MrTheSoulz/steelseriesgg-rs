//! Source-derived Apex Pro TKL Gen 3 wired (1038:1642), NOT the gated 1628 protocol.
//! OpenRGB 19112cdeff94086fa994c4a9cf45ec5786a599bf:
//! https://github.com/CalcProgrammer1/OpenRGB/blob/19112cdeff94086fa994c4a9cf45ec5786a599bf/Controllers/SteelSeriesController/SteelSeriesApexController/SteelSeriesApexController.cpp
//! https://github.com/CalcProgrammer1/OpenRGB/blob/19112cdeff94086fa994c4a9cf45ec5786a599bf/Controllers/SteelSeriesController/SteelSeriesApexRegions.h
//! Source evidence, not local physical validation. Direct colors only, no firmware effects/save/readback.
use super::{CommandCode, HidCommand, HidDeviceType};
use crate::{Error, Result, rgb::Color};
pub const REPORT_SIZE: usize = 643;

pub enum ApexGen3Command {
    Initialize,
    Solid(Color),
}
impl HidCommand for ApexGen3Command {
    fn command_code(&self) -> CommandCode {
        match self {
            Self::Initialize => CommandCode::ApexGen3Initialize,
            Self::Solid(_) => CommandCode::Apex2023Direct,
        }
    }
    fn serialize(&self, buffer: &mut [u8], device_type: HidDeviceType) -> Result<usize> {
        if device_type != HidDeviceType::Keyboard || buffer.len() < REPORT_SIZE {
            return Err(Error::DeviceCommunication(
                "Gen 3 requires a 643-byte keyboard feature report".into(),
            ));
        }
        buffer[..REPORT_SIZE].fill(0);
        buffer[1] = self.command_code() as u8;
        if let Self::Solid(color) = self {
            // The source's shared address space includes absent keys (ignored by firmware)
            // and the 0xfb ambient LED. Uniform color needs no region read/query.
            let keys = (0x04..=0x30)
                .chain(0x32..=0x52)
                .chain([0x64])
                .chain(0xe0..=0xe7)
                .chain([0xf0, 0x31])
                .chain(0x87..=0x8b)
                .chain(0x53..=0x63)
                .chain([0xfb]);
            buffer[2] = 112;
            for (entry, key) in buffer[3..451].as_chunks_mut::<4>().0.iter_mut().zip(keys) {
                entry.copy_from_slice(&[key, color.r, color.g, color.b]);
            }
        }
        Ok(REPORT_SIZE)
    }
    fn validate(&self) -> Result<()> {
        Ok(())
    }
    fn description(&self) -> String {
        "Apex Pro TKL Gen 3 wired direct lighting (source-derived)".into()
    }
}
