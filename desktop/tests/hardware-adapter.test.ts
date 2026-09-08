import { it, expect } from "vitest";
import { adaptSnapshot } from "../electron/adapter";
import fixture from "./fixture.json";
it("adapts optional hardware state, independent gains and unknown wheel without synthesizing center", () => {
  const physical = {
    deviceId: fixture.devices[0].id,
    hardwareEnabled: true,
    hardwareAcquired: true,
    connected: true,
    battery: 73,
    sample: { gamePercent: 80, chatPercent: 60, balance: -0.2, receivedAtMs: 1000 },
    statusAtMs: 1000,
    stale: false,
    pending: false,
    sidetone: null,
    autoOffMinutesSent: null,
    lastCommand: null,
    error: null,
  };
  const native = {
    ...fixture,
    chatmix: undefined,
    audio: undefined,
    mixer: { balance: 0, enabled: false, inputMode: "hardware" },
    backend: { connected: true },
    streams: [],
    physical,
  };
  const state = adaptSnapshot(native);
  expect(state.physical?.sample?.gamePercent).toBe(80);
  expect(state.chatmix.inputMode).toBe("hardware");
  expect(state.chatmix.wheelAvailable).toBe(true);
  const stale = adaptSnapshot({ ...native, physical: { ...physical, sample: null, stale: true } });
  expect(stale.chatmix.wheelAvailable).toBe(false);
  expect(stale.physical?.sample).toBeNull();
});
