import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import fixture from "./fixture.json";
import type { DesktopBridge, Snapshot } from "../src/shared/contracts";

function setup() {
  const state = structuredClone(fixture) as Snapshot;
  state.chatmix = { ...state.chatmix, inputMode: "software", reason: "Hardware not acquired" };
  state.devices[0].capabilities.physicalChatmix = { supported: true };
  state.physical = {
    deviceId: null,
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
  const commands: string[] = [];
  const bridge = {
    getState: vi.fn(async () => {
      commands.push("read");
      return structuredClone(state);
    }),
    getRuntime: vi.fn(async () => ({
      connected: true,
      message: "Fixture",
      trayAvailable: false,
      closeToTray: false,
      transport: "sidecar",
      testMode: true,
    })),
    setDevice: vi.fn(async () => {
      commands.push("acquire");
      state.physical!.pending = true;
    }),
    setChatmix: vi.fn(async (patch) => {
      commands.push("select");
      Object.assign(state.chatmix, patch);
    }),
    getArtwork: vi.fn(async () => null),
  } as unknown as DesktopBridge;
  window.ssgg = bridge;
  const fresh = () => {
    Object.assign(state.physical!, {
      deviceId: state.devices[0].id,
      hardwareEnabled: true,
      hardwareAcquired: true,
      connected: true,
      stale: false,
      pending: false,
      sample: { gamePercent: 100, chatPercent: 60, balance: -0.4, receivedAtMs: Date.now() },
      statusAtMs: Date.now(),
      error: null,
    });
    state.chatmix.wheelAvailable = true;
  };
  return { state, bridge, commands, fresh };
}
afterEach(() => {
  cleanup();
  delete window.ssgg;
  vi.useRealTimers();
});

it("selects already-acquired hardware in one action and discloses the live position before consent", async () => {
  const { bridge, state, fresh } = setup();
  fresh();
  state.chatmix.enabled = true;
  render(<App />);
  const button = await screen.findByRole("button", { name: "Use headset wheel" });
  expect(screen.getByText(/selecting the wheel immediately uses its current position/)).toBeVisible();
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByText("Headset wheel active")).toBeVisible();
  expect(bridge.setDevice).not.toHaveBeenCalled();
  expect(bridge.setChatmix).toHaveBeenCalledExactlyOnceWith({ inputMode: "hardware" });
  fireEvent.click(screen.getByRole("button", { name: "Use on-screen balance" }));
  await waitFor(() => expect(state.chatmix.inputMode).toBe("software"));
  expect(state.chatmix.enabled).toBe(true);
});

it("waits for an already-acquired receiver without reacquiring it", async () => {
  const { bridge, state, fresh } = setup();
  fresh();
  state.physical!.sample = null;
  state.physical!.pending = true;
  state.chatmix.wheelAvailable = false;
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Use headset wheel" }));
  await act(async () => {});
  expect(bridge.setDevice).not.toHaveBeenCalled();
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  fresh();
  expect(await screen.findByText("Headset wheel active")).toBeVisible();
});

it.each([
  [
    "read-only",
    "Read-only session — reopen SSGG in normal mode to use hardware.",
    (s: Snapshot) => {
      s.readOnly = true;
    },
  ],
  [
    "backend unavailable",
    "Audio service unavailable. Refresh to reconnect; on-screen controls stay blocked.",
    (s: Snapshot) => {
      s.audio.available = false;
    },
  ],
  [
    "no USB",
    "Connect a supported headset’s USB receiver, then refresh. On-screen balance works independently.",
    (s: Snapshot) => {
      s.devices = [];
    },
  ],
  [
    "unsupported",
    "This headset does not expose supported wheel input. Use on-screen balance.",
    (s: Snapshot) => {
      s.devices[0].capabilities.physicalChatmix.supported = false;
    },
  ],
  [
    "old service",
    "This service does not expose headset access. Update the SSGG service; on-screen balance works independently.",
    (s: Snapshot) => {
      delete s.physical;
    },
  ],
] as const)("explains %s without any hardware or source writes", async (_name, reason, change) => {
  const { bridge, state } = setup();
  change(state);
  render(<App />);
  expect(await screen.findByText(reason)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use headset wheel" }));
  expect(bridge.setDevice).not.toHaveBeenCalled();
  expect(bridge.setChatmix).not.toHaveBeenCalled();
});

it("requires a receiver choice when ambiguous, then uses the explicit selected receiver", async () => {
  const { bridge, state, fresh } = setup();
  state.devices.push({ ...structuredClone(state.devices[0]), id: "second", name: "Second headset" });
  render(<App />);
  expect(await screen.findByText("Multiple headset receivers detected. Choose the headset to use.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Use headset wheel" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Choose headset" }));
  fireEvent.click(screen.getByRole("button", { name: "Second headset USB connected" }));
  fireEvent.click(screen.getByRole("button", { name: "Mixer" }));
  fireEvent.click(screen.getByRole("button", { name: "Use headset wheel" }));
  await waitFor(() => expect(bridge.setDevice).toHaveBeenCalledWith({ id: "second", hardwareEnabled: true }));
  fresh();
  state.physical!.deviceId = "second";
  expect(await screen.findByText("Headset wheel active")).toBeVisible();
});

it.each(["failed", "offline", "service lost", "USB lost", "support lost", "read-only changed"])(
  "keeps input unchanged when setup reports %s, retaining the error across refresh",
  async (failure) => {
    const { bridge, state, fresh } = setup();
    render(<App />);
    const button = await screen.findByRole("button", { name: "Use headset wheel" });
    if (failure === "failed") vi.mocked(bridge.setDevice).mockRejectedValue(new Error("USB permission denied"));
    else
      vi.mocked(bridge.setDevice).mockImplementation(async () => {
        fresh();
        if (failure === "offline") state.physical!.connected = false;
        if (failure === "service lost") state.audio.available = false;
        if (failure === "USB lost") state.devices = [];
        if (failure === "support lost") state.devices[0].capabilities.physicalChatmix.supported = false;
        if (failure === "read-only changed") state.readOnly = true;
      });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(bridge.setChatmix).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh audio and devices" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toBeVisible();
    expect(bridge.setDevice).toHaveBeenCalledTimes(1);
    expect(bridge.setChatmix).not.toHaveBeenCalled();
  },
);

it.each(["cancel", "timeout", "navigate away"])("never selects from a late read after %s", async (end) => {
  vi.useFakeTimers();
  const { bridge, fresh, state } = setup();
  render(<App />);
  await act(async () => {});
  let resolve!: (state: Snapshot) => void;
  vi.mocked(bridge.getState).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use headset wheel" }));
  await act(async () => {});
  if (end === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel wheel setup" }));
  if (end === "navigate away") fireEvent.click(screen.getByRole("button", { name: "Devices" }));
  if (end === "timeout")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
  await act(async () => {});
  fresh();
  await act(async () => {
    resolve(structuredClone(state));
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  expect(bridge.setDevice).toHaveBeenCalledTimes(1);
  if (end !== "navigate away") expect(screen.getByRole("button", { name: "Retry headset wheel" })).toBeEnabled();
});

it.each(["wrong device", "stale", "no sample", "pending"])(
  "times out rather than select a %s wheel reading",
  async (invalid) => {
    vi.useFakeTimers();
    const { bridge, state, fresh } = setup();
    render(<App />);
    await act(async () => {});
    vi.mocked(bridge.setDevice).mockImplementation(async () => {
      fresh();
      if (invalid === "wrong device") state.physical!.deviceId = "other-receiver";
      if (invalid === "stale") state.physical!.stale = true;
      if (invalid === "no sample") state.physical!.sample = null;
      if (invalid === "pending") state.physical!.pending = true;
    });
    fireEvent.click(screen.getByRole("button", { name: "Use headset wheel" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8500);
    });
    expect(screen.getAllByText(/Connection timed out/).length).toBeGreaterThan(0);
    expect(bridge.setChatmix).not.toHaveBeenCalled();
    fresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(bridge.setChatmix).not.toHaveBeenCalled();
    expect(bridge.setDevice).toHaveBeenCalledTimes(1);
  },
);

it("does not send the source command if ChatMix becomes enabled during connection", async () => {
  const { bridge, state, fresh } = setup();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Use headset wheel" }));
  await act(async () => {});
  fresh();
  state.chatmix.enabled = true;
  expect(await screen.findAllByText(/ChatMix changed during setup/)).not.toHaveLength(0);
  expect(bridge.setChatmix).not.toHaveBeenCalled();
});

it("does not repeat the obsolete Devices prerequisite beside the in-Mixer action", async () => {
  const { state } = setup();
  state.chatmix.reason =
    "Enable hardware in Devices, then move the wheel. Hardware acquisition does not enable ChatMix.";
  render(<App />);
  await screen.findByRole("button", { name: "Use headset wheel" });
  expect(screen.queryByText(/Enable hardware in Devices/)).not.toBeInTheDocument();
});

it("reports the actual active source even after choosing another device to inspect", async () => {
  const { state, fresh } = setup();
  fresh();
  state.chatmix.inputMode = "hardware";
  state.devices.push({ ...structuredClone(state.devices[0]), id: "second", name: "Second headset" });
  render(<App />);
  expect(await screen.findByText("Headset wheel active")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Second headset USB connected" }));
  fireEvent.click(screen.getByRole("button", { name: "Mixer" }));
  expect(screen.getByText("Headset wheel active")).toBeVisible();
  expect(screen.getByRole("button", { name: "Use headset wheel" })).toBeEnabled();
});

it("recovers only on explicit retry after a failed acquisition", async () => {
  const { bridge, fresh } = setup();
  vi.mocked(bridge.setDevice).mockRejectedValueOnce(new Error("USB permission denied"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Use headset wheel" }));
  const retry = await screen.findByRole("button", { name: "Retry headset wheel" });
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  vi.mocked(bridge.setDevice).mockImplementation(async () => fresh());
  fireEvent.click(retry);
  expect(await screen.findByText("Headset wheel active")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(bridge.setDevice).toHaveBeenCalledTimes(2);
  expect(bridge.setChatmix).toHaveBeenCalledExactlyOnceWith({ inputMode: "hardware" });
});

it("ignores a late acquisition acknowledgement after timeout", async () => {
  vi.useFakeTimers();
  const { bridge, fresh } = setup();
  let complete!: () => void;
  vi.mocked(bridge.setDevice).mockImplementation(
    () =>
      new Promise((r) => {
        complete = r;
      }),
  );
  render(<App />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Use headset wheel" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  fresh();
  await act(async () => {
    complete();
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Retry headset wheel" })).toBeEnabled();
});

it.each(["read rejected", "source rejected", "source unconfirmed"])(
  "shows %s as an error, never a successful source selection",
  async (failure) => {
    const { bridge, fresh } = setup();
    fresh();
    render(<App />);
    const button = await screen.findByRole("button", { name: "Use headset wheel" });
    if (failure === "read rejected")
      vi.mocked(bridge.getState).mockRejectedValueOnce(new Error("Service disconnected"));
    if (failure === "source rejected")
      vi.mocked(bridge.setChatmix).mockRejectedValueOnce(new Error("Source unavailable"));
    if (failure === "source unconfirmed") vi.mocked(bridge.setChatmix).mockImplementationOnce(async () => {});
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Retry headset wheel" });
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.queryByText("Headset wheel active")).not.toBeInTheDocument();
    expect(screen.queryByText("Headset wheel selected", { exact: true })).not.toBeInTheDocument();
    if (failure === "read rejected") expect(bridge.setChatmix).not.toHaveBeenCalled();
    expect(bridge.setDevice).not.toHaveBeenCalled();
  },
);

it("offers wheel setup in the default Mixer and acquires → confirms a fresh sample → selects without enabling", async () => {
  const { bridge, state, commands, fresh } = setup();
  const assignments = structuredClone(state.streams);
  render(<App />);
  const button = await screen.findByRole("button", { name: "Use headset wheel" });
  expect(button).toBeEnabled();
  expect(bridge.setDevice).not.toHaveBeenCalled();
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  commands.length = 0;
  fireEvent.click(button);
  expect(await screen.findByText("Connecting to headset…")).toBeVisible();
  await waitFor(() =>
    expect(bridge.setDevice).toHaveBeenCalledWith({ id: state.devices[0].id, hardwareEnabled: true }),
  );
  expect(bridge.setChatmix).not.toHaveBeenCalled();
  fresh();
  await waitFor(() => expect(bridge.setChatmix).toHaveBeenCalledExactlyOnceWith({ inputMode: "hardware" }));
  expect(commands[0]).toBe("acquire");
  expect(commands.slice(1, commands.indexOf("select"))).toContain("read");
  expect(await screen.findByText("Headset wheel active")).toBeVisible();
  expect(screen.getByText("ChatMix is off — the wheel is not changing audio.")).toBeVisible();
  expect(state.chatmix.enabled).toBe(false);
  expect(state.streams).toEqual(assignments);
});
