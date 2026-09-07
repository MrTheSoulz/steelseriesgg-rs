import { useState } from "react";
import { ShieldCheck, Radio, PanelTop, Info } from "lucide-react";
import type { RuntimeInfo } from "./shared/contracts";
export default function Settings({
  runtime,
  onRuntime,
}: {
  runtime: RuntimeInfo | null;
  onRuntime: (value: RuntimeInfo) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(enabled: boolean) {
    if (!window.ssgg) return;
    setBusy(true);
    try {
      onRuntime(await window.ssgg.setCloseToTray(enabled));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save window behavior.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-page">
      <h2>Runs locally. Stays out of your way.</h2>
      <p className="settings-intro">No accounts, promotions, telemetry or background downloads.</p>
      <div className="settings-row">
        <PanelTop size={23} />
        <div>
          <h3>When you close the window</h3>
          <p>
            Hide SSGG in the tray instead of quitting. A connected background service runs independently either way.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={runtime?.closeToTray ?? false}
              disabled={!runtime?.trayAvailable || busy}
              onChange={(e) => void change(e.target.checked)}
            />
            Keep running in the tray
          </label>
          <small>
            {runtime?.trayAvailable
              ? "Tray icon created. Visibility depends on your desktop’s status-icon support."
              : "Tray unavailable in this session. Closing the window quits SSGG."}
          </small>
        </div>
      </div>
      <div className="settings-row">
        <Radio size={23} />
        <div>
          <h3>Local service</h3>
          <p>{runtime?.message || "Desktop bridge unavailable"}</p>
          <dl className="service-facts">
            <div>
              <dt>Connection</dt>
              <dd>{runtime?.transport === "socket" ? "Private Unix socket" : "Window-owned JSON-lines sidecar"}</dd>
            </div>
            <div>
              <dt>Network listener</dt>
              <dd>None started by this desktop</dd>
            </div>
            <div>
              <dt>System service</dt>
              <dd>Not installed or managed here</dd>
            </div>
          </dl>
          <p className="helper">
            {runtime?.transport === "socket"
              ? "Quitting SSGG only disconnects this window. The background service continues; its session is not stopped or reset. Reconnect on refresh. Login lifetime depends on how you launched the service."
              : "No background service attached. Quitting SSGG stops this child sidecar; its session does not survive GUI quit. Launch the optional standalone service before opening the desktop to keep mixing without the GUI."}{" "}
            Assignments, group gains and profiles are saved by the service. Hardware acquisition and ChatMix must be
            explicitly re-enabled after a service restart or loss of hardware.
          </p>
        </div>
      </div>
      <div className="settings-row">
        <ShieldCheck size={23} />
        <div>
          <h3>Only the controls your device supports</h3>
          <p>
            Native application volume and mute use the audio server. Headset EQ, RGB and microphone hardware controls
            are separate capabilities. Unverified controls remain unavailable rather than sending guessed USB reports.
          </p>
        </div>
      </div>
      <div className="settings-row">
        <Info size={23} />
        <div>
          <h3>About SSGG</h3>
          <p>
            An independent, open-source SteelSeries device and audio console for Linux. Not affiliated with SteelSeries.
            Device photography keeps its manufacturer attribution; it is not part of the code license.
          </p>
        </div>
      </div>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
