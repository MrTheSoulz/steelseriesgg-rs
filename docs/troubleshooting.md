# Troubleshooting

## The wheel does not move the bar

In Mixer, click **Use headset wheel** and wait for **Headset wheel active**. On-screen balance intentionally ignores physical wheel samples. If setup fails, its reason appears beside the action; retry after addressing it. For a missing receiver, connect the USB dongle and turn on the headset. Do not blindly reboot or run the GUI as root.

The bar can display wheel movement while ChatMix is off. **Enable ChatMix** only when you want it to affect audio, and assign groups to opposite sides first.

## No applications appear

Start playback in the application and refresh. SSGG needs your user session's PipeWire-Pulse or PulseAudio server and `pactl`; the `.deb` installs the command-line client, not a replacement audio server. A paused or idle application may not have a stream. A Snap's permissions can differ from an unconfined `.deb`.

Do not restart PipeWire during a call as a first diagnostic step. Use read-only inspection or check whether ordinary Ubuntu Sound settings can see the application.

## USB detected but access is denied

Detection and writable HID access are different. Install the matching desktop `.deb` in an active local Ubuntu session so its targeted udev rule can take effect. Do not grant world-writable HID access, add broad input-group access, or use `sudo ssgg-gui` as a workaround.

If the rule could not be refreshed during installation, inspect the installer error instead of ignoring it. Stock Snap confinement has an additional slot/policy boundary; ordinary udev rules do not remove that boundary.

## The keyboard has no RGB controls

A product appearing in the registry is not proof of a verified lighting protocol. Desktop RGB currently supports the wired Apex Pro TKL Gen 3 (`1038:1642`); the UI explains unsupported models. The Nova 7 Gen 2 is not an RGB device. Close other RGB controllers before explicitly applying a supported change.

“Last sent” means a completed transport write, not hardware readback. Report the exact detected PID, interface and error when a source-supported command fails; do not try another model's raw command.

## SSGG is not in the launcher, or has a generic icon

Confirm you installed the **desktop** package `ssgg-gui`, not the older CLI archive. Its launcher is `io.github.MrTheSoulz.SSGG.desktop`. Package installation updates the standard launcher and icon caches; it does not require rebooting GNOME.

Launch SSGG from the application grid. An old pinned development launcher can point to another executable: remove that old favorite and pin the installed SSGG entry. Avoid keeping a hand-written `~/.local/share/applications` entry with the same ID that shadows the package's system entry.

## There is no system tray icon

GNOME requires an AppIndicator/StatusNotifier extension for trays. SSGG checks whether a watcher is present; without one, close-to-tray is unavailable and the app cannot strand a hidden window. The application launcher still works. Launching SSGG again restores its existing window.

## The service is already in use

The backend permits one owner for a configuration and protects its private socket. A source preview, independent desktop service and packaged GUI can otherwise compete. Close the old SSGG preview normally or manage the independent service you intentionally started, then reopen. Do not kill unrelated services or change lock/socket permissions to bypass this protection.

## Chromium sandbox error

Use the installed `.deb`, which supplies the genuine helper and a narrowly scoped AppArmor profile. Do not use `--no-sandbox`, disable AppArmor globally or run Electron as root. An unprivileged extraction cannot reproduce the archive's root-owned setuid helper; development extraction smoke results are not equivalent to testing a real installation.

## What to include in a bug report

- Ubuntu version, desktop/session type and SSGG build/commit.
- Package format and installation method.
- Exact model and VID:PID; redact serial numbers if desired.
- The visible source/mixer state and exact error.
- Whether the issue reproduces in read-only inventory or only after an explicit action.

Do not include private profile files, audio content or unrelated application/window data. Tests with fake devices should be labelled as fixtures rather than presented as a hardware capture.
