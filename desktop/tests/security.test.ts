// @vitest-environment node
import { it, expect } from "vitest";
import { assertTrustedFrame, resolveSidecar, isLocalAsset } from "../electron/security";
it("allows renderer assets only inside the built directory", () => {
  expect(isLocalAsset("file:///app/dist/assets/a.js", "/app/dist")).toBe(true);
  for (const url of [
    "https://example.com",
    "file:///app/dist/../secret",
    "file:///app/dist-other/a.js",
    "file:///etc/passwd",
  ])
    expect(isLocalAsset(url, "/app/dist")).toBe(false);
});
it("accepts only the exact local top-level renderer frame", () => {
  const main = { url: "file:///app/dist/index.html" };
  expect(() => assertTrustedFrame(main, main, "file:///app/dist/index.html")).not.toThrow();
  expect(() => assertTrustedFrame({ url: main.url }, main, main.url)).toThrow();
  expect(() => assertTrustedFrame(main, main, "file:///other/index.html")).toThrow();
  expect(() => assertTrustedFrame(null, main, main.url)).toThrow();
});
it("ignores environment executable overrides in packaged apps and rejects relative dev paths", () => {
  expect(resolveSidecar(true, "/app/resources", "/app/desktop", "/bin/evil")).toBe("/app/resources/ssgg-desktop");
  expect(() => resolveSidecar(false, "/app/resources", "/app/desktop", "./evil")).toThrow();
  expect(resolveSidecar(false, "/app/resources", "/app/desktop", "/trusted/ssgg_desktop")).toBe(
    "/trusted/ssgg_desktop",
  );
});
