#![cfg(unix)]
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::{fs::PermissionsExt, net::UnixStream},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn binary() -> &'static str {
    option_env!("CARGO_BIN_EXE_ssgg-desktop").unwrap_or("/missing-ssgg-desktop")
}
#[test]
fn stdio_is_real_json_lines_and_does_not_need_pulse_to_edit_gui_settings() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(binary())
        .args(["--stdio", "--safe-mode", "--config"])
        .arg(dir.path().join("state.json"))
        .env("SSGG_PACTL", "/missing-pactl")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"bad\n{\"id\":5,\"method\":\"settings.set\",\"params\":{\"closeToTray\":false}}\n{\"id\":6,\"method\":\"chatmix.set\",\"params\":{\"enabled\":true}}\n").unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let replies: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 3);
    assert_eq!(replies[1]["id"], 5);
    assert_eq!(replies[1]["result"]["closeToTray"], false);
    assert_eq!(replies[2]["error"]["code"], "UNSUPPORTED");
}
struct ChildGuard(std::process::Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
fn socket_is_private_and_survives_gui_disconnect() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("run/service.sock");
    let mut child = ChildGuard(
        Command::new(binary())
            .arg("--socket")
            .arg(&socket)
            .arg("--config")
            .arg(dir.path().join("config/state.json"))
            .env("SSGG_PACTL", "/missing-pactl")
            .stdout(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut client = loop {
        if let Ok(s) = UnixStream::connect(&socket) {
            break s;
        }
        assert!(Instant::now() < deadline, "socket not ready");
        assert!(child.0.try_wait().unwrap().is_none());
        std::thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777, 0o600);
    writeln!(
        client,
        "{}",
        json!({"id":4,"method":"settings.set","params":{"startMinimized":true}})
    )
    .unwrap();
    let mut line = String::new();
    BufReader::new(&client).read_line(&mut line).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["id"], 4);
    drop(client);
    let mut client = UnixStream::connect(&socket).unwrap();
    writeln!(client, "{}", json!({"id":5,"method":"settings.get"})).unwrap();
    line.clear();
    BufReader::new(&client).read_line(&mut line).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["result"]["startMinimized"],
        true
    );
}
