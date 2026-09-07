import { expect, it, vi } from "vitest";
import type { DesktopBridge } from "../src/shared/contracts";
const { expose, invoke } = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(async () => {}) }));
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld: expose }, ipcRenderer: { invoke } }));
it("exposes only a named lighting IPC method, not arbitrary invoke", async () => {
  await import("../electron/preload");
  const bridge = expose.mock.calls[0][1] as DesktopBridge;
  const value = {
    id: "1038:1642:fixture",
    allowHardware: true as const,
    color: [0, 128, 255] as [number, number, number],
    brightness: 50,
  };
  await bridge.applyLighting(value);
  expect(invoke).toHaveBeenCalledWith("ssgg:lighting", value);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(bridge).not.toHaveProperty("invoke");
});
