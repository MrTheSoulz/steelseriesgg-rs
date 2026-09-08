//! # SSGG for Linux
//!
//! Rust device support and the local service behind the SSGG Electron desktop.
//! The desktop controls native playback streams and logical audio groups; it is
//! not a Windows Sonar replacement or a virtual DSP bus implementation.
//!
//! Device operations are capability-gated. Dedicated Nova 7 Gen 2 support and
//! source-derived Apex Pro TKL Gen 3 lighting are separate from the broader
//! inherited registry. A registry entry alone does not certify every control.
//!
//! Legacy CLI, RGB and GameSense modules remain available independently. The
//! desktop does not start a GameSense server or enable hardware automatically.
//! See the repository's installation, usage and protocol guides for evidence
//! tiers and current limitations.

pub mod config;
#[cfg(unix)]
pub mod desktop;
pub mod device_state;
pub mod devices;
pub mod diagnostics_export;
pub mod error;
pub mod fs_utils;
pub mod gamesense;
pub mod performance;
pub mod pollrate;
pub mod profiles;
pub mod rgb;
pub mod validation;

#[cfg(any(feature = "audio", feature = "sonar"))]
pub mod audio;

pub use error::{Error, Result};

/// SteelSeries USB Vendor ID (official USB-IF assignment)
/// Used to filter HID devices during enumeration
pub const STEELSERIES_VENDOR_ID: u16 = 0x1038;

/// Re-export commonly used types
pub mod prelude {
    pub use crate::devices::{Device, DeviceInfo, DeviceManager, DeviceType};
    pub use crate::error::{Error, Result};
    pub use crate::performance::{PerformanceManager, PerformanceStats};
    pub use crate::rgb::{Color, Effect, PerKeyEffect, PerKeyRgbController, RgbController};
    pub use crate::validation::{RgbValidator, ValidationReport, ValidationResult};
}
