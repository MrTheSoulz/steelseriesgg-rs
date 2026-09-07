import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App";
import fixture from "./fixture.json";
import type { DesktopBridge, Snapshot } from "../src/shared/contracts";
function testBridge() {
  let state = structuredClone(fixture) as Snapshot;
  const bridge = {
    getState: vi.fn(async () => structuredClone(state)),
    getRuntime: vi.fn(async () => ({
      connected: true,
      message: "Local audio service",
      trayAvailable: true,
      closeToTray: false,
      transport: "sidecar",
      testMode: true,
    })),
    setStream: vi.fn(async (value) => {
      Object.assign(
        state.streams.find((s) => s.id === value.id)!,
        value,
      );
    }),
    setGroup: vi.fn(async (value) => {
      Object.assign(
        state.groups.find((g) => g.id === value.id)!,
        value,
      );
    }),
    setChatmix: vi.fn(async (value) => {
      Object.assign(state.chatmix, value);
    }),
    getArtwork: vi.fn(async () => null),
  } as unknown as DesktopBridge;
  window.ssgg = bridge;
  return bridge;
}
it("assigns Chrome to a user-selected group and commits native gain through the bridge", async () => {
  const bridge = testBridge();
  render(<App />);
  const assignment = await screen.findByRole("combobox", { name: "Google Chrome group" });
  fireEvent.change(assignment, { target: { value: "chat" } });
  await waitFor(() => expect(bridge.setStream).toHaveBeenCalledWith({ id: "101", group: "chat" }));
  const gain = screen.getByRole("slider", { name: "Google Chrome volume" });
  fireEvent.change(gain, { target: { value: "0.55" } });
  fireEvent.keyUp(gain, { key: "ArrowLeft" });
  await waitFor(() => expect(bridge.setStream).toHaveBeenCalledWith({ id: "101", volume: 0.55 }));
  expect(bridge.setChatmix).not.toHaveBeenCalled();
});

it("shows the exact connected model and honest unsupported device controls", async () => {
  testBridge();
  render(<App />);
  await screen.findByRole("combobox", { name: "Google Chrome group" });
  fireEvent.click(screen.getByRole("button", { name: "Devices" }));
  expect(await screen.findByRole("heading", { name: "Arctis Nova 7 Gen 2" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "RGB lighting" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Hardware equalizer" })).toBeDisabled();
  expect(screen.getByText("Battery unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Download official photo" })).toBeEnabled();
});
it("refreshes visible state and disables controls when the service disappears", async () => {
  const bridge = testBridge();
  render(<App />);
  await screen.findByRole("combobox", { name: "Google Chrome group" });
  vi.mocked(bridge.getState).mockRejectedValue(new Error("Audio service disconnected"));
  expect(await screen.findByText("Audio service disconnected", {}, { timeout: 3500 })).toBeVisible();
  expect(screen.getByRole("button", { name: "Enable ChatMix" })).toBeDisabled();
});
afterEach(() => {
  cleanup();
  delete window.ssgg;
});
it("shows an honest unavailable screen without synthetic devices or enabled audio controls", async () => {
  render(<App />);
  expect(await screen.findByText("Desktop bridge unavailable")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Your audio, your balance." })).toBeVisible();
  expect(screen.queryByText("Arctis Nova 7 Gen 2")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enable ChatMix" })).toBeDisabled();
});
