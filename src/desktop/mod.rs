//! Desktop-only audio policy. Construction and inventory are strictly read-only.
pub mod devices;
pub mod pulse;
pub mod rpc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    pub id: u32,
    pub app_key: String,
    pub name: String,
    pub app_name: String,
    pub volume: f64,
    pub effective_volume: f64,
    pub effective_muted: bool,
    pub muted: bool,
    pub group: String,
    pub sink_id: u32,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Sink {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub volume: f64,
    pub muted: bool,
}
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    pub streams: Vec<Stream>,
    pub sinks: Vec<Sink>,
}
pub trait Backend {
    fn begin_cycle(&mut self) {}
    fn snapshot(&mut self) -> Result<Snapshot, String>;
    fn set_stream(
        &mut self,
        id: u32,
        volume: Option<f64>,
        muted: Option<bool>,
        sink: Option<u32>,
    ) -> Result<(), String>;
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub volume: f64,
    pub muted: bool,
    pub wheel_side: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Mixer {
    pub balance: f64,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub start_minimized: bool,
    pub close_to_tray: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            start_minimized: false,
            close_to_tray: true,
        }
    }
}
fn groups() -> Vec<Group> {
    [("game", "Game", "a"), ("chat", "Chat", "b"), ("media", "Media", "none")]
        .into_iter()
        .map(|(id, name, side)| Group {
            id: id.into(),
            name: name.into(),
            volume: 1.0,
            muted: false,
            wheel_side: side.into(),
        })
        .collect()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Assignment {
    group: String,
    volume: f64,
    muted: bool,
    sink: Option<String>,
}
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
struct RpcError {
    code: &'static str,
    message: String,
}
impl RpcError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    fn invalid(message: impl Into<String>) -> Self {
        Self::new("INVALID_PARAMS", message)
    }
    fn backend(message: String) -> Self {
        Self::new("BACKEND_UNAVAILABLE", message)
    }
}
fn decode<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, RpcError> {
    serde_json::from_value(v).map_err(|e| RpcError::invalid(e.to_string()))
}
fn gain(v: Option<f64>, min: f64) -> Result<(), RpcError> {
    if v.is_some_and(|v| !v.is_finite() || !(min..=1.0).contains(&v)) {
        return Err(RpcError::invalid("gain outside allowed range"));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamSet {
    id: u32,
    volume: Option<f64>,
    muted: Option<bool>,
    group: Option<String>,
    sink_id: Option<u32>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    groups: Vec<Group>,
    mixer: Mixer,
    assignments: std::collections::BTreeMap<String, Assignment>,
}
#[derive(Serialize, Deserialize)]
struct Stored {
    version: u32,
    settings: Settings,
    current: Profile,
    profiles: std::collections::BTreeMap<String, Profile>,
    #[serde(default)]
    applied: std::collections::BTreeMap<u32, Applied>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Applied {
    key: String,
    base: f64,
    base_mute: bool,
    expected: f64,
    expected_mute: bool,
    factor: f64,
    // Err may follow a successful volume write. Until retry, actual state is
    // not an external edit and must not replace the requested base intent.
    #[serde(default)]
    pending: bool,
}
pub struct Service<B: Backend> {
    pub backend: B,
    snapshot: Snapshot,
    groups: Vec<Group>,
    mixer: Mixer,
    settings: Settings,
    assignments: std::collections::BTreeMap<String, Assignment>,
    path: PathBuf,
    profiles: std::collections::BTreeMap<String, Profile>,
    armed: bool,
    read_only: bool,
    _lock: std::fs::File,
    applied: std::collections::BTreeMap<u32, Applied>,
}
impl<B: Backend> Service<B> {
    pub fn new(backend: B, path: PathBuf) -> Result<Self, String> {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        let parent = path.parent().ok_or("config path has no parent")?;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)
            .map_err(|e| e.to_string())?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(path.with_extension("lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|e| format!("another desktop service owns config: {e}"))?;
        let stored = match std::fs::read(&path) {
            Ok(bytes) => {
                if bytes.len() > 1024 * 1024 {
                    return Err("desktop config exceeds 1 MiB".into());
                }
                Some(serde_json::from_slice::<Stored>(&bytes).map_err(|e| format!("invalid desktop config: {e}"))?)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        let mut service = Self {
            backend,
            snapshot: Snapshot::default(),
            groups: groups(),
            mixer: Mixer::default(),
            settings: Settings::default(),
            assignments: Default::default(),
            applied: Default::default(),
            path,
            profiles: Default::default(),
            armed: false,
            read_only: false,
            _lock: lock,
        };
        if let Some(stored) = stored {
            if stored.version != 1 {
                return Err("unsupported desktop config version".into());
            }
            service.settings = stored.settings;
            service.groups = stored.current.groups;
            service.mixer = stored.current.mixer;
            service.assignments = stored.current.assignments;
            service.profiles = stored.profiles;
            service.applied = stored.applied;
        }
        // Resuming a GUI or service must never automatically enable attenuation.
        service.mixer.enabled = false;
        Ok(service)
    }
    /// Reconcile restarted opted-in apps. Never arms itself on service startup.
    pub fn tick(&mut self) -> Result<(), String> {
        self.backend.begin_cycle();
        self.refresh().map_err(|e| e.message)?;
        if !self.armed {
            return Ok(());
        }
        let mut changed = false;
        for i in 0..self.snapshot.streams.len() {
            let stream = &self.snapshot.streams[i];
            if self.applied.get(&stream.id).is_some_and(|a| a.pending) {
                self.apply(Some(stream.id)).map_err(|e| e.message)?;
                changed = true;
                continue;
            }
            if self.applied.contains_key(&stream.id) {
                continue;
            }
            if self.assignments.contains_key(&stream.app_key) {
                let id = stream.id;
                self.apply(Some(id)).map_err(|e| e.message)?;
                changed = true;
            }
        }
        if changed {
            self.persist().map_err(|e| e.message)?;
        }
        Ok(())
    }
    fn profile(&self) -> Profile {
        Profile {
            groups: self.groups.clone(),
            mixer: self.mixer.clone(),
            assignments: self.assignments.clone(),
        }
    }
    fn profile_names(&self) -> Vec<Value> {
        self.profiles.keys().map(|name| json!({"name":name})).collect()
    }
    fn persist(&self) -> Result<(), RpcError> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let io = |e: std::io::Error| RpcError::new("IO_ERROR", e.to_string());
        let bytes = serde_json::to_vec_pretty(&Stored {
            version: 1,
            settings: self.settings.clone(),
            current: self.profile(),
            profiles: self.profiles.clone(),
            applied: self.applied.clone(),
        })
        .map_err(|e| RpcError::new("IO_ERROR", e.to_string()))?;
        let temp = self.path.with_extension("json.tmp");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temp)
            .map_err(io)?;
        file.write_all(&bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        std::fs::rename(&temp, &self.path).map_err(io)?;
        Ok(())
    }
    pub fn set_read_only(&mut self, value: bool) {
        self.read_only = value;
    }
    pub fn request(&mut self, request: Value) -> Value {
        self.backend.begin_cycle();
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let result = match request["method"].as_str() {
            Some(method) => self.dispatch(method, request.get("params").cloned().unwrap_or(json!({}))),
            None => Err(RpcError::new("INVALID_REQUEST", "method must be a string")),
        };
        match result {
            Ok(result) => json!({"id":id,"result":result}),
            Err(e) => json!({"id":id,"error":{"code":e.code,"message":e.message}}),
        }
    }
    fn refresh(&mut self) -> Result<(), RpcError> {
        self.snapshot = match self.backend.snapshot() {
            Ok(snapshot) => snapshot,
            Err(e) => {
                self.snapshot = Snapshot::default();
                // A failed inventory is not evidence that our effective gains disappeared.
                // Retire tracking only after a successful snapshot proves the stream is gone.
                self.armed = false;
                self.mixer.enabled = false;
                return Err(RpcError::backend(e));
            }
        };
        self.applied
            .retain(|id, a| self.snapshot.streams.iter().any(|s| s.id == *id && s.app_key == a.key));
        let mut external_edits = Vec::new();
        for stream in &mut self.snapshot.streams {
            if let Some(a) = self.assignments.get(&stream.app_key) {
                stream.group = a.group.clone();
            }
            if let Some(a) = self.applied.get_mut(&stream.id) {
                if a.key == stream.app_key {
                    let volume_changed = !a.pending && (stream.effective_volume - a.expected).abs() >= 0.0001;
                    let mute_changed = !a.pending && stream.muted != a.expected_mute;
                    if volume_changed {
                        a.base = if a.factor > 0.0 {
                            (stream.effective_volume / a.factor).clamp(0.0, 1.0)
                        } else {
                            stream.effective_volume
                        };
                        a.expected = stream.effective_volume;
                    }
                    if mute_changed {
                        a.base_mute = stream.muted;
                        a.expected_mute = stream.muted;
                    }
                    stream.volume = a.base;
                    stream.muted = a.base_mute;
                    if volume_changed || mute_changed {
                        external_edits.push((
                            stream.app_key.clone(),
                            volume_changed.then_some(a.base),
                            mute_changed.then_some(a.base_mute),
                        ));
                    }
                }
            }
        }
        // Explicit stream.set owns the app default. Only a newly observed,
        // unambiguous external edit can supersede it, never unchanged siblings
        // or mixing. Conflicting simultaneous edits keep the previous default.
        for (key, assignment) in &mut self.assignments {
            let mut volumes = external_edits.iter().filter(|e| &e.0 == key).filter_map(|e| e.1);
            if let Some(v) = volumes.next() {
                if volumes.all(|other| other == v) {
                    assignment.volume = v;
                }
            }
            let mut mutes = external_edits.iter().filter(|e| &e.0 == key).filter_map(|e| e.2);
            if let Some(m) = mutes.next() {
                if mutes.all(|other| other == m) {
                    assignment.muted = m;
                }
            }
        }
        for stream in &mut self.snapshot.streams {
            if !self.applied.contains_key(&stream.id) {
                if let Some(a) = self.assignments.get(&stream.app_key) {
                    stream.volume = a.volume;
                    stream.muted = a.muted;
                }
            }
        }
        Ok(())
    }
    fn factor(&self, group: &str) -> f64 {
        let Some(g) = self.groups.iter().find(|g| g.id == group) else {
            return 1.0;
        };
        let wheel = if !self.mixer.enabled {
            1.0
        } else {
            match g.wheel_side.as_str() {
                "a" => 1.0 - self.mixer.balance.max(0.0),
                "b" => 1.0 + self.mixer.balance.min(0.0),
                _ => 1.0,
            }
        };
        g.volume * wheel
    }
    fn apply(&mut self, only: Option<u32>) -> Result<(), RpcError> {
        self.armed = true;
        for stream in self.snapshot.streams.clone() {
            if only.is_some_and(|id| id != stream.id)
                || (only.is_none() && stream.group == "unmanaged" && !self.applied.contains_key(&stream.id))
            {
                continue;
            }
            // New stream restoration is shared by tick and explicit mutations.
            // Leave it untracked on a route failure so either path can retry.
            if !self.applied.contains_key(&stream.id) {
                if let Some(name) = self.assignments.get(&stream.app_key).and_then(|a| a.sink.as_ref()) {
                    if let Some(sink) = self.snapshot.sinks.iter().find(|s| &s.name == name) {
                        if sink.id != stream.sink_id {
                            self.backend
                                .set_stream(stream.id, None, None, Some(sink.id))
                                .map_err(RpcError::backend)?;
                        }
                    }
                }
            }
            let volume = stream.volume * self.factor(&stream.group);
            let muted = stream.muted || self.groups.iter().any(|g| g.id == stream.group && g.muted);
            let gain = if (volume - stream.effective_volume).abs() >= 0.0001 {
                Some(volume)
            } else {
                None
            };
            let mute = if muted != stream.effective_muted {
                Some(muted)
            } else {
                None
            };
            self.applied.insert(
                stream.id,
                Applied {
                    factor: self.factor(&stream.group),
                    key: stream.app_key,
                    base: stream.volume,
                    base_mute: stream.muted,
                    expected: volume,
                    expected_mute: muted,
                    pending: true,
                },
            );
            if gain.is_some() || mute.is_some() {
                self.backend
                    .set_stream(stream.id, gain, mute, None)
                    .map_err(RpcError::backend)?;
            }
            if let Some(a) = self.applied.get_mut(&stream.id) {
                a.pending = false;
            }
        }
        Ok(())
    }
    fn state(&mut self) -> Value {
        let error = self.refresh().err().map(|e| e.message);
        let (devices, device_error) = match devices::inventory() {
            Ok(d) => (d, None),
            Err(e) => (Vec::new(), Some(e.to_string())),
        };
        json!({"streams":self.snapshot.streams,"sinks":self.snapshot.sinks,"groups":self.groups,"mixer":self.mixer,"settings":self.settings,"profiles":self.profile_names(),"devices":devices,"deviceError":device_error,"backend":{"name":"PulseAudio / PipeWire-Pulse","connected":error.is_none(),"error":error}})
    }
    fn dispatch(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        if self.read_only
            && ["stream.set", "group.set", "chatmix.set", "profiles.apply", "device.set"].contains(&method)
        {
            return Err(RpcError::new(
                "UNSUPPORTED",
                "Audio/HID mutations disabled by --safe-mode",
            ));
        }
        match method {
            "state.get" => Ok(self.state()),
            "stream.set" => {
                let p: StreamSet = decode(params)?;
                gain(p.volume, 0.0)?;
                if p.group
                    .as_ref()
                    .is_some_and(|g| !["game", "chat", "media", "unmanaged"].contains(&g.as_str()))
                {
                    return Err(RpcError::invalid("unknown group"));
                }
                self.refresh()?;
                let stream = self
                    .snapshot
                    .streams
                    .iter()
                    .find(|s| s.id == p.id)
                    .ok_or_else(|| RpcError::new("NOT_FOUND", "stream disappeared"))?
                    .clone();
                let sink = match p.sink_id {
                    Some(id) => Some(
                        self.snapshot
                            .sinks
                            .iter()
                            .find(|s| s.id == id)
                            .ok_or_else(|| RpcError::new("NOT_FOUND", "sink disappeared"))?
                            .name
                            .clone(),
                    ),
                    None => self.assignments.get(&stream.app_key).and_then(|a| a.sink.clone()),
                };
                if p.sink_id.is_some() {
                    self.backend
                        .set_stream(p.id, None, None, p.sink_id)
                        .map_err(RpcError::backend)?;
                }
                let assignment = Assignment {
                    group: p.group.unwrap_or(stream.group),
                    volume: p.volume.unwrap_or(stream.volume),
                    muted: p.muted.unwrap_or(stream.muted),
                    sink,
                };
                for s in &mut self.snapshot.streams {
                    if s.id == p.id {
                        s.volume = assignment.volume;
                        s.muted = assignment.muted;
                        s.group = assignment.group.clone();
                    }
                }
                self.assignments.insert(stream.app_key, assignment);
                self.apply(Some(p.id))?;
                self.persist()?;
                Ok(self.state())
            }
            "group.set" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct P {
                    id: String,
                    volume: Option<f64>,
                    muted: Option<bool>,
                    wheel_side: Option<String>,
                }
                let p: P = decode(params)?;
                gain(p.volume, 0.0)?;
                if p.wheel_side
                    .as_ref()
                    .is_some_and(|s| !["a", "b", "none"].contains(&s.as_str()))
                {
                    return Err(RpcError::invalid("unknown wheel side"));
                }
                self.refresh()?;
                let g = self
                    .groups
                    .iter_mut()
                    .find(|g| g.id == p.id)
                    .ok_or_else(|| RpcError::invalid("unknown group"))?;
                if let Some(v) = p.volume {
                    g.volume = v;
                }
                if let Some(v) = p.muted {
                    g.muted = v;
                }
                if let Some(v) = p.wheel_side {
                    g.wheel_side = v;
                }
                self.apply(None)?;
                self.persist()?;
                Ok(self.state())
            }
            "chatmix.set" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct P {
                    balance: Option<f64>,
                    enabled: Option<bool>,
                }
                let p: P = decode(params)?;
                gain(p.balance, -1.0)?;
                self.refresh()?;
                if let Some(v) = p.balance {
                    self.mixer.balance = v;
                }
                if let Some(v) = p.enabled {
                    self.mixer.enabled = v;
                }
                self.apply(None)?;
                self.persist()?;
                Ok(self.state())
            }
            "devices.list" => devices::inventory()
                .map(|d| json!(d))
                .map_err(|e| RpcError::new("IO_ERROR", e.to_string())),
            "device.set" => Err(RpcError::new(
                "UNSUPPORTED",
                "Hardware control is not integrated; no HID command was sent",
            )),
            "streams.list" => {
                self.refresh()?;
                Ok(json!(self.snapshot.streams))
            }
            "settings.get" => Ok(json!(self.settings)),
            "settings.set" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct P {
                    start_minimized: Option<bool>,
                    close_to_tray: Option<bool>,
                }
                let p: P = decode(params)?;
                if let Some(v) = p.start_minimized {
                    self.settings.start_minimized = v;
                }
                if let Some(v) = p.close_to_tray {
                    self.settings.close_to_tray = v;
                }
                self.persist()?;
                Ok(json!(self.settings))
            }
            "profiles.list" => Ok(json!(self.profile_names())),
            "profiles.save" | "profiles.apply" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct P {
                    name: String,
                }
                let p: P = decode(params)?;
                if p.name.trim().is_empty() || p.name.len() > 80 || p.name.chars().any(char::is_control) {
                    return Err(RpcError::invalid(
                        "profile name must be 1..80 bytes without control characters",
                    ));
                }
                if method == "profiles.save" {
                    self.profiles.insert(p.name, self.profile());
                    self.persist()?;
                    Ok(json!(self.profile_names()))
                } else {
                    let profile = self
                        .profiles
                        .get(&p.name)
                        .ok_or_else(|| RpcError::new("NOT_FOUND", "unknown profile"))?
                        .clone();
                    self.refresh()?;
                    self.groups = profile.groups;
                    self.mixer = profile.mixer;
                    self.assignments = profile.assignments;
                    for stream in &mut self.snapshot.streams {
                        stream.group = "unmanaged".into();
                        if let Some(a) = self.assignments.get(&stream.app_key) {
                            stream.group = a.group.clone();
                            stream.volume = a.volume;
                            stream.muted = a.muted;
                            if let Some(name) = &a.sink {
                                if let Some(sink) = self.snapshot.sinks.iter().find(|s| &s.name == name) {
                                    self.backend
                                        .set_stream(stream.id, None, None, Some(sink.id))
                                        .map_err(RpcError::backend)?;
                                }
                            }
                        }
                    }
                    self.apply(None)?;
                    self.persist()?;
                    Ok(self.state())
                }
            }
            _ => Err(RpcError::new("INVALID_REQUEST", "Unknown method")),
        }
    }
}
