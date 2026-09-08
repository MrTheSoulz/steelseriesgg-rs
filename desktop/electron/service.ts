import { lstat } from "node:fs/promises";
import path from "node:path";
import { createConnection } from "node:net";
import { JsonLineClient } from "./rpc";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
async function queryBusOwner(name: string) {
  const { stdout } = await execFileAsync(
    "dbus-send",
    [
      "--session",
      "--print-reply",
      "--reply-timeout=1000",
      "--dest=org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus.NameHasOwner",
      `string:${name}`,
    ],
    { timeout: 1500, maxBuffer: 4096 },
  );
  return stdout;
}
/** A Tray object alone is not evidence of a GNOME indicator extension/watcher. */
export async function hasTrayWatcher(query: (name: string) => Promise<string> = queryBusOwner) {
  const results = await Promise.all(
    ["org.kde.StatusNotifierWatcher", "org.freedesktop.StatusNotifierWatcher"].map(async (name) => {
      try {
        return /\bboolean\s+true\b/.test(await query(name));
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}
export function trayIconFilename(darkTheme: boolean) {
  return darkTheme ? "ssgg-tray-light.png" : "ssgg-tray-dark.png";
}

export function assertWritable(readOnly: boolean) {
  if (readOnly) throw new Error("Read-only session: audio, hardware and profile writes are blocked.");
}

/** The renderer never supplies a transport path. Reject unsafe existing paths rather than falling back. */
export async function connectPrivateService(runtimeDir: string | undefined) {
  if (!runtimeDir) return null;
  if (!path.isAbsolute(runtimeDir)) throw new Error("Service runtime directory must be private and absolute.");
  const directory = path.join(runtimeDir, "ssgg-desktop");
  const target = path.join(directory, "service.sock");
  try {
    for (const name of [runtimeDir, directory, target]) {
      const info = await lstat(name);
      if (
        info.isSymbolicLink() ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0 ||
        (name === target ? !info.isSocket() : !info.isDirectory())
      )
        throw new Error(
          "Service socket and directories must be owned by you and private (0700 directory, 0600 socket).",
        );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const socket = createConnection(target);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Private service connection timed out. Check the service, then refresh."));
    }, 1500);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "Private service socket is unavailable. Check the service, then refresh; no competing sidecar was started.",
        ),
      );
    });
  });
  const rpc = new JsonLineClient(socket, socket);
  return {
    rpc,
    socket,
    close: () => {
      rpc.close();
      socket.destroy();
    },
  };
}
