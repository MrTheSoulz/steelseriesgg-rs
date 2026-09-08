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
  // Metadata only: enforce allocation budgets BEFORE nativeImage or renderer decoding.
  if (bytes.length < 24 || bytes.length > 8 * 1024 * 1024) return false;
  const dimensions = (w: number, h: number) => w > 0 && h > 0 && w <= 8000 && h <= 8000 && w * h <= 16_000_000;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (
      bytes.length < 45 ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      !dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
    )
      return false;
    let data = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset),
        type = bytes.toString("ascii", offset + 4, offset + 8);
      if (length > bytes.length - offset - 12 || type === "acTL" || (type === "IHDR" && offset !== 8)) return false;
      if (type === "IDAT") data = true;
      offset += length + 12;
      if (type === "IEND") return data && length === 0 && offset === bytes.length;
    }
    return false;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  let frame = false;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 0xda) return frame && length >= 6;
    // Accept only ordinary baseline/progressive JPEG; no hierarchical or DNL-sized frames.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (
        frame ||
        ![0xc0, 0xc2].includes(marker) ||
        length < 11 ||
        !dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
      )
        return false;
      const components = bytes[offset + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) return false;
      frame = true;
    }
    offset += length;
  }
  return false;
}
