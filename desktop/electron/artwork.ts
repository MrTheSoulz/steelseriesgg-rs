import { dialog, nativeImage, type BrowserWindow } from "electron";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { artworkFor, artworkKey, isAllowedRaster, contentBounds } from "./artwork-policy";
import type { Device } from "../src/shared/contracts";
export class ArtworkStore {
  constructor(private directory: string) {}
  private file(id: string) {
    return path.join(this.directory, artworkKey(id) + ".png");
  }
  async get(id: string): Promise<string | null> {
    try {
      const file = this.file(id);
      if ((await stat(file)).size > 8 * 1024 * 1024) return null;
      const bytes = await readFile(file);
      return isAllowedRaster(bytes) ? "data:image/png;base64," + bytes.toString("base64") : null;
    } catch {
      return null;
    }
  }
  private async save(device: Device, bytes: Buffer, origin: string) {
    if (!isAllowedRaster(bytes))
      throw new Error("Choose a valid static PNG or JPEG under 8 MB, 8000 pixels per side and 16 megapixels.");
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error("This image could not be decoded. Choose a different PNG or JPEG.");
    const size = image.getSize();
    if (size.width > 8000 || size.height > 8000 || size.width * size.height > 16_000_000)
      throw new Error("Choose an image no larger than 8000 pixels per side.");
    const cropped = image.crop(contentBounds(image.toBitmap(), size.width, size.height));
    const png = (cropped.getSize().width > 1200 ? cropped.resize({ width: 1200 }) : cropped).toPNG();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.file(device.id), png, { mode: 0o600 });
    await writeFile(
      this.file(device.id) + ".json",
      JSON.stringify(
        {
          model: device.name,
          origin,
          rights:
            origin === "User-selected local image"
              ? "User-provided; not redistributed"
              : "© SteelSeries; manufacturer artwork; not covered by project code license",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return this.get(device.id);
  }
  async choose(device: Device, window: BrowserWindow) {
    const picked = await dialog.showOpenDialog(window, {
      title: `Choose a photo for ${device.name}`,
      properties: ["openFile"],
      filters: [{ name: "Device photo", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return this.get(device.id);
    const file = picked.filePaths[0];
    if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
    return this.save(device, await readFile(file), "User-selected local image");
  }
  async download(device: Device) {
    const artwork = artworkFor(device.vendorId, device.productId);
    if (!artwork) throw new Error("No verified official photograph for this model. Choose a local image instead.");
    const response = await fetch(artwork.imageURL, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "image/png,image/jpeg" },
    });
    if (!response.ok || !response.body)
      throw new Error("Manufacturer image unavailable. Choose a local image or try again later.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Manufacturer image exceeds 8 MB.");
      }
      chunks.push(value);
    }
    return this.save(device, Buffer.concat(chunks), artwork.imageURL);
  }
}
