import { it, expect } from "vitest";
import { adaptSnapshot, toWireCommand } from "../electron/adapter";
import fixture from "./fixture.json";
it("adapts the real Rust mixer/backend DTO and numeric IDs without inventing devices", () => {
  const { chatmix, audio, ...rest } = fixture;
  const state = adaptSnapshot({
    ...rest,
    devices: [],
    streams: fixture.streams.map((s) => ({ ...s, id: Number(s.id) })),
    mixer: { enabled: false, balance: 0 },
    backend: { connected: true, name: "PulseAudio / PipeWire-Pulse", error: null },
  });
  expect(state.streams[0].id).toBe("101");
  expect(state.audio.available).toBe(true);
  expect(state.devices).toEqual([]);
  expect(state.chatmix.wheelAvailable).toBe(false);
  expect(toWireCommand("stream.set", { id: "101", volume: 0.2 })).toEqual({ id: 101, volume: 0.2 });
  expect(() => toWireCommand("stream.set", { id: "../101", volume: 0.2 })).toThrow();
  expect(() => adaptSnapshot({ streams: [] })).toThrow();
});
