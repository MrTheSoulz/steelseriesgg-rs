//! Bounded request/reply JSON-lines. stdout contains protocol only.
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
pub const MAX_LINE: usize = 65536;
pub fn serve_lines(
    reader: &mut impl BufRead,
    writer: &mut impl Write,
    mut handler: impl FnMut(Value) -> Value,
) -> io::Result<()> {
    loop {
        let mut line = Vec::new();
        loop {
            let available = reader.fill_buf()?;
            if available.is_empty() {
                break;
            }
            let n = available
                .iter()
                .position(|&b| b == b'\n')
                .map_or(available.len(), |n| n + 1);
            if line.len() + n > MAX_LINE {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "RPC request exceeds 64 KiB"));
            }
            let finished = available[n - 1] == b'\n';
            line.extend_from_slice(&available[..n]);
            reader.consume(n);
            if finished {
                break;
            }
        }
        if line.is_empty() {
            return Ok(());
        }
        let response = match serde_json::from_slice::<Value>(&line) {
            Ok(v) => handler(v),
            Err(e) => json!({"id":null,"error":{"code":"INVALID_REQUEST","message":e.to_string()}}),
        };
        serde_json::to_writer(&mut *writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
}

use super::{Backend, Service};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
struct Request {
    value: Value,
    reply: mpsc::SyncSender<Value>,
    expires: Instant,
}
#[derive(Clone)]
pub struct Client {
    sender: mpsc::SyncSender<Request>,
}
impl Client {
    pub fn request(&self, value: Value) -> Value {
        let id = value.get("id").cloned().unwrap_or(Value::Null);
        let (tx, rx) = mpsc::sync_channel(1);
        if let Err(e) = self.sender.try_send(Request {
            value,
            reply: tx,
            expires: Instant::now() + Duration::from_secs(1),
        }) {
            return json!({"id":id,"error":{"code":"BUSY","message":e.to_string()}});
        }
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(v) => v,
            Err(e) => json!({"id":id,"error":{"code":"BACKEND_UNAVAILABLE","message":e.to_string()}}),
        }
    }
}
pub fn worker<B: Backend + Send + 'static>(mut service: Service<B>) -> (Client, thread::JoinHandle<()>) {
    let (tx, rx) = mpsc::sync_channel::<Request>(16);
    let join = thread::spawn(move || {
        let mut next_tick = Instant::now() + Duration::from_millis(200);
        loop {
            if Instant::now() >= next_tick {
                if let Err(e) = service.tick() {
                    eprintln!("desktop audio unavailable: {e}");
                }
                next_tick = Instant::now() + Duration::from_millis(200);
            }
            match rx.recv_timeout(next_tick.saturating_duration_since(Instant::now())) {
                Ok(request) => {
                    let response = if Instant::now() > request.expires {
                        json!({"id":request.value.get("id"),"error":{"code":"BUSY","message":"Request expired in queue; nothing applied"}})
                    } else {
                        service.request(request.value)
                    };
                    if request.reply.send(response).is_err() {
                        eprintln!("desktop RPC client disconnected before reply");
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    (Client { sender: tx }, join)
}
pub fn serve_socket(path: &std::path::Path, client: Client) -> io::Result<()> {
    use std::os::unix::{
        fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    };
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("socket needs parent directory"))?;
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(parent)?;
    let metadata = std::fs::symlink_metadata(parent)?;
    // SAFETY: geteuid is a read-only system query with no arguments.
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_dir() || metadata.uid() != uid || metadata.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::other(
            "socket directory must be owned by this user and mode 0700",
        ));
    }
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if !metadata.file_type().is_socket() || metadata.uid() != uid {
            return Err(io::Error::other("refusing to replace non-owned socket path"));
        }
        if UnixStream::connect(path).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "desktop service already running",
            ));
        }
        std::fs::remove_file(path)?;
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    let clients = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let mut stream = stream?;
        if clients.fetch_add(1, Ordering::AcqRel) >= 8 {
            clients.fetch_sub(1, Ordering::AcqRel);
            continue;
        }
        let count = clients.clone();
        let client = client.clone();
        thread::spawn(move || {
            struct Permit(Arc<AtomicUsize>);
            impl Drop for Permit {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::AcqRel);
                }
            }
            let _permit = Permit(count);
            let result = (|| -> io::Result<()> {
                stream.set_read_timeout(Some(Duration::from_secs(30)))?;
                stream.set_write_timeout(Some(Duration::from_secs(5)))?;
                let mut reader = io::BufReader::new(stream.try_clone()?);
                serve_lines(&mut reader, &mut stream, |value| client.request(value))
            })();
            if let Err(e) = result {
                eprintln!("desktop socket client: {e}");
            }
        });
    }
    Ok(())
}
