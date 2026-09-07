use steelseries_gg::devices::headsets::nova7_gen2::{Report, decode_report};
use steelseries_gg::devices::{DeviceType, device_name_from_product_id, device_type_from_product_id};

#[test]
fn decodes_percentage_status_and_rejects_malformed_reports() {
    // Synthetic protocol fixtures, not a recording from the user's headset.
    let Report::Status(status) = decode_report(&[0xb0, 3, 73, 3, 100, 40]).unwrap() else {
        panic!("expected status");
    };
    assert_eq!(status.battery_percent, Some(73));
    assert_eq!(status.connected, Some(true));
    assert_eq!(status.charging, Some(false));
    assert_eq!(status.chatmix.game_percent, 100);
    assert_eq!(status.chatmix.chat_percent, 40);
    for bad in [
        &[][..],
        &[0xb0, 3, 73, 3, 100][..],
        &[0xb0, 3, 101, 3, 100, 40],
        &[0xb0, 3, 70, 3, 101, 40],
    ] {
        assert!(decode_report(bad).is_err(), "accepted {bad:?}");
    }
    assert!(matches!(decode_report(&[0xfe, 0]).unwrap(), Report::Unknown(0xfe)));
}

#[test]
fn wheel_events_are_absolute_gains_not_relative_scroll() {
    let Report::ChatMix(mix) = decode_report(&[0x45, 100, 0]).unwrap() else {
        panic!("wheel");
    };
    assert_eq!(mix.balance(), -1.0);
    let Report::ChatMix(mix) = decode_report(&[0x45, 0, 100]).unwrap() else {
        panic!("wheel");
    };
    assert_eq!(mix.balance(), 1.0);
    let Report::ChatMix(mix) = decode_report(&[0x45, 100, 100]).unwrap() else {
        panic!("wheel");
    };
    assert_eq!(mix.balance(), 0.0);
    assert!(decode_report(&[0x45, 100]).is_err());
    assert!(decode_report(&[0x45, 100, 255]).is_err());
}

#[test]
fn builds_model_specific_commands_with_explicit_report_id_and_lengths() {
    use steelseries_gg::devices::hid_reports::{HidDeviceType, HidReportBuilder, Nova7Gen2Command};
    let builder = HidReportBuilder::new(HidDeviceType::Headset);
    let mut buffer = [0xaa; 64];
    assert_eq!(
        builder.build_nova7_gen2(Nova7Gen2Command::Status, &mut buffer).unwrap(),
        2
    );
    assert_eq!(&buffer[..2], &[0, 0xb0]);
    for (cmd, prefix) in [
        (Nova7Gen2Command::AudioSettings, vec![0, 0x20]),
        (Nova7Gen2Command::Sidetone(3), vec![0, 0x39, 3]),
        (Nova7Gen2Command::Save, vec![0, 9]),
        (Nova7Gen2Command::AutoOff(30), vec![0, 0xa3, 30]),
    ] {
        assert_eq!(builder.build_nova7_gen2(cmd, &mut buffer).unwrap(), 64);
        assert_eq!(&buffer[..prefix.len()], prefix);
        assert!(buffer[prefix.len()..].iter().all(|b| *b == 0));
    }
    assert!(
        builder
            .build_nova7_gen2(Nova7Gen2Command::Sidetone(4), &mut buffer)
            .is_err()
    );
    assert!(builder.build_nova7_gen2(Nova7Gen2Command::Save, &mut [0; 2]).is_err());
    assert!(
        HidReportBuilder::new(HidDeviceType::Keyboard)
            .build_nova7_gen2(Nova7Gen2Command::Save, &mut buffer)
            .is_err()
    );
}

#[test]
fn nova7_gen2_is_recognized_without_aliasing_gen1() {
    assert_eq!(steelseries_gg::devices::zone_count_for_product_id(0x227e), 0);
    assert_eq!(device_type_from_product_id(0x227e), DeviceType::Headset);
    assert_eq!(device_name_from_product_id(0x227e), "Arctis Nova 7 Gen 2");
    assert_ne!(device_name_from_product_id(0x2202), device_name_from_product_id(0x227e));
}

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use steelseries_gg::Result;
use steelseries_gg::devices::headsets::nova7_gen2::{Nova7Gen2, Transport};

#[derive(Default)]
struct MockIo {
    writes: Arc<Mutex<Vec<Vec<u8>>>>,
    reports: VecDeque<Vec<u8>>,
    short_write: bool,
}
impl Transport for MockIo {
    fn write(&mut self, data: &[u8]) -> Result<usize> {
        self.writes.lock().unwrap().push(data.to_vec());
        Ok(if self.short_write { 0 } else { data.len() })
    }
    fn read_timeout(&mut self, data: &mut [u8], _: i32) -> Result<usize> {
        match self.reports.pop_front() {
            Some(report) => {
                data[..report.len()].copy_from_slice(&report);
                Ok(report.len())
            }
            None => Ok(0),
        }
    }
}
fn info() -> steelseries_gg::devices::DeviceInfo {
    steelseries_gg::devices::DeviceInfo {
        name: "Arctis Nova 7 Gen 2".into(),
        device_type: DeviceType::Headset,
        vendor_id: 0x1038,
        product_id: 0x227e,
        interface_number: 3,
        usage_page: 0xffc0,
        usage: 1,
        serial_number: None,
        manufacturer: None,
        path: "mock-only".into(),
    }
}

#[test]
fn query_demultiplexes_wheel_and_status_without_losing_sample() {
    let io = MockIo {
        reports: VecDeque::from([vec![0x45, 100, 30], vec![0xb0, 3, 60, 1, 100, 30]]),
        ..Default::default()
    };
    let writes = io.writes.clone();
    let mut device = Nova7Gen2::new(info(), io).unwrap();
    assert!(
        writes.lock().unwrap().is_empty(),
        "construction must not initialize hardware"
    );
    let status = device.request_status().unwrap();
    assert_eq!(status.battery_percent, Some(60));
    assert_eq!(status.charging, Some(true));
    assert_eq!(device.last_chatmix().unwrap().chat_percent, 30);
    assert_eq!(*writes.lock().unwrap(), vec![vec![0, 0xb0]]);
    assert_eq!(device.read_event(0).unwrap(), None);
    assert!(
        device.request_status().is_err(),
        "timeout must not become center/battery zero"
    );
    let mut invalid = info();
    invalid.interface_number = 4;
    assert!(Nova7Gen2::new(invalid, MockIo::default()).is_err());
    let mut invalid = info();
    invalid.product_id = 0x2202;
    assert!(Nova7Gen2::new(invalid, MockIo::default()).is_err());
    let mut invalid = info();
    invalid.usage_page = 1;
    assert!(Nova7Gen2::new(invalid, MockIo::default()).is_err());
    let mut short = Nova7Gen2::new(
        info(),
        MockIo {
            short_write: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(short.request_status().is_err());
}

use steelseries_gg::devices::Device;
use steelseries_gg::devices::headsets::{EqPreset, Headset};

#[test]
fn settings_use_gen2_save_and_unsupported_features_never_write() {
    let io = MockIo {
        reports: VecDeque::from([vec![0xb0, 3, 80, 3, 100, 100], vec![0x20, 0, 2, 0]]),
        ..Default::default()
    };
    let writes = io.writes.clone();
    let mut device = Nova7Gen2::new(info(), io).unwrap();
    assert_eq!(device.info().product_id, 0x227e);
    device.initialize().unwrap();
    assert!(writes.lock().unwrap().is_empty());
    assert_eq!(device.sidetone_level().unwrap(), 2);
    device.set_sidetone_level(3).unwrap();
    device.set_auto_off(30).unwrap();
    let sent = writes.lock().unwrap().clone();
    assert_eq!(sent.len(), 4);
    assert_eq!(&sent[0][..2], &[0, 0x20]);
    assert_eq!(&sent[1][..3], &[0, 0x39, 3]);
    assert_eq!(&sent[2][..2], &[0, 9]);
    assert_eq!(&sent[3][..3], &[0, 0xa3, 30]);
    assert!(device.set_sidetone_level(4).is_err());
    assert!(device.set_sidetone(101).is_err());
    assert!(device.set_eq_preset(EqPreset::Flat).is_err());
    assert!(device.set_mic_mute(true).is_err());
    assert!(device.set_mic_volume(50).is_err());
    assert!(device.send_raw(&[0, 0x21, 255]).is_err());
    assert_eq!(writes.lock().unwrap().len(), 4);
    let caps = device.capabilities();
    assert!(caps.battery && caps.physical_chatmix && caps.sidetone && caps.auto_off);
    assert!(!caps.rgb && !caps.hardware_eq && !caps.mic_mute && !caps.mic_volume);
    device.close().unwrap();
    assert!(!device.is_connected());
    assert!(device.read_event(0).is_err());
    assert!(device.set_sidetone_level(1).is_err());
}

#[test]
fn validates_report_size_and_keeps_unknown_offline_states_explicit() {
    assert!(decode_report(&[0xb0; 129]).is_err());
    assert!(decode_report(&[0x45; 129]).is_err());
    for report in [vec![0xb0, 2, 255, 0, 100, 100], vec![0xb0, 2, 75, 3, 100, 100]] {
        let Report::Status(status) = decode_report(&report).unwrap() else {
            panic!("status");
        };
        assert_eq!(status.connected, Some(false));
        assert_eq!(status.battery_percent, None);
    }
    let Report::Status(status) = decode_report(&[0xb0, 99, 75, 99, 100, 100]).unwrap() else {
        panic!("status");
    };
    assert_eq!(status.connected, None);
    assert_eq!(status.battery_percent, None);
    assert_eq!(status.charging, None);
    assert!(decode_report(&[0x20, 0, 4, 0]).is_err());
    assert!(decode_report(&[0x20, 0, 2]).is_err());
}
