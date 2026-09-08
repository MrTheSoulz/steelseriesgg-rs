#![cfg(unix)]
use serde_json::json;
use steelseries_gg::desktop::{Backend, Service, Snapshot};

#[derive(Default)]
struct NoAudio;
impl Backend for NoAudio {
    fn snapshot(&mut self) -> Result<Snapshot, String> {
        Ok(Snapshot::default())
    }
    fn set_stream(&mut self, _: u32, _: Option<f64>, _: Option<bool>, _: Option<u32>) -> Result<(), String> {
        panic!("RGB must never write audio")
    }
}
use std::sync::{Arc, Mutex};
use steelseries_gg::desktop::{
    hardware,
    lighting::{Access, Controller, Endpoint, Transport},
};
#[derive(Default)]
struct Capture {
    reports: Vec<Vec<u8>>,
    opens: usize,
    inventory: usize,
    endpoints: Option<Vec<Endpoint>>,
    fail_open: bool,
    fail_at: Option<usize>,
    drops: usize,
    open_gate: Option<Arc<(Mutex<bool>, std::sync::Condvar)>>,
    feature_gate: Option<Arc<(Mutex<bool>, std::sync::Condvar)>>,
}
struct MemoryAccess(Arc<Mutex<Capture>>);
struct MemoryTransport(Arc<Mutex<Capture>>);
fn endpoint() -> Endpoint {
    Endpoint {
        id: "1038:1642:fixture".into(),
        vendor_id: 0x1038,
        product_id: 0x1642,
        interface: 1,
        path: "/private/mock/hidraw".into(),
    }
}
impl Access for MemoryAccess {
    fn inventory(&mut self) -> Result<Vec<Endpoint>, String> {
        let mut capture = self.0.lock().unwrap();
        capture.inventory += 1;
        Ok(capture.endpoints.clone().unwrap_or_else(|| vec![endpoint()]))
    }
    fn open(&mut self, selected: &Endpoint) -> Result<Box<dyn Transport>, String> {
        assert_eq!(selected, &endpoint());
        let mut capture = self.0.lock().unwrap();
        capture.opens += 1;
        if capture.fail_open {
            return Err("busy or permission denied".into());
        }
        let gate = capture.open_gate.clone();
        drop(capture);
        if let Some(gate) = gate {
            let (ready, changed) = &*gate;
            let mut ready = ready.lock().unwrap();
            while !*ready {
                ready = changed.wait(ready).unwrap();
            }
        }
        Ok(Box::new(MemoryTransport(self.0.clone())))
    }
}
impl Transport for MemoryTransport {
    fn send_feature(&mut self, data: &[u8]) -> Result<(), String> {
        let mut capture = self.0.lock().unwrap();
        capture.reports.push(data.to_vec());
        if capture.fail_at == Some(capture.reports.len()) {
            return Err("injected disconnect/short feature send".into());
        }
        let gate = if capture.reports.len() == 1 {
            capture.feature_gate.clone()
        } else {
            None
        };
        drop(capture);
        if let Some(gate) = gate {
            let (ready, changed) = &*gate;
            let mut ready = ready.lock().unwrap();
            while !*ready {
                ready = changed.wait(ready).unwrap();
            }
        }
        Ok(())
    }
}
impl Drop for MemoryTransport {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1;
    }
}
fn request() -> steelseries_gg::desktop::lighting::Apply {
    steelseries_gg::desktop::lighting::Apply {
        id: endpoint().id,
        allow_hardware: true,
        color: [255, 128, 20],
        brightness: 100,
    }
}
#[test]
fn rejects_missing_ambiguous_wrong_interface_or_disguised_headsets_without_opening() {
    let wrong = |vendor, product, interface| Endpoint {
        vendor_id: vendor,
        product_id: product,
        interface,
        ..endpoint()
    };
    for endpoints in [
        vec![],
        vec![endpoint(), endpoint()],
        vec![wrong(0x1038, 0x227e, 3)],
        vec![wrong(0x1038, 0x1642, 0)],
        vec![wrong(0x9999, 0x1642, 1)],
        vec![Endpoint {
            id: "1038:1642:other".into(),
            ..endpoint()
        }],
    ] {
        let capture = Arc::new(Mutex::new(Capture {
            endpoints: Some(endpoints),
            ..Default::default()
        }));
        let mut controller = Controller::with_access(Box::new(MemoryAccess(capture.clone())));
        assert!(controller.apply(request()).is_err());
        let capture = capture.lock().unwrap();
        assert_eq!((capture.opens, capture.reports.len()), (0, 0));
    }
}
#[test]
fn invalid_or_unsupported_requests_do_not_even_enumerate() {
    let capture = Arc::new(Mutex::new(Capture::default()));
    let mut controller = Controller::with_access(Box::new(MemoryAccess(capture.clone())));
    for bad in [
        steelseries_gg::desktop::lighting::Apply {
            allow_hardware: false,
            ..request()
        },
        steelseries_gg::desktop::lighting::Apply {
            brightness: 101,
            ..request()
        },
        steelseries_gg::desktop::lighting::Apply {
            id: "1038:227e:usb".into(),
            ..request()
        },
        steelseries_gg::desktop::lighting::Apply {
            id: "1038:1628:usb".into(),
            ..request()
        },
        steelseries_gg::desktop::lighting::Apply {
            id: "1038:1644:usb".into(),
            ..request()
        },
    ] {
        assert!(controller.apply(bad).is_err());
    }
    let capture = capture.lock().unwrap();
    assert_eq!((capture.inventory, capture.opens, capture.reports.len()), (0, 0, 0));
}
#[test]
fn off_scales_to_black_and_sent_history_does_not_replay_on_discovery_or_reconnect() {
    let capture = Arc::new(Mutex::new(Capture::default()));
    let mut controller = Controller::with_access(Box::new(MemoryAccess(capture.clone())));
    let off = steelseries_gg::desktop::lighting::Apply {
        brightness: 0,
        ..request()
    };
    controller.apply(off).unwrap();
    let report = capture.lock().unwrap().reports[1].clone();
    assert!(
        report[3..451]
            .as_chunks::<4>()
            .0
            .iter()
            .all(|chunk| chunk[1..] == [0, 0, 0])
    );
    let mut entries = vec![json!({"id":endpoint().id})];
    controller.decorate(&mut entries);
    assert_eq!(entries[0]["lighting"]["lastSent"]["brightness"], 0);
    controller.decorate(&mut []);
    entries = vec![json!({"id":endpoint().id})];
    controller.decorate(&mut entries);
    assert!(entries[0].get("lighting").is_none());
    assert_eq!(capture.lock().unwrap().reports.len(), 2);
    assert_eq!(capture.lock().unwrap().drops, 1);
}
#[test]
fn denied_open_and_failed_feature_sends_release_owner_without_claiming_sent_or_retrying() {
    for (fail_open, fail_at, expected_attempts) in [(true, None, 0), (false, Some(1), 1), (false, Some(2), 2)] {
        let capture = Arc::new(Mutex::new(Capture {
            fail_open,
            fail_at,
            ..Default::default()
        }));
        let mut controller = Controller::with_access(Box::new(MemoryAccess(capture.clone())));
        assert!(controller.apply(request()).is_err());
        let mut entries = vec![json!({"id":endpoint().id})];
        controller.decorate(&mut entries);
        assert!(entries[0].get("lighting").is_none());
        let capture = capture.lock().unwrap();
        assert_eq!(capture.reports.len(), expected_attempts);
        assert_eq!(capture.drops, usize::from(!fail_open));
    }
}
#[test]
fn explicit_apply_reaches_exact_source_derived_feature_bytes_without_audio() {
    let capture = Arc::new(Mutex::new(Capture::default()));
    let dir = tempfile::tempdir().unwrap();
    let mut service = Service::with_controllers(
        NoAudio,
        dir.path().join("state.json"),
        hardware::Controller::default(),
        Controller::with_access(Box::new(MemoryAccess(capture.clone()))),
    )
    .unwrap();
    assert_eq!(capture.lock().unwrap().opens, 0);
    let result = service.request(json!({"id":1,"method":"lighting.apply","params":{
        "id":"1038:1642:fixture","allowHardware":true,"color":[255,128,0],"brightness":50
    }}));
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(result["result"]["pending"], true);
    assert!(
        result["result"].get("color").is_none(),
        "Acceptance is not a sent/readback claim"
    );
    for _ in 0..100 {
        service.tick().unwrap();
        if capture.lock().unwrap().drops == 1 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let capture = capture.lock().unwrap();
    assert_eq!(capture.opens, 1);
    assert_eq!(capture.reports.len(), 2);
    let mut init = vec![0; 643];
    init[1] = 0x4b;
    assert_eq!(capture.reports[0], init);
    let report = &capture.reports[1];
    assert_eq!(report.len(), 643);
    assert_eq!(&report[..3], &[0, 0x40, 112]);
    // Independent golden key-address sequence from the pinned OpenRGB controller.
    let keys: Vec<u8> = (0x04..=0x30)
        .chain(0x32..=0x52)
        .chain([0x64])
        .chain(0xe0..=0xe7)
        .chain([0xf0, 0x31])
        .chain(0x87..=0x8b)
        .chain(0x53..=0x63)
        .chain([0xfb])
        .collect();
    assert_eq!(keys.len(), 112);
    for (chunk, key) in report[3..451].as_chunks::<4>().0.iter().zip(keys) {
        assert_eq!(chunk, &[key, 128, 64, 0]);
    }
    assert!(report[451..].iter().all(|b| *b == 0));
    assert!(
        !dir.path().join("state.json").exists(),
        "Lighting is never saved/replayed"
    );
}

#[test]
fn blocked_keyboard_open_does_not_block_service_and_safe_mode_cancels_before_any_report() {
    let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let capture = Arc::new(Mutex::new(Capture {
        open_gate: Some(gate.clone()),
        ..Default::default()
    }));
    let dir = tempfile::tempdir().unwrap();
    let mut service = Service::with_controllers(
        NoAudio,
        dir.path().join("state.json"),
        hardware::Controller::default(),
        Controller::with_access(Box::new(MemoryAccess(capture.clone()))),
    )
    .unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        let response = service.request(json!({"id":1,"method":"lighting.apply","params":request()}));
        tx.send((response, service)).unwrap();
    });
    let response = rx.recv_timeout(std::time::Duration::from_millis(100));
    // Always unblock the private mock before asserting, including the RED case.
    let mut returned = response.ok();
    if let Some((_, service)) = &mut returned {
        for _ in 0..100 {
            if capture.lock().unwrap().opens == 1 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        service.set_read_only(true);
        service.tick().unwrap();
    }
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    thread.join().unwrap();
    assert!(returned.is_some(), "HID open blocked the service request thread");
    let (response, mut service) = returned.unwrap();
    assert_eq!(response["result"]["pending"], true);
    for _ in 0..100 {
        service.tick().unwrap();
        if capture.lock().unwrap().drops == 1 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    assert!(capture.lock().unwrap().reports.is_empty());
}

#[test]
fn dropping_lighting_worker_never_joins_stalled_io_or_sends_the_remaining_color_report() {
    use steelseries_gg::desktop::lighting::AsyncController;
    let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let capture = Arc::new(Mutex::new(Capture {
        feature_gate: Some(gate.clone()),
        ..Default::default()
    }));
    let mut controller = AsyncController::new(Controller::with_access(Box::new(MemoryAccess(capture.clone()))));
    controller.queue(request()).unwrap();
    for _ in 0..100 {
        if capture.lock().unwrap().reports.len() == 1 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let already_sent = capture.lock().unwrap().reports.len();
    let start = std::time::Instant::now();
    drop(controller);
    let elapsed = start.elapsed();
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    assert_eq!(already_sent, 1);
    assert!(elapsed < std::time::Duration::from_millis(100));
    for _ in 0..100 {
        if capture.lock().unwrap().drops == 1 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let capture = capture.lock().unwrap();
    assert_eq!(
        capture.reports.len(),
        1,
        "Already-issued init cannot be undone; color must be cancelled"
    );
    assert_eq!(capture.drops, 1);
}

#[test]
fn async_status_reports_pending_then_success_or_failure_and_never_allows_two_owners() {
    use steelseries_gg::desktop::lighting::AsyncController;
    for fail_at in [None, Some(2)] {
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let capture = Arc::new(Mutex::new(Capture {
            open_gate: Some(gate.clone()),
            fail_at,
            ..Default::default()
        }));
        let mut controller = AsyncController::new(Controller::with_access(Box::new(MemoryAccess(capture.clone()))));
        controller.queue(request()).unwrap();
        let mut entries = vec![json!({"id":endpoint().id})];
        controller.decorate(&mut entries);
        assert_eq!(entries[0]["lighting"]["pending"], true);
        assert!(entries[0]["lighting"]["lastSent"].is_null());
        assert!(
            controller.queue(request()).is_err(),
            "A second request must not open another owner"
        );
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        for _ in 0..100 {
            entries = vec![json!({"id":endpoint().id})];
            controller.decorate(&mut entries);
            if entries[0]["lighting"]["pending"] != true {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        if fail_at.is_some() {
            assert!(entries[0]["lighting"]["error"].as_str().unwrap().contains("injected"));
            assert!(entries[0]["lighting"]["lastSent"].is_null());
        } else {
            assert_eq!(entries[0]["lighting"]["lastSent"]["brightness"], 100);
        }
        let capture = capture.lock().unwrap();
        assert_eq!(capture.opens, 1);
        assert_eq!(capture.reports.len(), 2);
        assert_eq!(capture.drops, 1);
    }
}

#[test]
fn safe_mode_rejects_rgb_before_enumeration_or_open() {
    let capture = Arc::new(Mutex::new(Capture::default()));
    let dir = tempfile::tempdir().unwrap();
    let mut service = Service::with_controllers(
        NoAudio,
        dir.path().join("state.json"),
        hardware::Controller::default(),
        Controller::with_access(Box::new(MemoryAccess(capture.clone()))),
    )
    .unwrap();
    service.set_read_only(true);
    let response = service.request(json!({"id":1,"method":"lighting.apply","params":{
        "id":"1038:1642:fixture","allowHardware":true,"color":[255,128,0],"brightness":50
    }}));
    assert_eq!(response["error"]["code"], "UNSUPPORTED", "{response}");
    let capture = capture.lock().unwrap();
    assert_eq!((capture.inventory, capture.opens, capture.reports.len()), (0, 0, 0));
}

#[test]
fn capability_is_a_truthful_model_and_interface_allowlist() {
    use steelseries_gg::desktop::lighting::capability;
    assert_eq!(capability(0x1038, 0x1642, 1)["supported"], true);
    assert_eq!(capability(0x1038, 0x1642, 1)["locallyValidated"], false);
    for (vendor, product, interface) in [
        (0x1038, 0x227e, 3),
        (0x1038, 0x1628, 1),
        (0x1038, 0x1644, 3),
        (0x1038, 0x1642, 0),
        (0x9999, 0x1642, 1),
        (0x1038, 0x1610, 1),
    ] {
        assert_eq!(capability(vendor, product, interface)["supported"], false);
    }
    assert_eq!(capability(0x1038, 0x227e, 3)["applicable"], false);
    assert_eq!(capability(0x1038, 0x1628, 1)["applicable"], true);
    assert!(
        capability(0x1038, 0x1628, 1)["reason"]
            .as_str()
            .unwrap()
            .contains("experimental")
    );
}

#[test]
fn lighting_rpc_validates_before_any_hardware_access() {
    let dir = tempfile::tempdir().unwrap();
    let capture = Arc::new(Mutex::new(Capture::default()));
    let mut service = Service::with_controllers(
        NoAudio,
        dir.path().join("state.json"),
        hardware::Controller::default(),
        Controller::with_access(Box::new(MemoryAccess(capture.clone()))),
    )
    .unwrap();
    let valid = serde_json::to_value(request()).unwrap();
    let mut invalid = vec![json!({})];
    for patch in [
        json!({"color":[-1,0,0]}),
        json!({"color":[0,0,256]}),
        json!({"color":[1.5,2,3]}),
        json!({"color":[1,2]}),
        json!({"color":[1,2,3,4]}),
        json!({"brightness":101}),
        json!({"brightness":-1}),
        json!({"brightness":1.5}),
        json!({"allowHardware":false}),
        json!({"allowHardware":null}),
        json!({"effect":"rainbow"}),
        json!({"id":""}),
        json!({"id":"x".repeat(257)}),
    ] {
        let mut params = valid.clone();
        params
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        invalid.push(params);
    }
    for params in invalid {
        let result = service.request(json!({"id":1,"method":"lighting.apply","params":params}));
        assert_eq!(result["error"]["code"], "INVALID_PARAMS", "{result}");
    }
    let capture = capture.lock().unwrap();
    assert_eq!((capture.inventory, capture.opens, capture.reports.len()), (0, 0, 0));
}
