#![cfg(unix)]
use serde_json::{Value, json};
use steelseries_gg::desktop::{Backend, Service, Snapshot};

#[derive(Default)]
struct MemoryBackend {
    snapshot: Snapshot,
    writes: usize,
    fail_after_write: bool,
}
impl Backend for MemoryBackend {
    fn snapshot(&mut self) -> Result<Snapshot, String> {
        Ok(self.snapshot.clone())
    }
    fn set_stream(
        &mut self,
        id: u32,
        volume: Option<f64>,
        muted: Option<bool>,
        sink: Option<u32>,
    ) -> Result<(), String> {
        self.writes += 1;
        assert!(sink.is_none(), "physical mixing must not reroute");
        let s = self.snapshot.streams.iter_mut().find(|s| s.id == id).ok_or("missing")?;
        if let Some(v) = volume {
            s.volume = v;
            s.effective_volume = v;
        }
        if let Some(v) = muted {
            s.muted = v;
            s.effective_muted = v;
        }
        if std::mem::take(&mut self.fail_after_write) {
            return Err("injected post-write failure".into());
        }
        Ok(())
    }
}
fn request(s: &mut Service<MemoryBackend>, method: &str, params: Value) -> Value {
    s.request(json!({"id":1,"method":method,"params":params}))
}
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use steelseries_gg::desktop::{Stream, hardware::Controller};
use steelseries_gg::devices::{
    DeviceInfo, DeviceType,
    headsets::nova7_gen2::{Nova7Gen2, Transport},
};
const ID: &str = "1038:227e:test";
#[derive(Default)]
struct Wire {
    writes: Vec<Vec<u8>>,
    reports: VecDeque<Vec<u8>>,
    opens: usize,
    drops: usize,
    sidetone: u8,
    fail: bool,
    offline_during_settings: bool,
    suppress_status: bool,
    status_gains: Option<(u8, u8)>,
}
struct TestTransport(Arc<Mutex<Wire>>);
impl Drop for TestTransport {
    fn drop(&mut self) {
        self.0.lock().unwrap().drops += 1;
    }
}
impl Transport for TestTransport {
    fn write(&mut self, data: &[u8]) -> steelseries_gg::Result<usize> {
        let mut w = self.0.lock().unwrap();
        w.writes.push(data.to_vec());
        match data[1] {
            0xb0 if !w.suppress_status => {
                let (game, chat) = w.status_gains.unwrap_or((100, 100));
                w.reports.push_back(vec![0xb0, 3, 73, 3, game, chat]);
            }
            0x39 => w.sidetone = data[2],
            0x20 => {
                if w.offline_during_settings {
                    w.reports.push_back(vec![0xb0, 2, 73, 0, 100, 100]);
                }
                let level = w.sidetone;
                w.reports.push_back(vec![0x20, 0, level, 0]);
            }
            _ => {}
        }
        Ok(data.len())
    }
    fn read_timeout(&mut self, data: &mut [u8], timeout: i32) -> steelseries_gg::Result<usize> {
        let deadline = Instant::now() + Duration::from_millis(timeout as u64);
        loop {
            let mut w = self.0.lock().unwrap();
            if w.fail {
                return Err(steelseries_gg::Error::DeviceCommunication("injected unplug".into()));
            }
            if let Some(report) = w.reports.pop_front() {
                if report.len() >= 3 && report[0] == 0x45 {
                    w.status_gains = Some((report[1], report[2]));
                }
                data[..report.len()].copy_from_slice(&report);
                return Ok(report.len());
            }
            drop(w);
            if Instant::now() >= deadline {
                return Ok(0);
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}
fn controller(wire: Arc<Mutex<Wire>>) -> Controller {
    Controller::with_factory(move |id| {
        assert_eq!(id, ID);
        wire.lock().unwrap().opens += 1;
        Ok(Box::new(
            Nova7Gen2::new(
                DeviceInfo {
                    name: "Nova7 fixture".into(),
                    device_type: DeviceType::Headset,
                    vendor_id: 0x1038,
                    product_id: 0x227e,
                    interface_number: 3,
                    usage_page: 0xffc0,
                    usage: 1,
                    serial_number: Some("test".into()),
                    manufacturer: None,
                    path: "injected".into(),
                },
                TestTransport(wire.clone()),
            )
            .unwrap(),
        ))
    })
}
fn call(s: &mut Service<MemoryBackend>, method: &str, params: Value) -> Value {
    let r = request(s, method, params);
    assert!(r.get("error").is_none(), "{r}");
    r["result"].clone()
}
fn settle(s: &mut Service<MemoryBackend>, condition: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        s.tick().unwrap();
        let state = call(s, "state.get", json!({}));
        if condition(&state) {
            return state;
        }
        assert!(Instant::now() < deadline, "timed out: {state}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn backend() -> MemoryBackend {
    MemoryBackend {
        snapshot: Snapshot {
            streams: [(1, "Chrome"), (2, "Discord"), (3, "YouTubeMusic")]
                .into_iter()
                .map(|(id, name)| Stream {
                    id,
                    app_key: name.into(),
                    name: name.into(),
                    app_name: name.into(),
                    volume: 0.8,
                    effective_volume: 0.8,
                    group: "unmanaged".into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        },
        writes: 0,
        fail_after_write: false,
    }
}
#[test]
fn status_only_receiver_updates_physical_mix_without_unsolicited_reports() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "stream.set", json!({"id":2,"group":"chat"}));
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    // Real Gen 2 capture supplied new gains only in replies to status queries.
    // No 0x45 event is injected; a slow battery-only poll misses wheel motion.
    wire.lock().unwrap().status_gains = Some((0, 100));
    let state = settle(&mut s, |v| v["physical"]["sample"]["gamePercent"] == 0);
    assert_eq!(state["streams"][0]["effectiveVolume"], 0.0);
    assert_eq!(state["streams"][1]["effectiveVolume"], 0.8);
    wire.lock().unwrap().status_gains = Some((100, 100));
    settle(&mut s, |v| v["streams"][0]["effectiveVolume"] == 0.8);
}

#[test]
fn unchanged_status_polls_do_not_rewrite_saved_mix() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), path.clone(), controller(wire)).unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    s.tick().unwrap();
    let saved_at = std::fs::metadata(&path).unwrap().modified().unwrap();
    let deadline = Instant::now() + Duration::from_millis(500);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
        s.tick().unwrap();
    }
    assert_eq!(std::fs::metadata(path).unwrap().modified().unwrap(), saved_at);
}

#[test]
fn injected_protocol_wheel_drives_two_independent_gains_without_compounding() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    call(&mut s, "state.get", json!({}));
    s.tick().unwrap();
    assert_eq!(wire.lock().unwrap().opens, 0);
    for (id, group) in [(1, "game"), (2, "chat"), (3, "media")] {
        call(&mut s, "stream.set", json!({"id":id,"group":group}));
    }
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    let state = settle(&mut s, |v| v["physical"]["connected"] == true);
    assert_eq!(state["physical"]["battery"], 73);
    assert_eq!(state["mixer"]["enabled"], false);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    wire.lock().unwrap().reports.push_back(vec![0x45, 40, 70]);
    let state = settle(&mut s, |v| v["physical"]["sample"]["gamePercent"] == 40);
    assert!((state["streams"][0]["effectiveVolume"].as_f64().unwrap() - 0.32).abs() < 0.0001);
    assert!((state["streams"][1]["effectiveVolume"].as_f64().unwrap() - 0.56).abs() < 0.0001);
    assert_eq!(state["streams"][2]["effectiveVolume"], 0.8);
    wire.lock().unwrap().reports.push_back(vec![0x45, 40, 70]);
    std::thread::sleep(Duration::from_millis(60));
    s.tick().unwrap();
    assert!((s.backend.snapshot.streams[0].volume - 0.32).abs() < 0.0001);
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":false}));
    drop(s);
    assert_eq!(wire.lock().unwrap().drops, 1);
}

#[test]
fn settings_are_atomic_validated_opt_in_and_report_verified_vs_sent() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    for params in [
        json!({"id":ID,"hardwareEnabled":true,"sidetone":4}),
        json!({"id":ID,"hardwareEnabled":true,"autoOffMinutes":256}),
        json!({"id":ID,"hardwareEnabled":false,"sidetone":1}),
    ] {
        assert_eq!(request(&mut s, "device.set", params)["error"]["code"], "INVALID_PARAMS");
    }
    assert_eq!(wire.lock().unwrap().opens, 0);
    assert_eq!(
        request(&mut s, "device.set", json!({"id":ID,"sidetone":2}))["error"]["code"],
        "HARDWARE_UNAVAILABLE"
    );
    s.set_read_only(true);
    assert_eq!(
        request(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}))["error"]["code"],
        "UNSUPPORTED"
    );
    assert_eq!(wire.lock().unwrap().opens, 0);
    s.set_read_only(false);
    call(
        &mut s,
        "device.set",
        json!({"id":ID,"hardwareEnabled":true,"sidetone":2,"autoOffMinutes":30}),
    );
    let state = settle(&mut s, |v| {
        v["physical"]["lastCommand"] == "completed" && v["physical"]["pending"] == false
    });
    assert_eq!(state["physical"]["sidetone"], 2);
    assert_eq!(state["physical"]["autoOffMinutesSent"], 30);
    let w = wire.lock().unwrap();
    assert!(w.writes.iter().any(|b| b.starts_with(&[0, 0x39, 2])));
    assert!(w.writes.iter().any(|b| b.starts_with(&[0, 0xa3, 30])));
    assert!(w.writes.iter().any(|b| b.starts_with(&[0, 0x20])));
    drop(w);
    drop(s);
    assert_eq!(wire.lock().unwrap().drops, 1);
}

#[test]
fn rpc_worker_applies_unsolicited_wheel_without_gui_polling() {
    struct SharedBackend(Arc<Mutex<MemoryBackend>>);
    impl Backend for SharedBackend {
        fn snapshot(&mut self) -> Result<Snapshot, String> {
            self.0.lock().unwrap().snapshot()
        }
        fn set_stream(&mut self, id: u32, v: Option<f64>, m: Option<bool>, sink: Option<u32>) -> Result<(), String> {
            self.0.lock().unwrap().set_stream(id, v, m, sink)
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    // Service backend is publicly replaceable only with the same type: a second
    // worker test backend shares real writes for observation without state.get.
    drop(s);
    let mut b = backend();
    b.snapshot.streams[0].group = "game".into();
    let observed = Arc::new(Mutex::new(b));
    let mut s = Service::with_hardware(
        SharedBackend(observed.clone()),
        dir.path().join("worker.json"),
        controller(wire.clone()),
    )
    .unwrap();
    assert!(
        s.request(json!({"method":"device.set","params":{"id":ID,"hardwareEnabled":true}}))
            .get("error")
            .is_none()
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let r = s.request(json!({"method":"chatmix.set","params":{"inputMode":"hardware","enabled":true}}));
        if r.get("error").is_none() {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    let (client, join) = steelseries_gg::desktop::rpc::worker(s);
    wire.lock().unwrap().reports.push_back(vec![0x45, 25, 100]);
    let deadline = Instant::now() + Duration::from_millis(700);
    loop {
        if (observed.lock().unwrap().snapshot.streams[0].volume - 0.2).abs() < 0.0001 {
            break;
        }
        if Instant::now() >= deadline {
            drop(client);
            join.join().unwrap();
            panic!("physical worker did not run without GUI polls within 700ms");
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    drop(client);
    join.join().unwrap();
    assert_eq!(wire.lock().unwrap().drops, 2);
}

#[test]
fn disconnect_disarms_without_rerouting_and_requires_explicit_reacquisition() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    wire.lock().unwrap().fail = true;
    let state = settle(&mut s, |v| v["physical"]["hardwareEnabled"] == false);
    assert!(state["physical"]["sample"].is_null());
    assert!(state["physical"]["connected"].is_null());
    assert!(state["physical"]["battery"].is_null());
    assert_eq!(state["mixer"]["enabled"], false);
    let writes = s.backend.writes;
    wire.lock().unwrap().fail = false;
    s.tick().unwrap();
    call(&mut s, "state.get", json!({}));
    assert_eq!(wire.lock().unwrap().opens, 1);
    assert_eq!(s.backend.writes, writes);
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    let state = settle(&mut s, |v| v["physical"]["connected"] == true);
    assert_eq!(state["mixer"]["enabled"], false);
    assert_eq!(wire.lock().unwrap().opens, 2);
    call(&mut s, "chatmix.set", json!({"enabled":true}));
    wire.lock().unwrap().reports.push_back(vec![0xb0, 2, 73, 0, 100, 100]);
    let state = settle(&mut s, |v| v["physical"]["hardwareEnabled"] == false);
    assert_eq!(state["physical"]["connected"], false);
    assert_eq!(state["mixer"]["enabled"], false);
    assert!(state["physical"]["sample"].is_null());
}

#[test]
fn offline_during_sidetone_query_cancels_remaining_settings() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    wire.lock().unwrap().offline_during_settings = true;
    call(&mut s, "device.set", json!({"id":ID,"sidetone":2,"autoOffMinutes":30}));
    std::thread::sleep(Duration::from_millis(100));
    let state = call(&mut s, "state.get", json!({}));
    assert_eq!(state["physical"]["hardwareEnabled"], false, "{state}");
    assert_eq!(state["mixer"]["enabled"], false);
    assert!(!wire.lock().unwrap().writes.iter().any(|b| b.starts_with(&[0, 0xa3])));
}

#[test]
fn source_capabilities_are_separate_from_local_validation() {
    let caps = steelseries_gg::desktop::devices::capabilities(true);
    for name in ["battery", "physicalChatmix", "sidetone", "autoOff"] {
        assert_eq!(caps[name]["supported"], true);
        assert_eq!(caps[name]["locallyValidated"], false);
    }
    for name in ["rgb", "hardwareEq", "micMute", "micVolume"] {
        assert_eq!(caps[name]["supported"], false);
    }
    let unknown = steelseries_gg::desktop::devices::capabilities(false);
    assert_eq!(unknown["physicalChatmix"]["supported"], false);
}

#[test]
fn enumerated_empty_serial_id_is_preserved_without_normalizing_it() {
    let mut c = Controller::with_factory(|id| {
        assert_eq!(id, "1038:227e:");
        Err("fixture has no hardware".into())
    });
    assert!(c.enable("1038:227e:").is_ok());
}

#[test]
fn saved_hardware_profile_never_reacquires_or_arms_without_fresh_sample() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    call(&mut s, "profiles.save", json!({"name":"Physical"}));
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":false}));
    assert_eq!(
        request(&mut s, "profiles.apply", json!({"name":"Physical"}))["error"]["code"],
        "HARDWARE_UNAVAILABLE"
    );
    drop(s);
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    let state = call(&mut s, "state.get", json!({}));
    assert_eq!(state["mixer"]["enabled"], false);
    assert_eq!(state["physical"]["hardwareEnabled"], false);
    assert_eq!(wire.lock().unwrap().opens, 1);
}

#[test]
fn selected_receiver_state_is_attached_without_claiming_other_devices_are_acquired() {
    let p = steelseries_gg::desktop::hardware::Physical {
        device_id: Some(ID.into()),
        hardware_enabled: true,
        hardware_acquired: true,
        battery: Some(73),
        connected: Some(true),
        ..Default::default()
    };
    let entries = steelseries_gg::desktop::devices::with_physical(vec![json!({"id":ID}), json!({"id":"other"})], &p);
    assert_eq!(entries[0]["battery"], 73);
    assert_eq!(entries[0]["hardwareEnabled"], true);
    assert_eq!(entries[0]["physical"]["connected"], true);
    assert!(entries[1]["physical"].is_null());
}

#[test]
fn stalled_hid_query_does_not_block_rpc_and_safe_mode_cancels_queued_writes() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire {
        suppress_status: true,
        ..Default::default()
    }));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    let start = Instant::now();
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    call(&mut s, "settings.get", json!({}));
    assert!(start.elapsed() < Duration::from_millis(500));
    let deadline = Instant::now() + Duration::from_secs(1);
    while wire.lock().unwrap().writes.is_empty() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
    call(&mut s, "device.set", json!({"id":ID,"sidetone":3}));
    s.set_read_only(true);
    let state = call(&mut s, "state.get", json!({}));
    assert_eq!(state["physical"]["hardwareEnabled"], false);
    let start = Instant::now();
    drop(s);
    assert!(start.elapsed() < Duration::from_millis(1500));
    let w = wire.lock().unwrap();
    assert_eq!(w.drops, 1);
    assert_eq!(w.writes, vec![vec![0, 0xb0]]);
}

#[test]
fn physical_two_gain_retry_preserves_base_after_partial_backend_write() {
    let dir = tempfile::tempdir().unwrap();
    let wire = Arc::new(Mutex::new(Wire::default()));
    let mut s = Service::with_hardware(backend(), dir.path().join("state.json"), controller(wire.clone())).unwrap();
    for (id, group) in [(1, "game"), (2, "chat")] {
        call(&mut s, "stream.set", json!({"id":id,"group":group}));
    }
    call(&mut s, "device.set", json!({"id":ID,"hardwareEnabled":true}));
    settle(&mut s, |v| v["physical"]["connected"] == true);
    call(&mut s, "chatmix.set", json!({"inputMode":"hardware","enabled":true}));
    wire.lock().unwrap().reports.push_back(vec![0x45, 40, 70]);
    let deadline = Instant::now() + Duration::from_secs(2);
    while call(&mut s, "state.get", json!({}))["physical"]["sample"]["gamePercent"] != 40 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    s.backend.fail_after_write = true;
    assert!(s.tick().is_err());
    s.tick().unwrap();
    let state = call(&mut s, "state.get", json!({}));
    assert!((state["streams"][0]["effectiveVolume"].as_f64().unwrap() - 0.32).abs() < 0.0001);
    assert!((state["streams"][1]["effectiveVolume"].as_f64().unwrap() - 0.56).abs() < 0.0001);
    assert_eq!(state["streams"][0]["volume"], 0.8);
    assert_eq!(state["streams"][1]["volume"], 0.8);
}

#[test]
fn hardware_mode_is_explicit_and_cannot_invent_a_center_sample() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(MemoryBackend::default(), dir.path().join("state.json")).unwrap();
    let state = request(&mut s, "state.get", json!({}));
    assert_eq!(state["result"]["physical"]["hardwareEnabled"], false);
    assert!(state["result"]["physical"]["sample"].is_null());
    let mode = request(&mut s, "chatmix.set", json!({"inputMode":"hardware"}));
    assert!(mode.get("error").is_none(), "{mode}");
    assert_eq!(mode["result"]["mixer"]["inputMode"], "hardware");
    let enable = request(&mut s, "chatmix.set", json!({"enabled":true}));
    assert_eq!(enable["error"]["code"], "HARDWARE_UNAVAILABLE");
}
