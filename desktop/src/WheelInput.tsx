import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./shared/contracts";
import type { Mutate } from "./Mixer";

export function freshWheel(snapshot: Snapshot, id: string) {
  const p = snapshot.physical;
  return !!(
    snapshot.chatmix.wheelAvailable &&
    p?.deviceId === id &&
    p.hardwareEnabled &&
    p.hardwareAcquired &&
    p.connected === true &&
    !p.stale &&
    !p.pending &&
    !p.error &&
    p.sample
  );
}

export default function WheelInput({
  snapshot,
  busy,
  mutate,
  selectedDevice = "",
  onChooseDevice,
  readOnly = false,
}: {
  snapshot: Snapshot | null;
  busy: boolean;
  mutate: Mutate;
  selectedDevice?: string;
  onChooseDevice?: () => void;
  readOnly?: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "connecting" | "selecting">("idle");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(new Error("Wheel setup cancelled.")), []);
  const candidates = snapshot?.devices.filter((d) => d.connected && d.capabilities.physicalChatmix?.supported) ?? [];
  const device =
    candidates.find((d) => d.id === selectedDevice) ?? (candidates.length === 1 ? candidates[0] : undefined);
  const ambiguous = candidates.length > 1 && !device;
  const blockedReason =
    readOnly || snapshot?.readOnly
      ? "Read-only session — reopen SSGG in normal mode to use hardware."
      : !snapshot?.audio.available
        ? "Audio service unavailable. Refresh to reconnect; on-screen controls stay blocked."
        : !snapshot.physical
          ? "This service does not expose headset access. Update the SSGG service; on-screen balance works independently."
          : ambiguous
            ? "Multiple headset receivers detected. Choose the headset to use."
            : !device
              ? snapshot.devices.some((d) => d.kind === "headset" && d.connected)
                ? "This headset does not expose supported wheel input. Use on-screen balance."
                : "Connect a supported headset’s USB receiver, then refresh. On-screen balance works independently."
              : "";
  const hardware = snapshot?.chatmix.inputMode === "hardware";
  const sourceDevice = candidates.find((d) => d.id === snapshot?.physical?.deviceId);
  const active = !!(hardware && sourceDevice && snapshot && freshWheel(snapshot, sourceDevice.id));
  const usingChosenWheel = active && (!device || sourceDevice?.id === device.id);
  const ready = !blockedReason && !busy;

  async function useWheel() {
    if (!ready || !snapshot || !device || controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setError("");
    setPhase("connecting");
    const timeout = setTimeout(
      () => operation.abort(new Error("Connection timed out. Check the headset and USB receiver, then retry.")),
      8000,
    );
    // Racing each read also bounds a stalled RPC. Its late result cannot resume setup.
    const wait = <T,>(promise: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const abort = () => reject(operation.signal.reason);
        if (operation.signal.aborted) {
          abort();
          return;
        }
        operation.signal.addEventListener("abort", abort, { once: true });
        promise.then(resolve, reject).finally(() => operation.signal.removeEventListener("abort", abort));
      });
    try {
      await mutate(async (bridge) => {
        try {
          const p = snapshot.physical;
          if (!(p?.deviceId === device.id && p.hardwareEnabled && p.hardwareAcquired && !p.stale && !p.error))
            await wait(bridge.setDevice({ id: device.id, hardwareEnabled: true }));
          while (true) {
            operation.signal.throwIfAborted();
            const next = await wait(bridge.getState());
            operation.signal.throwIfAborted();
            if (next.readOnly) throw new Error("Read-only session — hardware access is blocked.");
            if (!next.audio.available)
              throw new Error(next.audio.reason || "Audio service unavailable. Refresh to reconnect.");
            const receiver = next.devices.find((d) => d.id === device.id && d.connected);
            if (!receiver) throw new Error("USB receiver disconnected. Reconnect it, then retry.");
            if (!receiver.capabilities.physicalChatmix?.supported)
              throw new Error("This headset no longer exposes supported wheel input. Use on-screen balance.");
            if (next.chatmix.enabled !== snapshot.chatmix.enabled)
              throw new Error("ChatMix changed during setup. Refresh and review its current state, then retry.");
            if (next.physical?.error) throw new Error(next.physical.error);
            if (next.physical?.connected === false && !next.physical.pending)
              throw new Error("Headset offline. Turn it on near its USB receiver, then retry.");
            if (freshWheel(next, device.id)) break;
            await wait(new Promise<void>((resolve) => setTimeout(resolve, 250)));
          }
          clearTimeout(timeout);
          // Cancellation is offered only before this explicit source command is sent.
          setPhase("selecting");
          await bridge.setChatmix({ inputMode: "hardware" });
          const confirmed = await bridge.getState();
          if (confirmed.chatmix.inputMode !== "hardware" || !freshWheel(confirmed, device.id))
            throw new Error("Headset wheel selection was not confirmed. Refresh, then retry.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not connect to the headset. Retry.");
          throw e;
        }
      }, "Headset wheel selected");
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      setPhase("idle");
    }
  }

  return (
    <div className="wheel-input">
      <div className="capability-row">
        <div>
          <strong>
            {active
              ? "Headset wheel active"
              : hardware
                ? "Headset wheel selected · unavailable"
                : "On-screen balance selected"}
          </strong>
          <p>
            {snapshot?.chatmix.enabled
              ? "ChatMix is on — the selected input changes audio."
              : "ChatMix is off — the wheel is not changing audio."}
          </p>
        </div>
        {!usingChosenWheel && (
          <button disabled={!ready || phase !== "idle"} onClick={() => void useWheel()}>
            {phase === "connecting"
              ? "Connecting to headset…"
              : phase === "selecting"
                ? "Selecting headset wheel…"
                : error
                  ? "Retry headset wheel"
                  : "Use headset wheel"}
          </button>
        )}
        {phase === "connecting" && (
          <button
            onClick={() =>
              controller.current?.abort(
                new Error("Wheel setup cancelled. Input was not changed. Hardware may remain acquired."),
              )
            }
          >
            Cancel wheel setup
          </button>
        )}
        {hardware && (
          <button
            disabled={!snapshot?.audio.available || readOnly || snapshot.readOnly || busy || phase !== "idle"}
            onClick={() => void mutate((b) => b.setChatmix({ inputMode: "software" }), "On-screen balance selected")}
          >
            Use on-screen balance
          </button>
        )}
      </div>
      {!usingChosenWheel && ready && (
        <p className="helper">
          {device?.name}. Connects hardware and selects its wheel; does not enable ChatMix.
          {snapshot?.chatmix.enabled &&
            " ChatMix is already on: selecting the wheel immediately uses its current position."}
        </p>
      )}
      {blockedReason && <p className="helper">{blockedReason}</p>}
      {ambiguous && onChooseDevice && <button onClick={onChooseDevice}>Choose headset</button>}
      {(error || snapshot?.physical?.error) && (
        <p className="inline-warning" role="alert">
          {error || snapshot?.physical?.error}
        </p>
      )}
    </div>
  );
}
