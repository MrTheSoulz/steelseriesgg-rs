import { createHash } from "node:crypto";
export { artworkFor } from "../src/shared/artwork-catalog";
export function contentBounds(bitmap: Buffer, width: number, height: number) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (bitmap[(y * width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) return { x: 0, y: 0, width, height };
  const padding = Math.max(8, Math.ceil(Math.max(right - left, bottom - top) * 0.06));
  const x = Math.max(0, left - padding),
    y = Math.max(0, top - padding);
  return { x, y, width: Math.min(width, right + padding + 1) - x, height: Math.min(height, bottom + padding + 1) - y };
}
export const artworkKey = (id: string) => createHash("sha256").update(id).digest("hex");
export function isAllowedRaster(bytes: Buffer) {
  return (
    bytes.length <= 8 * 1024 * 1024 &&
    (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff))
  );
}
