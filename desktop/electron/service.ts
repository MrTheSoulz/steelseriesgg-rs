import { lstat } from "node:fs/promises";
import path from "node:path";
import { createConnection } from "node:net";
import { JsonLineClient } from "./rpc";

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
