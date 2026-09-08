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
use std::thread;
use std::time::{Duration, Instant};
use steelseries_gg::Result;
use steelseries_gg::desktop::hardware::Controller;
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
    fn read_timeout(&mut self, data: &mut [u8], timeout_ms: i32) -> Result<usize> {
        match self.reports.pop_front() {
            Some(report) => {
                data[..report.len()].copy_from_slice(&report);
                Ok(report.len())
            }
            None => {
                thread::sleep(Duration::from_millis(timeout_ms as u64));
                Ok(0)
            }
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

#[derive(Default)]
struct PacedWire {
    opens: usize,
    closes: usize,
    writes: Vec<(Instant, Vec<u8>)>,
    read_timeouts: Vec<i32>,
    fail_write: Option<(usize, bool)>,
    // A query owns its scripted reply, so passive reads cannot consume it early.
    replies: VecDeque<Vec<steelseries_gg::Result<Vec<u8>>>>,
}
struct PacedIo {
    wire: Arc<Mutex<PacedWire>>,
    pending: VecDeque<steelseries_gg::Result<Vec<u8>>>,
}
impl Transport for PacedIo {
    fn write(&mut self, data: &[u8]) -> Result<usize> {
        assert_eq!(data, [0, 0xb0], "status-only fixture forbids settings writes");
        let mut wire = self.wire.lock().unwrap();
        wire.writes.push((Instant::now(), data.to_vec()));
        if let Some((index, short)) = wire.fail_write
            && wire.writes.len() == index
        {
            return if short {
                Ok(0)
            } else {
                Err(steelseries_gg::Error::DeviceCommunication(
                    "injected write failure".into(),
                ))
            };
        }
        if let Some(replies) = wire.replies.pop_front() {
            self.pending.extend(replies);
        }
        Ok(data.len())
    }
    fn read_timeout(&mut self, data: &mut [u8], timeout_ms: i32) -> Result<usize> {
        self.wire.lock().unwrap().read_timeouts.push(timeout_ms);
        if let Some(reply) = self.pending.pop_front() {
            let reply = reply?;
            data[..reply.len()].copy_from_slice(&reply);
            return Ok(reply.len());
        }
        thread::sleep(Duration::from_millis(timeout_ms as u64));
        Ok(0)
    }
}
impl Drop for PacedIo {
    fn drop(&mut self) {
        self.wire.lock().unwrap().closes += 1;
    }
}
fn controller_with_wire(wire: Arc<Mutex<PacedWire>>) -> Controller {
    Controller::with_factory(move |_| {
        wire.lock().unwrap().opens += 1;
        Ok(Box::new(
            Nova7Gen2::new(
                info(),
                PacedIo {
                    wire: wire.clone(),
                    pending: VecDeque::new(),
                },
            )
            .unwrap(),
        ))
    })
}

#[test]
fn status_query_accepts_a_buffered_wheel_burst_before_its_reply() {
    // More than the former 16-frame budget; leave room for a hidraw-sized burst
    // and a status reply without turning a busy endpoint into an unbounded loop.
    let mut reports = VecDeque::from(vec![vec![0x45, 90, 100]; 64]);
    reports.push_back(vec![0xb0, 3, 95, 3, 100, 40]);
    let io = MockIo {
        reports,
        ..Default::default()
    };
    let writes = io.writes.clone();
    let mut device = Nova7Gen2::new(info(), io).unwrap();
    let status = device
        .request_status()
        .expect("bounded valid wheel burst must not kill acquisition");
    assert_eq!(status.chatmix.chat_percent, 40);
    assert_eq!(*writes.lock().unwrap(), vec![vec![0, 0xb0]]);
}

#[test]
fn status_requery_write_failures_are_terminal() {
    for (short, expected) in [(false, "injected write failure"), (true, "short HID write")] {
        let wire = Arc::new(Mutex::new(PacedWire {
            fail_write: Some((2, short)),
            replies: [vec![Ok(vec![0x45, 90, 100])]].into(),
            ..Default::default()
        }));
        let mut device = Nova7Gen2::new(
            info(),
            PacedIo {
                wire: wire.clone(),
                pending: VecDeque::new(),
            },
        )
        .unwrap();
        let error = device.request_status().unwrap_err().to_string();
        assert!(error.contains(expected), "{error}");
        assert_eq!(wire.lock().unwrap().writes.len(), 2);
    }
}

#[test]
fn cancelled_status_query_sends_nothing() {
    let io = MockIo::default();
    let writes = io.writes.clone();
    let mut device = Nova7Gen2::new(info(), io).unwrap();
    assert!(
        device
            .request_status_cancellable(|| true)
            .unwrap_err()
            .to_string()
            .contains("cancelled")
    );
    assert!(writes.lock().unwrap().is_empty());
}

#[test]
fn status_arriving_after_the_original_deadline_is_rejected() {
    struct LateIo;
    impl Transport for LateIo {
        fn write(&mut self, data: &[u8]) -> Result<usize> {
            assert_eq!(data, [0, 0xb0]);
            Ok(data.len())
        }
        fn read_timeout(&mut self, data: &mut [u8], timeout_ms: i32) -> Result<usize> {
            assert!((1..=100).contains(&timeout_ms));
            // Simulate a scheduler/transport returning a good frame too late.
            thread::sleep(Duration::from_millis(1005));
            data[..6].copy_from_slice(&[0xb0, 3, 95, 3, 100, 40]);
            Ok(6)
        }
    }
    let mut device = Nova7Gen2::new(info(), LateIo).unwrap();
    assert!(
        device
            .request_status()
            .unwrap_err()
            .to_string()
            .contains("timed out waiting for status")
    );
}

#[test]
fn no_status_response_has_one_deadline_and_paced_bounded_queries() {
    let wire = Arc::new(Mutex::new(PacedWire::default()));
    let mut device = Nova7Gen2::new(
        info(),
        PacedIo {
            wire: wire.clone(),
            pending: VecDeque::new(),
        },
    )
    .unwrap();
    let start = Instant::now();
    assert_eq!(
        device.request_status().unwrap_err().to_string(),
        "Device communication error: Nova 7 Gen 2: timed out waiting for status"
    );
    assert!(start.elapsed() >= Duration::from_secs(1));
    assert!(
        start.elapsed() < Duration::from_millis(1500),
        "deadline must not restart per query"
    );
    let wire = wire.lock().unwrap();
    assert!((2..=10).contains(&wire.writes.len()));
    assert!(
        wire.writes
            .iter()
            .all(|(time, _)| time.duration_since(start) < Duration::from_secs(1))
    );
    assert!(
        wire.writes
            .windows(2)
            .all(|w| w[1].0.duration_since(w[0].0) >= Duration::from_millis(100))
    );
    assert!(wire.read_timeouts.len() <= 10, "empty reads must not busy spin");
    assert!(wire.read_timeouts.iter().all(|t| (1..=100).contains(t)));
}

#[test]
fn continuous_wheel_traffic_has_a_distinct_report_budget_error() {
    let io = MockIo {
        reports: VecDeque::from(vec![vec![0x45, 90, 100]; 256]),
        ..Default::default()
    };
    let writes = io.writes.clone();
    let mut device = Nova7Gen2::new(info(), io).unwrap();
    let start = Instant::now();
    assert_eq!(
        device.request_status().unwrap_err().to_string(),
        "Device communication error: Nova 7 Gen 2: status report budget exhausted"
    );
    assert!(start.elapsed() < Duration::from_secs(1));
    assert_eq!(*writes.lock().unwrap(), vec![vec![0, 0xb0]]);
    // Exactly 128 reports consumed, not a deadline or the old 16-frame cutoff.
    for _ in 0..128 {
        assert!(matches!(device.read_event(0).unwrap(), Some(Report::ChatMix(_))));
    }
    assert_eq!(device.read_event(0).unwrap(), None);
}

#[test]
fn controller_requery_does_not_retry_malformed_offline_or_transport_failures() {
    for (failure, expected) in [
        (Ok(vec![0x45, 101, 100]), "percentage outside 0..=100"),
        (Ok(vec![0xb0, 3, 95]), "truncated status report"),
        (Ok(vec![0xb0, 3, 101, 3, 100, 40]), "percentage outside 0..=100"),
        (Ok(vec![0xb0, 2, 95, 0, 100, 40]), "Headset offline or power unknown"),
        (Ok(vec![0xb0, 99, 95, 99, 100, 40]), "Headset offline or power unknown"),
        (
            Err(steelseries_gg::Error::DeviceCommunication("injected unplug".into())),
            "injected unplug",
        ),
    ] {
        let wire = Arc::new(Mutex::new(PacedWire {
            replies: [
                vec![Ok(vec![0xb0, 3, 95, 3, 65, 100])],
                vec![Ok(vec![0x45, 90, 100])],
                vec![failure],
                vec![Ok(vec![0xb0, 3, 95, 3, 100, 40])],
            ]
            .into(),
            ..Default::default()
        }));
        let mut controller = controller_with_wire(wire.clone());
        controller.enable("1038:227e:test").unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let state = controller.snapshot();
            if let Some(error) = state.error {
                assert!(error.contains(expected), "{error}");
                assert!(state.status_at_ms.is_some(), "status established before failure");
                assert!(!state.hardware_acquired && !state.hardware_enabled);
                assert!(state.sample.is_none());
                assert!(!controller.audio_write_guard()());
                break;
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(1));
        }
        drop(controller);
        let wire = wire.lock().unwrap();
        assert_eq!(wire.opens, 1);
        assert_eq!(wire.closes, 1);
        assert_eq!(wire.writes.len(), 3, "fatal replies must not get retried");
        assert_eq!(wire.replies.len(), 1, "later good status must not resurrect owner");
    }
}

#[test]
fn cancellation_during_status_wait_joins_owner_without_publishing_late_gains() {
    let wire = Arc::new(Mutex::new(PacedWire {
        replies: [
            vec![Ok(vec![0xb0, 3, 95, 3, 65, 100])],
            vec![Ok(vec![0x45, 90, 100])],
            vec![Ok(vec![0xb0, 3, 95, 3, 100, 40])],
        ]
        .into(),
        ..Default::default()
    }));
    let mut controller = controller_with_wire(wire.clone());
    controller.enable("1038:227e:test").unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while wire.lock().unwrap().writes.len() < 2 {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(1));
    }
    controller.stop();
    let stopped = Instant::now();
    while wire.lock().unwrap().closes == 0 {
        let state = controller.snapshot();
        assert!(state.sample.is_none());
        assert!(!state.hardware_acquired && !state.hardware_enabled);
        assert!(!controller.audio_write_guard()());
        assert!(stopped.elapsed() < Duration::from_millis(1500));
        thread::sleep(Duration::from_millis(1));
    }
    let state = controller.snapshot();
    assert!(state.sample.is_none());
    assert!(state.error.is_none(), "explicit cancellation is not a device fault");
    drop(controller);
    let wire = wire.lock().unwrap();
    assert_eq!(wire.opens, 1);
    assert_eq!(wire.closes, 1);
    assert_eq!(wire.writes.len(), 2, "cancellation must prevent a new status re-query");
    assert_eq!(wire.replies.len(), 1, "late good reply must remain unrequested");
}

#[test]
fn missing_sidetone_reply_never_retries_a_settings_query() {
    let io = MockIo::default();
    let writes = io.writes.clone();
    let mut device = Nova7Gen2::new(info(), io).unwrap();
    assert!(
        device
            .sidetone_level()
            .unwrap_err()
            .to_string()
            .contains("timed out waiting for sidetone")
    );
    let writes = writes.lock().unwrap();
    assert_eq!(writes.len(), 1);
    assert_eq!(&writes[0][..2], &[0, 0x20]);
}

#[test]
fn controller_recovers_lost_status_after_wheel_without_reacquiring() {
    let wire = Arc::new(Mutex::new(PacedWire {
        replies: [
            vec![Ok(vec![0xb0, 3, 95, 3, 65, 100])],
            vec![Ok(vec![0x45, 90, 100, 0, 0, 0])],
            vec![Ok(vec![0xb0, 3, 95, 3, 100, 40])],
        ]
        .into(),
        ..Default::default()
    }));
    let mut controller = controller_with_wire(wire.clone());
    assert_eq!(wire.lock().unwrap().opens, 0, "explicit opt-in required");
    controller.enable("1038:227e:test").unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut established = false;
    loop {
        let state = controller.snapshot();
        assert!(
            state.error.is_none(),
            "lost status must recover, not kill owner: {state:?}"
        );
        if let Some(sample) = state.sample {
            established |= (sample.game_percent, sample.chat_percent) == (65, 100);
            if (sample.game_percent, sample.chat_percent) == (100, 40) {
                assert!(established, "must first establish a valid connection");
                assert!(state.hardware_acquired && state.hardware_enabled && !state.stale);
                assert_eq!(state.connected, Some(true));
                assert_eq!(state.battery, Some(95));
                break;
            }
        }
        assert!(Instant::now() < deadline, "never recovered: {state:?}");
        thread::sleep(Duration::from_millis(1));
    }
    controller.stop();
    drop(controller); // Join the actual owner and drop its sole transport.
    let wire = wire.lock().unwrap();
    assert_eq!(wire.opens, 1);
    assert_eq!(wire.closes, 1);
    assert_eq!(wire.writes.len(), 3);
    assert!(wire.writes[2].0.duration_since(wire.writes[1].0) >= Duration::from_millis(100));
    assert!(wire.writes[2].0.duration_since(wire.writes[1].0) < Duration::from_secs(1));
    assert!(wire.read_timeouts.iter().all(|t| (1..=100).contains(t)));
    // Only Controller + production driver: there is no Service/audio backend.
}

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
