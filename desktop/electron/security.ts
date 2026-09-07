import path from "node:path";
import { fileURLToPath } from "node:url";
export function isLocalAsset(url: string, directory: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:" || parsed.host) return false;
    const relative = path.relative(path.resolve(directory), fileURLToPath(parsed));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
export function assertTrustedFrame(frame: { url: string } | null, main: { url: string }, rendererURL: string) {
  if (!frame || frame !== main || frame.url !== rendererURL) throw new Error("Untrusted IPC sender");
}
export function resolveSidecar(packaged: boolean, resources: string, appPath: string, override?: string) {
  if (packaged) return path.join(resources, "ssgg-desktop");
  if (override) {
    if (!path.isAbsolute(override) || override.includes("\0"))
      throw new Error("SSGG_SIDECAR must be an absolute trusted development binary path");
    return override;
  }
  return path.resolve(appPath, "../target/debug/ssgg-desktop");
}
