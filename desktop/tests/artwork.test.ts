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
  expect(isAllowedRaster(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))).toBe(true);
});
