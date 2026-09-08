#![cfg(unix)]
use serde_json::{Value, json};
use steelseries_gg::desktop::{Backend, Service, Snapshot, Stream};
#[derive(Default)]
struct MemoryBackend {
    snapshot: Snapshot,
    writes: usize,
}
impl Backend for MemoryBackend {
    fn snapshot(&mut self) -> Result<Snapshot, String> {
        let mut snap = self.snapshot.clone();
        for s in &mut snap.streams {
            s.effective_muted = s.muted;
        }
        Ok(snap)
    }
    fn set_stream(
        &mut self,
        id: u32,
        volume: Option<f64>,
        muted: Option<bool>,
        sink: Option<u32>,
    ) -> Result<(), String> {
        self.writes += 1;
        let s = self.snapshot.streams.iter_mut().find(|s| s.id == id).ok_or("missing")?;
        if let Some(v) = volume {
            s.volume = v;
            s.effective_volume = v;
        }
        if let Some(v) = muted {
            s.muted = v;
        }
        if let Some(v) = sink {
            s.sink_id = v;
        }
        Ok(())
    }
}
#[test]
fn opening_and_reading_does_not_modify_audio() {
    let dir = tempfile::tempdir().unwrap();
    let mut service = Service::new(MemoryBackend::default(), dir.path().join("state.json")).unwrap();
    let result: Value = service.request(json!({"id":1,"method":"state.get","params":{}}));
    assert_eq!(result["result"]["mixer"]["enabled"], false);
    assert_eq!(service.backend.writes, 0);
    assert_eq!(result["result"]["groups"].as_array().unwrap().len(), 3);
}

fn stream(id: u32, key: &str, volume: f64) -> Stream {
    Stream {
        id,
        app_key: key.into(),
        name: key.into(),
        app_name: key.into(),
        volume,
        effective_volume: volume,
        group: "unmanaged".into(),
        ..Default::default()
    }
}
fn call(service: &mut Service<MemoryBackend>, method: &str, params: Value) -> Value {
    let r = service.request(json!({"id":1,"method":method,"params":params}));
    assert!(r.get("error").is_none(), "{r}");
    r["result"].clone()
}
#[test]
fn stream_volume_and_group_changes_are_explicit_validated_mutations() {
    let dir = tempfile::tempdir().unwrap();
    let backend = MemoryBackend {
        snapshot: Snapshot {
            streams: vec![stream(1, "game.exe", 0.8)],
            ..Default::default()
        },
        ..Default::default()
    };
    let mut s = Service::new(backend, dir.path().join("state.json")).unwrap();
    let r = call(
        &mut s,
        "stream.set",
        json!({"id":1,"volume":0.6,"muted":true,"group":"game"}),
    );
    assert_eq!(r["streams"][0]["volume"], 0.6);
    assert_eq!(r["streams"][0]["group"], "game");
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.6);
    assert!(s.backend.snapshot.streams[0].muted);
    let writes = s.backend.writes;
    for params in [
        json!({"id":1,"volume":2}),
        json!({"id":1,"volume":-1}),
        json!({"id":1,"volume":"loud"}),
        json!({"id":1,"group":"invalid"}),
        json!({"id":1,"muted":"false"}),
    ] {
        assert_eq!(
            s.request(json!({"id":2,"method":"stream.set","params":params}))["error"]["code"],
            "INVALID_PARAMS"
        );
    }
    assert_eq!(s.backend.writes, writes);
}

#[test]
fn chatmix_never_compounds_base_gain_or_touches_unmanaged_streams() {
    let dir = tempfile::tempdir().unwrap();
    let backend = MemoryBackend {
        snapshot: Snapshot {
            streams: vec![stream(1, "game.exe", 0.8), stream(2, "browser", 0.7)],
            ..Default::default()
        },
        ..Default::default()
    };
    let mut s = Service::new(backend, dir.path().join("state.json")).unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.4);
    assert_eq!(s.backend.snapshot.streams[1].volume, 0.7);
    for _ in 0..5 {
        call(&mut s, "chatmix.set", json!({"balance":0.5}));
    }
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.4);
    let r = call(&mut s, "group.set", json!({"id":"game","volume":0.5}));
    assert_eq!(r["streams"][0]["volume"], 0.8);
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.2);
    call(&mut s, "chatmix.set", json!({"enabled":false}));
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.4);
    call(&mut s, "group.set", json!({"id":"game","muted":true}));
    assert!(s.backend.snapshot.streams[0].muted);
    call(
        &mut s,
        "group.set",
        json!({"id":"game","muted":false,"wheelSide":"none"}),
    );
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":1.0}));
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.4);
    assert!(!s.backend.snapshot.streams[0].muted);
}

#[test]
fn external_gain_and_mute_changes_survive_next_mix_update() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(
        MemoryBackend {
            snapshot: Snapshot {
                streams: vec![stream(1, "game.exe", 0.8)],
                ..Default::default()
            },
            ..Default::default()
        },
        dir.path().join("state.json"),
    )
    .unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    s.backend.snapshot.streams[0].volume = 0.3;
    s.backend.snapshot.streams[0].effective_volume = 0.3;
    s.backend.snapshot.streams[0].muted = true;
    let writes = s.backend.writes;
    let r = call(&mut s, "state.get", json!({}));
    assert!((r["streams"][0]["volume"].as_f64().unwrap() - 0.6).abs() < 0.0001);
    assert_eq!(s.backend.writes, writes);
    call(&mut s, "chatmix.set", json!({"balance":0.0}));
    assert!((s.backend.snapshot.streams[0].volume - 0.6).abs() < 0.0001);
    assert!(s.backend.snapshot.streams[0].muted);
}

#[test]
fn settings_profiles_and_assignments_persist_without_startup_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("desktop/state.json");
    let make = || MemoryBackend {
        snapshot: Snapshot {
            streams: vec![stream(1, "game.exe", 0.8)],
            ..Default::default()
        },
        ..Default::default()
    };
    let mut s = Service::new(make(), path.clone()).unwrap();
    call(
        &mut s,
        "settings.set",
        json!({"closeToTray":false,"startMinimized":true}),
    );
    call(&mut s, "stream.set", json!({"id":1,"volume":0.7,"group":"game"}));
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    assert_eq!(
        call(&mut s, "profiles.save", json!({"name":"Gaming"})),
        json!([{"name":"Gaming"}])
    );
    call(&mut s, "group.set", json!({"id":"game","volume":0.5}));
    call(&mut s, "profiles.apply", json!({"name":"Gaming"}));
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.35);
    drop(s);
    let mut s = Service::new(make(), path).unwrap();
    let state = call(&mut s, "state.get", json!({}));
    assert_eq!(state["mixer"]["enabled"], false);
    assert_eq!(state["settings"]["closeToTray"], false);
    assert_eq!(state["streams"][0]["group"], "game");
    assert_eq!(state["profiles"], json!([{"name":"Gaming"}]));
    assert_eq!(s.backend.writes, 0);
}

#[test]
fn restarted_apps_reapply_only_after_explicit_session_activation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    let make = || MemoryBackend {
        snapshot: Snapshot {
            streams: vec![stream(1, "game.exe", 0.8)],
            ..Default::default()
        },
        ..Default::default()
    };
    let mut s = Service::new(make(), path.clone()).unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game","volume":0.6}));
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    s.backend.snapshot.streams = vec![stream(22, "game.exe", 1.0), stream(1, "other.exe", 0.9)];
    s.tick().unwrap();
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.3);
    assert_eq!(s.backend.snapshot.streams[1].volume, 0.9);
    let writes = s.backend.writes;
    s.tick().unwrap();
    assert_eq!(s.backend.writes, writes);
    drop(s);
    let mut s = Service::new(make(), path).unwrap();
    s.tick().unwrap();
    assert_eq!(s.backend.writes, 0);
}

#[test]
fn pulse_json_maps_stable_app_identity_and_native_volume() {
    let inputs = json!([{"index":7,"sink":11,"mute":false,"volume":{"front-left":{"value":32768},"front-right":{"value":32768}},"properties":{"application.process.binary":"game","application.name":"My Game","media.role":"game","media.name":"Output"}}]);
    let sinks = json!([{"index":11,"name":"null-test","description":"Test Output","mute":false,"volume":{"mono":{"value":65536}}}]);
    let snap = steelseries_gg::desktop::pulse::parse_snapshot(inputs, sinks).unwrap();
    assert_eq!(snap.streams[0].app_key, "[\"game\",\"My Game\",\"game\"]");
    assert_eq!(snap.streams[0].volume, 0.5);
    assert_eq!(snap.streams[0].sink_id, 11);
    assert_eq!(snap.sinks[0].description, "Test Output");
    assert!(steelseries_gg::desktop::pulse::parse_snapshot(json!({}), json!([])).is_err());
}

#[test]
#[ignore = "explicit safe live read-only Pulse inventory; requires pactl"]
fn live_pulse_inventory_read_only() {
    let mut backend = steelseries_gg::desktop::pulse::PulseBackend::default();
    let snapshot = backend.snapshot().unwrap();
    assert!(!snapshot.sinks.is_empty());
    println!(
        "{} sinks, {} playback streams (read-only)",
        snapshot.sinks.len(),
        snapshot.streams.len()
    );
}
#[test]
fn command_runner_times_out_and_bounds_output() {
    use steelseries_gg::desktop::pulse::run_command;
    let start = std::time::Instant::now();
    assert!(
        run_command("/bin/sleep", &["2"], None, std::time::Duration::from_millis(40))
            .unwrap_err()
            .contains("timeout")
    );
    assert!(start.elapsed() < std::time::Duration::from_secs(1));
    assert!(
        run_command("/usr/bin/yes", &[], None, std::time::Duration::from_secs(2))
            .unwrap_err()
            .contains("limit")
    );
}

#[test]
fn json_lines_rejects_malformed_and_oversize_without_losing_next_id() {
    use steelseries_gg::desktop::rpc::serve_lines;
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(MemoryBackend::default(), dir.path().join("state.json")).unwrap();
    let input = b"not json\n{\"id\":7,\"method\":\"settings.get\"}\n";
    let mut output = Vec::new();
    serve_lines(&mut &input[..], &mut output, |v| s.request(v)).unwrap();
    let replies: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0]["error"]["code"], "INVALID_REQUEST");
    assert_eq!(replies[1]["id"], 7);
    let oversized = vec![b'x'; 65537];
    let mut output = Vec::new();
    assert!(serve_lines(&mut &oversized[..], &mut output, |v| s.request(v)).is_err());
    assert_eq!(s.backend.writes, 0);
}

#[test]
fn device_rpc_has_explicit_unsupported_controls_not_guessed_hid() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(MemoryBackend::default(), dir.path().join("state.json")).unwrap();
    let r = call(&mut s, "devices.list", json!({}));
    assert!(r.is_array());
    let r = s.request(json!({"id":5,"method":"device.set","params":{"id":"anything","sidetone":2}}));
    assert_eq!(r["error"]["code"], "UNSUPPORTED");
    assert_eq!(s.backend.writes, 0);
}

#[test]
fn unchanged_mix_does_not_write_to_unopted_media_or_repeat_volume() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(
        MemoryBackend {
            snapshot: Snapshot {
                streams: vec![stream(1, "game", 0.8), stream(2, "music", 0.5)],
                ..Default::default()
            },
            ..Default::default()
        },
        dir.path().join("state.json"),
    )
    .unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "stream.set", json!({"id":2,"group":"media"}));
    let before = s.backend.writes;
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    assert_eq!(s.backend.writes - before, 1);
    let before = s.backend.writes;
    call(&mut s, "chatmix.set", json!({"balance":0.5}));
    assert_eq!(s.backend.writes, before);
}

#[test]
fn worker_expires_queued_mutations_instead_of_applying_them_late() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };
    struct Slow {
        entered: Arc<AtomicBool>,
        writes: Arc<AtomicUsize>,
    }
    impl Backend for Slow {
        fn snapshot(&mut self) -> Result<Snapshot, String> {
            if !self.entered.swap(true, Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(1200));
            }
            Ok(Snapshot {
                streams: vec![stream(1, "game", 0.8)],
                ..Default::default()
            })
        }
        fn set_stream(&mut self, _: u32, _: Option<f64>, _: Option<bool>, _: Option<u32>) -> Result<(), String> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let entered = Arc::new(AtomicBool::new(false));
    let writes = Arc::new(AtomicUsize::new(0));
    let service = Service::new(
        Slow {
            entered: entered.clone(),
            writes: writes.clone(),
        },
        dir.path().join("state.json"),
    )
    .unwrap();
    let (client, join) = steelseries_gg::desktop::rpc::worker(service);
    let c = client.clone();
    let first = std::thread::spawn(move || c.request(json!({"id":1,"method":"state.get"})));
    while !entered.load(Ordering::SeqCst) {
        std::thread::yield_now();
    }
    let result = client.request(json!({"id":2,"method":"stream.set","params":{"id":1,"volume":0.1}}));
    assert_eq!(result["error"]["code"], "BUSY");
    assert_eq!(writes.load(Ordering::SeqCst), 0);
    first.join().unwrap();
    drop(client);
    join.join().unwrap();
}

#[test]
fn continuous_gui_requests_do_not_starve_background_reconcile() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Count(Arc<AtomicUsize>);
    impl Backend for Count {
        fn snapshot(&mut self) -> Result<Snapshot, String> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(Snapshot::default())
        }
        fn set_stream(&mut self, _: u32, _: Option<f64>, _: Option<bool>, _: Option<u32>) -> Result<(), String> {
            panic!("read-only")
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let service = Service::new(Count(count.clone()), dir.path().join("state.json")).unwrap();
    let (client, join) = steelseries_gg::desktop::rpc::worker(service);
    let until = std::time::Instant::now() + std::time::Duration::from_millis(1300);
    while std::time::Instant::now() < until {
        client.request(json!({"id":1,"method":"settings.get"}));
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(count.load(Ordering::SeqCst) > 0);
    drop(client);
    join.join().unwrap();
}

#[test]
fn pulse_cycle_has_an_aggregate_deadline_not_per_command_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("slow-fixture");
    std::fs::write(&script, "#!/bin/sh\nsleep 0.15\nprintf '[]'\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut backend = steelseries_gg::desktop::pulse::PulseBackend::with_timeout(std::time::Duration::from_millis(220));
    backend.executable = script.to_string_lossy().into_owned();
    backend.begin_cycle();
    let start = std::time::Instant::now();
    assert!(backend.snapshot().unwrap_err().contains("timeout"));
    assert!(start.elapsed() < std::time::Duration::from_millis(400));
}

#[test]
fn profile_restore_removes_old_group_attenuation_and_restores_saved_routes() {
    use steelseries_gg::desktop::Sink;
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(
        MemoryBackend {
            snapshot: Snapshot {
                streams: vec![stream(1, "game", 0.8)],
                sinks: vec![
                    Sink {
                        id: 10,
                        name: "a".into(),
                        ..Default::default()
                    },
                    Sink {
                        id: 11,
                        name: "b".into(),
                        ..Default::default()
                    },
                ],
            },
            ..Default::default()
        },
        dir.path().join("state.json"),
    )
    .unwrap();
    call(&mut s, "profiles.save", json!({"name":"Unmanaged"}));
    call(&mut s, "stream.set", json!({"id":1,"group":"game","sinkId":10}));
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    call(&mut s, "profiles.save", json!({"name":"Gaming"}));
    call(&mut s, "stream.set", json!({"id":1,"sinkId":11}));
    call(&mut s, "profiles.apply", json!({"name":"Gaming"}));
    assert_eq!(s.backend.snapshot.streams[0].sink_id, 10);
    let r = call(&mut s, "profiles.apply", json!({"name":"Unmanaged"}));
    assert_eq!(r["streams"][0]["group"], "unmanaged");
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.8);
}

#[test]
fn missing_backend_clears_stale_state_and_requires_reactivation() {
    struct Disconnect {
        backend: MemoryBackend,
        failed: bool,
    }
    impl Backend for Disconnect {
        fn snapshot(&mut self) -> Result<Snapshot, String> {
            if self.failed {
                Err("disconnected".into())
            } else {
                self.backend.snapshot()
            }
        }
        fn set_stream(&mut self, id: u32, v: Option<f64>, m: Option<bool>, sink: Option<u32>) -> Result<(), String> {
            self.backend.set_stream(id, v, m, sink)
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let backend = Disconnect {
        backend: MemoryBackend {
            snapshot: Snapshot {
                streams: vec![stream(1, "game", 0.8)],
                ..Default::default()
            },
            ..Default::default()
        },
        failed: false,
    };
    let mut s = Service::new(backend, dir.path().join("state.json")).unwrap();
    s.request(json!({"id":1,"method":"stream.set","params":{"id":1,"group":"game"}}));
    s.request(json!({"id":2,"method":"chatmix.set","params":{"enabled":true,"balance":0.5}}));
    s.backend.failed = true;
    let state = s.request(json!({"id":3,"method":"state.get"}))["result"].clone();
    assert_eq!(state["backend"]["connected"], false);
    assert_eq!(state["streams"], json!([]));
    assert_eq!(state["mixer"]["enabled"], false);
    let writes = s.backend.backend.writes;
    s.backend.failed = false;
    s.backend.backend.snapshot.streams = vec![stream(20, "game", 1.0)];
    s.tick().unwrap();
    assert_eq!(s.backend.backend.writes, writes);
}

#[test]
fn restarting_service_does_not_compound_its_previous_attenuation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    let mut s = Service::new(
        MemoryBackend {
            snapshot: Snapshot {
                streams: vec![stream(1, "game", 0.8)],
                ..Default::default()
            },
            ..Default::default()
        },
        path.clone(),
    )
    .unwrap();
    call(&mut s, "stream.set", json!({"id":1,"group":"game"}));
    call(&mut s, "chatmix.set", json!({"enabled":true,"balance":0.5}));
    let snapshot = s.backend.snapshot.clone();
    drop(s);
    let mut s = Service::new(
        MemoryBackend {
            snapshot,
            ..Default::default()
        },
        path,
    )
    .unwrap();
    let r = call(&mut s, "state.get", json!({}));
    assert_eq!(s.backend.writes, 0);
    assert_eq!(r["streams"][0]["volume"], 0.8);
    call(&mut s, "chatmix.set", json!({"enabled":true}));
    assert_eq!(s.backend.snapshot.streams[0].volume, 0.4);
}

#[test]
fn pulse_mutation_requires_readback_not_just_successful_exit() {
    let mut backend = steelseries_gg::desktop::pulse::PulseBackend::default();
    backend.executable = "/bin/true".into();
    assert!(backend.set_stream(1, Some(0.5), None, None).is_err());
}
