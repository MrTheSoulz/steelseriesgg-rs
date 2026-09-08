import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import Devices from "../src/Devices";
import Mixer from "../src/Mixer";
import Profiles from "../src/Profiles";
import fixture from "./fixture.json";
import type { Snapshot, DesktopBridge } from "../src/shared/contracts";
afterEach(() => {
  cleanup();
  delete window.ssgg;
});
it("never shows a late photo for the wrong selected device", async () => {
  let resolve!: (value: string) => void;
  window.ssgg = {
    getArtwork: vi.fn(async () => null),
    downloadArtwork: vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    ),
  } as unknown as DesktopBridge;
  const devices = [
    fixture.devices[0],
    { ...fixture.devices[0], id: "second", name: "Other device" },
  ] as Snapshot["devices"];
  const { rerender } = render(<Devices devices={devices} selected={devices[0].id} onSelect={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Download official photo" }));
  rerender(<Devices devices={devices} selected="second" onSelect={() => {}} />);
  await act(async () => {
    resolve("data:image/png;base64,FIRST");
  });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("labels reliable binary identity and separately shows native amplification and base gain", () => {
  const state = structuredClone(fixture) as Snapshot;
  state.streams = [
    {
      ...state.streams[0],
      appName: "WEBRTC VoiceEngine",
      appKey: '["Discord","WEBRTC VoiceEngine",""]',
      name: "Voice stream",
      volume: 1.5,
      effectiveVolume: 1.2,
    },
  ];
  render(<Mixer snapshot={state} busy={false} loading={false} mutate={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "Discord group" })).toBeVisible();
  expect(screen.getByText("WEBRTC VoiceEngine · Voice stream")).toBeVisible();
  expect(screen.getByText("Native 120% · Base 150%")).toBeVisible();
  expect(screen.getByRole("slider", { name: "Discord volume" })).toHaveAttribute("max", "1");
  expect(screen.getByRole("combobox", { name: "Media ChatMix side" })).toBeVisible();
});
it("accepts punctuation profile names in the save form", () => {
  render(<Profiles snapshot={fixture as Snapshot} busy={false} mutate={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Profile name" }), { target: { value: "Music & calls" } });
  expect(screen.getByRole("button", { name: "Save current mix" })).toBeEnabled();
});
it("requires explicit hardware opt-in and blocks it in a safe session", async () => {
  const state = structuredClone(fixture) as Snapshot;
  state.physical = {
    hardwareEnabled: false,
    hardwareAcquired: false,
    connected: null,
    battery: null,
    sample: null,
    statusAtMs: null,
    stale: false,
    pending: false,
    sidetone: null,
    autoOffMinutesSent: null,
    lastCommand: null,
    error: null,
  };
  state.devices[0].capabilities.physicalChatmix = { supported: true, locallyValidated: false };
  const setDevice = vi.fn(async () => {}),
    setChatmix = vi.fn(async () => {});
  window.ssgg = { setDevice, setChatmix, getArtwork: vi.fn(async () => null) } as unknown as DesktopBridge;
  const mutate = async (action: (b: DesktopBridge) => Promise<unknown>) => {
    await action(window.ssgg!);
  };
  const props = { devices: state.devices, selected: "", onSelect: vi.fn(), physical: state.physical, mutate };
  const { rerender } = render(<Devices {...props} readOnly={false} />);
  await act(async () => {});
  expect(setDevice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enable hardware" }));
  expect(setDevice).toHaveBeenCalledWith({ id: state.devices[0].id, hardwareEnabled: true });
  expect(setChatmix).not.toHaveBeenCalled();
  rerender(<Devices {...props} readOnly />);
  expect(screen.getByRole("button", { name: "Enable hardware" })).toBeDisabled();
  expect(screen.getByText("No wheel event received")).toBeVisible();
});
it("sends only explicit sidetone, auto-off and refresh commands and shows independent hardware gains", async () => {
  const state = structuredClone(fixture) as Snapshot;
  state.physical = {
    deviceId: state.devices[0].id,
    hardwareEnabled: true,
    hardwareAcquired: true,
    connected: true,
    battery: 70,
    sample: { gamePercent: 80, chatPercent: 60, balance: -0.2, receivedAtMs: 1000 },
    statusAtMs: 1000,
    stale: false,
    pending: false,
    sidetone: 1,
    autoOffMinutesSent: 30,
    lastCommand: "completed",
    error: null,
  };
  state.chatmix = { ...state.chatmix, inputMode: "hardware", wheelAvailable: true };
  for (const key of ["physicalChatmix", "sidetone", "autoOff"])
    state.devices[0].capabilities[key] = { supported: true, locallyValidated: false };
  const setDevice = vi.fn(async () => {}),
    setChatmix = vi.fn(async () => {});
  window.ssgg = { setDevice, setChatmix, getArtwork: vi.fn(async () => null) } as unknown as DesktopBridge;
  const mutate = async (action: (b: DesktopBridge) => Promise<unknown>) => {
    await action(window.ssgg!);
  };
  const view = render(
    <Devices devices={state.devices} selected="" onSelect={vi.fn()} physical={state.physical} mutate={mutate} />,
  );
  await act(async () => {});
  fireEvent.change(screen.getByRole("combobox", { name: "Sidetone level" }), { target: { value: "2" } });
  expect(setDevice).toHaveBeenLastCalledWith({ id: state.devices[0].id, sidetone: 2 });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Auto-off minutes" }), { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "Send auto-off" }));
  expect(setDevice).toHaveBeenLastCalledWith({ id: state.devices[0].id, autoOffMinutes: 45 });
  fireEvent.click(screen.getByRole("button", { name: "Refresh hardware status" }));
  expect(setDevice).toHaveBeenLastCalledWith({ id: state.devices[0].id, statusRefresh: true });
  expect(screen.getByText("Last sent: 30 minutes · not read back")).toBeVisible();
  view.unmount();
  render(<Mixer snapshot={state} busy={false} loading={false} mutate={mutate} />);
  expect(screen.getByText("A 80% · B 60%")).toBeVisible();
  expect(screen.getByRole("slider", { name: "ChatMix balance" })).toBeDisabled();
  expect(setChatmix).not.toHaveBeenCalled();
});
