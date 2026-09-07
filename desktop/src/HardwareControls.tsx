import { useState } from "react";
import type { Device, Snapshot } from "./shared/contracts";
import type { Mutate } from "./Mixer";
export default function HardwareControls({
  device,
  physical,
  bridgeAvailable,
  readOnly,
  busy,
  mutate,
}: {
  device: Device;
  physical?: Snapshot["physical"];
  bridgeAvailable: boolean;
  readOnly: boolean;
  busy: boolean;
  mutate?: Mutate;
}) {
  const [minutes, setMinutes] = useState("");
  const supported = bridgeAvailable && !!device.capabilities.physicalChatmix?.supported;
  const ready = supported && device.connected && !readOnly && !busy && !physical?.pending && !!mutate;
  const acquired = !!physical?.hardwareAcquired;
  const settingReady = ready && acquired && physical?.connected === true && !physical.stale;
  const sample = physical?.stale ? null : physical?.sample;
  const request: (patch: Parameters<NonNullable<Window["ssgg"]>["setDevice"]>[0]) => void = (patch) => {
    if (mutate) void mutate((b) => b.setDevice(patch), "Hardware request accepted; check device status for completion");
  };
  return (
    <div className="hardware-bridge">
      <div className="section-heading">
        <div>
          <h2>Headset connection & controls</h2>
          <p>
            {readOnly
              ? "Read-only session — hardware access is blocked."
              : supported
                ? "Explicit access for this session. Enabling hardware does not enable ChatMix."
                : "Hardware controls unavailable in this service or for this device."}
          </p>
        </div>
        <button
          disabled={!ready}
          onClick={() => request({ id: device.id, hardwareEnabled: !physical?.hardwareEnabled })}
        >
          {physical?.hardwareEnabled ? "Release hardware" : "Enable hardware"}
        </button>
      </div>
      {supported && (
        <>
          <p className="helper">
            {device.capabilities.physicalChatmix?.locallyValidated
              ? "Locally validated protocol"
              : "Source-supported protocol · physical validation pending"}
          </p>
          <dl className="device-facts">
            <div>
              <dt>Wireless headset</dt>
              <dd>
                {physical?.connected == null ? "Connection unknown" : physical.connected ? "Connected" : "Offline"}
              </dd>
            </div>
            <div>
              <dt>Wheel input</dt>
              <dd>{sample ? `A ${sample.gamePercent}% · B ${sample.chatPercent}%` : "No wheel event received"}</dd>
            </div>
            <div>
              <dt>Hardware status</dt>
              <dd>
                {physical?.pending
                  ? "Request pending…"
                  : physical?.stale
                    ? "Expired — reacquire hardware"
                    : physical?.statusAtMs
                      ? `Updated ${new Date(physical.statusAtMs).toLocaleTimeString()}`
                      : "Not queried"}
              </dd>
            </div>
            {sample && (
              <div>
                <dt>Last wheel event</dt>
                <dd>{new Date(sample.receivedAtMs).toLocaleTimeString()}</dd>
              </div>
            )}
          </dl>
          {physical?.error && (
            <p className="inline-warning" role="alert">
              {physical.error}
            </p>
          )}
          <div className="capability-row">
            <div>
              <h3>Sidetone</h3>
              <p>{physical?.sidetone == null ? "No settings readback yet" : `Verified level: ${physical.sidetone}`}</p>
            </div>
            <select
              aria-label="Sidetone level"
              value={physical?.sidetone ?? ""}
              disabled={!settingReady || !device.capabilities.sidetone?.supported}
              onChange={(e) => request({ id: device.id, sidetone: Number(e.target.value) })}
            >
              <option value="" disabled>
                Choose level
              </option>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Off" : `Level ${n}`}
                </option>
              ))}
            </select>
            <button disabled={!settingReady} onClick={() => request({ id: device.id, statusRefresh: true })}>
              Refresh hardware status
            </button>
          </div>
          <form
            className="capability-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (settingReady && /^\d+$/.test(minutes) && Number(minutes) <= 255)
                request({ id: device.id, autoOffMinutes: Number(minutes) });
            }}
          >
            <div>
              <h3>Auto-off</h3>
              <p>
                {physical?.autoOffMinutesSent == null
                  ? "Write-only setting; no readback available."
                  : `Last sent: ${physical.autoOffMinutesSent} minutes · not read back`}
              </p>
            </div>
            <label>
              Minutes{" "}
              <input
                aria-label="Auto-off minutes"
                type="number"
                min="0"
                max="255"
                step="1"
                value={minutes}
                disabled={!settingReady || !device.capabilities.autoOff?.supported}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
            <button
              disabled={
                !settingReady ||
                !device.capabilities.autoOff?.supported ||
                !/^\d+$/.test(minutes) ||
                Number(minutes) > 255
              }
            >
              Send auto-off
            </button>
          </form>
        </>
      )}
    </div>
  );
}
