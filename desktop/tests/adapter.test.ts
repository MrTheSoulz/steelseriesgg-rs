import { it, expect } from "vitest";
import { adaptSnapshot, toWireCommand } from "../electron/adapter";
import fixture from "./fixture.json";
it("accepts backend-valid saved profile names and enforces UTF-8 bytes on creation", () => {
  expect(adaptSnapshot({ ...fixture, profiles: [{ name: "Music & calls" }] }).profiles[0].name).toBe("Music & calls");
  expect(toWireCommand("profiles.save", { name: "Music & calls" })).toEqual({ name: "Music & calls" });
  expect(() => toWireCommand("profiles.save", { name: "é".repeat(41) })).toThrow();
  expect(() => toWireCommand("profiles.save", { name: "a".repeat(80) })).not.toThrow();
});
it("preserves observed amplification separately from bounded writes", () => {
  const input = structuredClone(fixture);
  input.streams[0].volume = 1.5;
  const state = adaptSnapshot({
    ...input,
    streams: [{ ...input.streams[0], effectiveVolume: 1.2, effectiveMuted: true }],
  });
  expect(state.streams[0].volume).toBe(1.5);
  expect(state.streams[0].effectiveVolume).toBe(1.2);
  expect(state.streams[0].effectiveMuted).toBe(true);
  expect(() => toWireCommand("stream.set", { id: "101", volume: 1.5 })).toThrow();
});
it("validates the narrow hardware API without pretending the backend supports it", () => {
  expect(toWireCommand("device.set", { id: "1038:227e:usb", hardwareEnabled: true })).toEqual({
    id: "1038:227e:usb",
    hardwareEnabled: true,
  });
  expect(toWireCommand("chatmix.set", { inputMode: "hardware" })).toEqual({ inputMode: "hardware" });
  for (const params of [
    { sidetone: 4 },
    { sidetone: 1.5 },
    { autoOffMinutes: 256 },
    { autoOffMinutes: -1 },
    { arbitrary: true },
    { statusRefresh: 1 },
  ])
    expect(() => toWireCommand("device.set", { id: "1038:227e:usb", ...params })).toThrow();
});
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
