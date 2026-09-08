import { useState } from "react";
import type { Device, LightingApply } from "./shared/contracts";
import type { Mutate } from "./Mixer";
import "./lighting.css";
const presets = [
  ["Violet", "#8055ff"],
  ["Ocean", "#0088ff"],
  ["Mint", "#20d6a0"],
  ["Amber", "#ff8000"],
  ["White", "#ffffff"],
];
const hex = (color: number[]) => "#" + color.map((v) => v.toString(16).padStart(2, "0")).join("");
export default function LightingControls({
  device,
  readOnly,
  busy,
  mutate,
}: {
  device: Device;
  readOnly: boolean;
  busy: boolean;
  mutate?: Mutate;
}) {
  const lastSent = device.lighting?.lastSent;
  const [color, setColor] = useState(lastSent ? hex(lastSent.color) : "#8055ff");
  const [brightness, setBrightness] = useState(lastSent?.brightness ?? 75);
  const [pending, setPending] = useState(false);
  const capability = device.capabilities.rgb;
  if (!capability?.applicable) return null;
  if (!capability.supported)
    return (
      <section className="lighting-controls">
        <h2>RGB lighting</h2>
        <p>{capability.reason}</p>
      </section>
    );
  const inProgress = pending || !!device.lighting?.pending;
  const disabled = readOnly || busy || inProgress || !device.connected || !mutate;
  async function apply() {
    if (disabled || !mutate) return;
    const value: LightingApply = {
      id: device.id,
      allowHardware: true,
      brightness,
      color: [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)],
    };
    setPending(true);
    try {
      await mutate(
        (bridge) => bridge.applyLighting(value),
        "Lighting requested — check the device status for completion.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="lighting-controls" aria-label="RGB lighting">
      <div className="section-heading">
        <div>
          <h2>RGB lighting</h2>
          <p>One color, all keys. Changes stay here until you apply.</p>
        </div>
      </div>
      <p className="lighting-evidence">{capability.reason}</p>
      <fieldset disabled={disabled}>
        <legend className="sr-only">Choose lighting</legend>
        <div className="lighting-presets" aria-label="Color presets">
          {presets.map(([name, value]) => (
            <button type="button" key={name} aria-pressed={color === value} onClick={() => setColor(value)}>
              <span className="lighting-swatch" style={{ backgroundColor: value }} />
              {name}
            </button>
          ))}
        </div>
        <div className="lighting-values">
          <label>
            Lighting color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="lighting-brightness">
            Lighting brightness <output>{brightness === 0 ? "Off" : `${brightness}%`}</output>
            <input
              aria-label="Lighting brightness"
              type="range"
              min="0"
              max="100"
              step="1"
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={() => setBrightness(0)}>
            Off
          </button>
        </div>
      </fieldset>
      <div className="lighting-apply">
        <button disabled={disabled} onClick={() => void apply()}>
          {inProgress ? "Applying lighting…" : "Apply lighting"}
        </button>
        <p>
          {readOnly
            ? "Read-only session: hardware writes are disabled."
            : "Close other RGB software first. Apply lighting sends this color and brightness to your keyboard once."}
        </p>
      </div>
      {device.lighting?.pending && <p role="status">Lighting write in progress…</p>}
      {device.lighting?.error && (
        <p className="inline-warning" role="alert">
          {device.lighting.error}
        </p>
      )}
      <p className="lighting-history" role="status">
        {lastSent
          ? `Last sent: ${hex(lastSent.color).toUpperCase()} · ${lastSent.brightness}% brightness.`
          : "No completed lighting write recorded in this session."}{" "}
        No device readback.
      </p>
      <p className="lighting-evidence">
        Brightness scales the chosen color; 0% sends black. No effects or on-board profile saving. Reconnect USB to
        restore on-board lighting.
      </p>
    </section>
  );
}
