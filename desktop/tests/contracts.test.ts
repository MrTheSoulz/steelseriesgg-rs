import { describe, it, expect } from "vitest";
import { validateCommand } from "../src/shared/contracts";
describe("renderer command boundary", () => {
  it("validates wheel sides, profile names and denies arbitrary settings/device operations", () => {
    expect(validateCommand("group.set", { id: "media", wheelSide: "a" })).toEqual({ id: "media", wheelSide: "a" });
    expect(validateCommand("chatmix.set", { enabled: true, balance: 0 })).toEqual({ enabled: true, balance: 0 });
    expect(() => validateCommand("chatmix.set", { balance: 1.01 })).toThrow();
    expect(() => validateCommand("group.set", { id: "game", wheelSide: "c" })).toThrow();
    expect(() => validateCommand("settings.set", { executable: "/bin/sh" })).toThrow();
    expect(validateCommand("profiles.save", { name: "../label" })).toEqual({ name: "../label" }); // Names are JSON keys, not paths.
    expect(() => validateCommand("device.set", { id: "x", rawReport: [1, 2] })).toThrow();
    expect(validateCommand("state.get", {})).toEqual({});
  });
  it("allows bounded gain commands, refusing non-finite, out-of-range or extra fields", () => {
    expect(validateCommand("stream.set", { id: "42", volume: 0.75 })).toEqual({ id: "42", volume: 0.75 });
    for (const value of [-1, 1.1, NaN, Infinity, "0.5"])
      expect(() => validateCommand("stream.set", { id: "42", volume: value })).toThrow();
    expect(() => validateCommand("stream.set", { id: "42", volume: 0.5, command: "rm" })).toThrow();
    expect(() => validateCommand("exec", { path: "/bin/sh" })).toThrow();
  });
});
