import { useEffect, useState } from "react";
import {
  Headphones,
  Keyboard,
  Usb,
  Download,
  ImagePlus,
  SlidersHorizontal,
  Mic,
  Lightbulb,
  Battery,
  ShieldCheck,
} from "lucide-react";
import type { Device } from "./shared/contracts";
import { artworkFor } from "./shared/artwork-catalog";
export default function Devices({
  devices,
  selected,
  onSelect,
}: {
  devices: Device[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const device = devices.find((d) => d.id === selected) || devices[0];
  const [photo, setPhoto] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setPhoto(null);
    setError("");
    if (device)
      void window.ssgg
        ?.getArtwork(device.id)
        .then((v) => {
          if (current) setPhoto(v);
        })
        .catch(() => {
          if (current) setError("Cached photo unavailable. Choose another image.");
        });
    return () => {
      current = false;
    };
  }, [device?.id]);
  async function photoAction(download: boolean) {
    if (!device || !window.ssgg) return;
    setBusy(true);
    setError("");
    try {
      setPhoto(await (download ? window.ssgg.downloadArtwork(device.id) : window.ssgg.chooseArtwork(device.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load photo.");
    } finally {
      setBusy(false);
    }
  }
  if (!device)
    return (
      <section className="empty-state device-empty">
        <Usb size={36} />
        <h2>No devices detected</h2>
        <p>
          Connect a SteelSeries device or its USB receiver, then refresh. If it is still missing, check the local
          service and USB permissions.
        </p>
      </section>
    );
  const artwork = artworkFor(device.vendorId, device.productId);
  const kindIcon =
    device.kind === "keyboard" ? (
      <Keyboard size={42} />
    ) : device.kind === "headset" ? (
      <Headphones size={42} />
    ) : (
      <Usb size={42} />
    );
  const unavailable = (key: string, fallback: string) => device.capabilities[key]?.reason || fallback;
  return (
    <>
      {devices.length > 1 && (
        <label className="device-select">
          Selected device
          <select value={device.id} onChange={(e) => onSelect(e.target.value)}>
            {devices.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <section className="device-scene">
        <div className="device-stage">
          {photo ? (
            <img className="product-photo" src={photo} alt={`${device.name} product photograph`} />
          ) : (
            <div className="photo-empty">
              {kindIcon}
              <p>No exact-model photo cached</p>
              <span>Keep it offline, or choose a photo below.</span>
            </div>
          )}
          <div className="photo-actions">
            {artwork && !photo && (
              <button disabled={busy} onClick={() => void photoAction(true)}>
                <Download size={16} />
                {busy ? "Loading photo…" : "Download official photo"}
              </button>
            )}
            <button className="subtle" disabled={busy} onClick={() => void photoAction(false)}>
              <ImagePlus size={16} />
              Choose local photo
            </button>
          </div>
        </div>
        <div className="device-story">
          <div className={"connection-pill " + (device.connected ? "connected" : "")}>
            <span className="status-dot" />
            {device.connected ? "Receiver connected" : "Disconnected"}
          </div>
          <h2>{device.name}</h2>
          <p className="device-kind">
            {device.kind === "headset"
              ? "Wireless headset"
              : device.kind === "keyboard"
                ? "Keyboard"
                : "USB peripheral"}
          </p>
          <dl className="device-facts">
            <div>
              <dt>
                <Usb size={15} />
                USB identity
              </dt>
              <dd>
                {device.vendorId.toString(16).padStart(4, "0")}:{device.productId.toString(16).padStart(4, "0")}
              </dd>
            </div>
            <div>
              <dt>
                <Battery size={15} />
                Battery
              </dt>
              <dd>{device.battery == null ? "Battery unavailable" : `${Math.round(device.battery)}%`}</dd>
            </div>
          </dl>
          {artwork && (
            <div className="validation-note">
              <ShieldCheck size={18} />
              <div>
                <strong>Source implemented</strong>
                <p>
                  Battery, ChatMix input, sidetone and auto-off have source-derived support. Hardware validation is
                  pending; receiver detection is not command verification.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      <p className="artwork-credit">
        {artwork
          ? `${artwork.attribution} Official image shows the black variant; USB does not identify casing color. Download contacts the manufacturer's image CDN only when requested.`
          : "No verified manufacturer photo is catalogued for this exact model. Choose your own image; SSGG will not substitute a different model."}
      </p>
      <section className="hardware-controls">
        <div className="section-heading">
          <div>
            <h2>Device controls</h2>
            <p>Capability status, not promises.</p>
          </div>
        </div>
        <div className="capability-row">
          <Lightbulb size={21} />
          <div>
            <h3>RGB lighting</h3>
            <p>{unavailable("rgb", "RGB control is not exposed for this device by the desktop bridge.")}</p>
          </div>
          <button disabled aria-describedby="rgb-reason">
            RGB lighting
          </button>
          <span id="rgb-reason" className="sr-only">
            Unsupported by the current desktop bridge
          </span>
        </div>
        <div className="capability-row">
          <SlidersHorizontal size={21} />
          <div>
            <h3>Hardware equalizer</h3>
            <p>{unavailable("equalizer", "Hardware EQ is not supported by the current device bridge.")}</p>
          </div>
          <button disabled>Hardware equalizer</button>
        </div>
        <div className="capability-row">
          <Mic size={21} />
          <div>
            <h3>Hardware microphone</h3>
            <p>
              {unavailable(
                "microphone",
                "Hardware microphone gain and mute are not supported. This is separate from native audio-server microphone controls.",
              )}
            </p>
          </div>
          <button disabled>Hardware microphone</button>
        </div>
      </section>
    </>
  );
}
