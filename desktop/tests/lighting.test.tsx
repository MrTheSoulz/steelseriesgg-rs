import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Devices from "../src/Devices";
import { adaptSnapshot, toWireCommand } from "../electron/adapter";
import { deviceSchema, type DesktopBridge } from "../src/shared/contracts";
import fixture from "./fixture.json";
const request = { id: "1038:1642:fixture", allowHardware: true, color: [255, 128, 0], brightness: 50 };
const keyboard = () =>
  deviceSchema.parse({
    id: request.id,
    name: "Apex Pro TKL Gen 3",
    vendorId: 0x1038,
    productId: 0x1642,
    kind: "keyboard",
    connected: true,
    capabilities: {
      rgb: {
        supported: true,
        applicable: true,
        locallyValidated: false,
        reason: "Source-derived; physical validation pending",
      },
    },
  });
afterEach(() => {
  cleanup();
  delete window.ssgg;
});
it("validates the named one-shot RGB command and preserves capability/sent-only data through the adapter", () => {
  expect(toWireCommand("lighting.apply", request)).toEqual(request);
  for (const change of [
    { color: [-1, 0, 0] },
    { color: [0, 0, 256] },
    { color: [1, 2] },
    { color: [1, 2, 3, 4] },
    { color: [1.5, 0, 0] },
    { brightness: 101 },
    { brightness: -1 },
    { brightness: NaN },
    { brightness: 1.5 },
    { allowHardware: false },
    { allowHardware: undefined },
    { effect: "rainbow" },
    { id: "" },
  ]) {
    expect(() => toWireCommand("lighting.apply", { ...request, ...change })).toThrow();
  }
  const device = keyboard();
  const snapshot = adaptSnapshot({
    ...fixture,
    devices: [{ ...device, lighting: { lastSent: { color: [255, 128, 0], brightness: 50 } } }],
  });
  expect(snapshot.devices[0].capabilities.rgb.applicable).toBe(true);
  expect(snapshot.devices[0].lighting?.lastSent).toEqual({ color: [255, 128, 0], brightness: 50 });
  const pending = adaptSnapshot({
    ...fixture,
    devices: [{ ...device, lighting: { lastSent: null, pending: true, error: null } }],
  });
  expect(pending.devices[0].lighting?.pending).toBe(true);
});
it("only sends on explicit permission plus Apply; edits, discovery and device switches send nothing", async () => {
  const applyLighting = vi.fn(async () => {});
  window.ssgg = { applyLighting, getArtwork: vi.fn(async () => null) } as unknown as DesktopBridge;
  const mutate = async (action: (bridge: DesktopBridge) => Promise<unknown>) => {
    await action(window.ssgg!);
  };
  const device = keyboard();
  const props = { devices: [device], selected: device.id, onSelect: vi.fn(), mutate };
  const { rerender } = render(<Devices {...props} />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Apply lighting" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Lighting color"), { target: { value: "#ff8000" } });
  fireEvent.change(screen.getByRole("slider", { name: "Lighting brightness" }), { target: { value: "50" } });
  expect(applyLighting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow this lighting write/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Apply lighting" }));
  });
  expect(applyLighting).toHaveBeenCalledExactlyOnceWith(request);
  expect(screen.getByRole("checkbox", { name: /Allow this lighting write/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow this lighting write/ }));
  rerender(<Devices {...props} devices={[{ ...device, id: "1038:1642:second" }]} selected="1038:1642:second" />);
  await act(async () => {});
  expect(screen.getByRole("checkbox", { name: /Allow this lighting write/ })).not.toBeChecked();
  expect(applyLighting).toHaveBeenCalledTimes(1);
});
it("shows only relevant keyboard controls and makes off/presets explicit drafts", async () => {
  const applyLighting = vi.fn(async () => {});
  window.ssgg = { applyLighting, getArtwork: vi.fn(async () => null) } as unknown as DesktopBridge;
  const mutate = async (action: (bridge: DesktopBridge) => Promise<unknown>) => {
    await action(window.ssgg!);
  };
  render(<Devices devices={[keyboard()]} selected="" onSelect={vi.fn()} mutate={mutate} />);
  await act(async () => {});
  expect(screen.queryByRole("heading", { name: "Headset connection & controls" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "White" }));
  fireEvent.click(screen.getByRole("button", { name: "Off" }));
  expect(applyLighting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow this lighting write/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Apply lighting" }));
  });
  expect(applyLighting).toHaveBeenCalledWith({ ...request, color: [255, 255, 255], brightness: 0 });
});
it("disables RGB in read-only, busy, disconnected and unavailable-bridge states", async () => {
  const mutate = vi.fn(async () => {});
  const props = { devices: [keyboard()], selected: "", onSelect: vi.fn(), mutate };
  const { rerender } = render(<Devices {...props} readOnly />);
  for (const state of [
    { readOnly: true },
    { saving: true },
    { devices: [{ ...keyboard(), connected: false }] },
    { mutate: undefined },
  ]) {
    rerender(<Devices {...props} {...state} />);
    await act(async () => {});
    expect(screen.getByLabelText("Lighting color")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Allow this lighting write/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply lighting" })).toBeDisabled();
  }
  expect(mutate).not.toHaveBeenCalled();
});
it("leaves experimental devices unavailable and distinguishes drafts from historical sends", async () => {
  const device = keyboard();
  const props = {
    devices: [
      {
        ...device,
        capabilities: {
          rgb: { supported: false, applicable: true, reason: "Firmware-dependent experimental protocol unavailable" },
        },
      },
    ],
    selected: "",
    onSelect: vi.fn(),
  };
  const { rerender } = render(<Devices {...props} />);
  expect(screen.getByText(/Firmware-dependent experimental/)).toBeVisible();
  expect(screen.queryByLabelText("Lighting color")).not.toBeInTheDocument();
  rerender(<Devices {...props} devices={[device]} mutate={vi.fn(async () => {})} />);
  fireEvent.change(screen.getByLabelText("Lighting color"), { target: { value: "#123456" } });
  rerender(
    <Devices
      {...props}
      devices={[{ ...device, lighting: { lastSent: { color: [255, 128, 0], brightness: 50 } } }]}
      mutate={vi.fn(async () => {})}
    />,
  );
  expect(screen.getByLabelText("Lighting color")).toHaveValue("#123456");
  expect(screen.getByText(/Last sent: #FF8000/)).toHaveTextContent("No device readback");
  await act(async () => {});
});
it("shows backend pending and failure separately from sent history", async () => {
  const device = keyboard();
  const props = {
    devices: [{ ...device, lighting: { lastSent: null, pending: true, error: null } }],
    selected: "",
    onSelect: vi.fn(),
    mutate: vi.fn(async () => {}),
  };
  const { rerender } = render(<Devices {...props} />);
  expect(screen.getByRole("button", { name: "Applying lighting…" })).toBeDisabled();
  expect(screen.getByText("Lighting write in progress…")).toBeVisible();
  expect(screen.queryByText(/Last sent:/)).not.toBeInTheDocument();
  rerender(
    <Devices
      {...props}
      devices={[
        { ...device, lighting: { lastSent: null, pending: false, error: "Keyboard disconnected; refresh and retry" } },
      ]}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Keyboard disconnected; refresh and retry");
  expect(screen.queryByText(/Last sent:/)).not.toBeInTheDocument();
  await act(async () => {});
});
it("does not expose an RGB section or controls on the non-RGB Nova headset", async () => {
  render(<Devices devices={[deviceSchema.parse(fixture.devices[0])]} selected="" onSelect={vi.fn()} />);
  await act(async () => {});
  expect(screen.queryByRole("heading", { name: "RGB lighting" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Lighting color")).not.toBeInTheDocument();
});
