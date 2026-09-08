// @vitest-environment node
import { it, expect } from "vitest";
import { artworkFor, isAllowedRaster, artworkKey, contentBounds } from "../electron/artwork-policy";
it("trims only transparent image margins, preserving the full headset and receiver", () => {
  const pixels = Buffer.alloc(100 * 80 * 4);
  pixels[(10 * 100 + 30) * 4 + 3] = 255;
  pixels[(70 * 100 + 65) * 4 + 3] = 255;
  const bounds = contentBounds(pixels, 100, 80);
  expect(bounds.x).toBeLessThanOrEqual(30);
  expect(bounds.y).toBeLessThanOrEqual(10);
  expect(bounds.x + bounds.width).toBeGreaterThan(65);
  expect(bounds.y + bounds.height).toBeGreaterThan(70);
  expect(bounds.width).toBeLessThan(100);
});
it("matches only the precise model and generation, never a generic keyboard or headset", () => {
  expect(artworkFor(0x1038, 0x227e)?.model).toBe("Arctis Nova 7 Gen 2");
  expect(artworkFor(0x1038, 0x2202)).toBeNull();
  expect(artworkFor(0x1038, 0x1610)).toBeNull();
  expect(artworkKey("../../secret")).toMatch(/^[a-f0-9]{64}$/);
  expect(isAllowedRaster(Buffer.from('<svg onload="evil"/>'))).toBe(false);
  expect(isAllowedRaster(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))).toBe(false);
});
it("rejects oversized dimensions and pixel bombs from metadata before any decode", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  expect(isAllowedRaster(png)).toBe(true);
  const huge = Buffer.from(png);
  huge.writeUInt32BE(100000, 16);
  expect(isAllowedRaster(huge)).toBe(false);
  huge.writeUInt32BE(8000, 16);
  huge.writeUInt32BE(8000, 20);
  expect(isAllowedRaster(huge)).toBe(false);
  expect(isAllowedRaster(png.subarray(0, 24))).toBe(false);
  expect(isAllowedRaster(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]))).toBe(false);
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xff, 0xd9,
  ]);
  expect(isAllowedRaster(jpeg)).toBe(true);
  jpeg.writeUInt16BE(65535, 7);
  expect(isAllowedRaster(jpeg)).toBe(false);
});
