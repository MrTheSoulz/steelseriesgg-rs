// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtemp, mkdir, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Socket } from "node:net";
import { connectPrivateService, assertWritable } from "../electron/service";

it("uses only an owned private socket, disconnects without stopping its owner, and reconnects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ssgg-uds-"));
  const directory = path.join(root, "ssgg-desktop");
  await mkdir(directory, { mode: 0o700 });
  const target = path.join(directory, "service.sock");
  const peers = new Set<Socket>();
  const server = createServer((socket) => {
    peers.add(socket);
    socket.on("close", () => peers.delete(socket));
    socket.on("data", (data) => {
      for (const line of data.toString().trim().split("\n")) {
        const request = JSON.parse(line);
        socket.write(JSON.stringify({ id: request.id, result: { alive: true } }) + "\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(target, resolve));
  await chmod(target, 0o600);
  try {
    const connection = await connectPrivateService(root);
    expect(connection).not.toBeNull();
    expect(await connection!.rpc.request("state.get", {})).toEqual({ alive: true });
    connection!.close();
    expect(server.listening).toBe(true);
    const again = await connectPrivateService(root);
    expect(await again!.rpc.request("state.get", {})).toEqual({ alive: true });
    again!.close();
    await chmod(directory, 0o755);
    await expect(connectPrivateService(root)).rejects.toThrow(/private/);
    await chmod(directory, 0o700);
    await chmod(target, 0o666);
    await expect(connectPrivateService(root)).rejects.toThrow(/private/);
  } finally {
    for (const peer of peers) peer.destroy();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("missing service permits fallback but symlink runtime directories do not", async () => {
  expect(await connectPrivateService(undefined)).toBeNull();
  const root = await mkdtemp(path.join(tmpdir(), "ssgg-no-uds-"));
  try {
    expect(await connectPrivateService(root)).toBeNull();
    await symlink(root, root + "-link");
    await expect(connectPrivateService(root + "-link")).rejects.toThrow(/private/);
  } finally {
    await rm(root + "-link", { force: true });
    await rm(root, { recursive: true });
  }
});
it("blocks all backend mutations in safe sessions independently of the backend", () => {
  expect(() => assertWritable(true)).toThrow(/Read-only/);
  expect(() => assertWritable(false)).not.toThrow();
});
