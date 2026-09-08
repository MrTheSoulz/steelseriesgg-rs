// @vitest-environment node
import { expect, it } from "vitest";
import { hasTrayWatcher, trayIconFilename } from "../electron/service";

it("does not advertise a Linux tray just because Electron created an object", async () => {
  expect(await hasTrayWatcher(async () => "boolean false")).toBe(false);
  expect(
    await hasTrayWatcher(async () => {
      throw new Error("No session bus");
    }),
  ).toBe(false);
  expect(
    await hasTrayWatcher(async (name) => (name === "org.kde.StatusNotifierWatcher" ? "boolean true" : "boolean false")),
  ).toBe(true);
  expect(
    await hasTrayWatcher(async (name) =>
      name === "org.freedesktop.StatusNotifierWatcher" ? "boolean true" : "boolean false",
    ),
  ).toBe(true);
});
it("chooses a contrasting branded glyph for light and dark themes", () => {
  expect(trayIconFilename(true)).toBe("ssgg-tray-light.png");
  expect(trayIconFilename(false)).toBe("ssgg-tray-dark.png");
});
