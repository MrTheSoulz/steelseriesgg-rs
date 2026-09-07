import { z } from "zod";
import { snapshotSchema, streamSchema, groupSchema, deviceSchema, validateCommand } from "../src/shared/contracts";
const nativeSnapshot = z.object({
  streams: z.array(streamSchema.extend({ id: z.number().int().min(0).max(4294967295) })).max(1024),
  groups: z.array(groupSchema).max(3),
  devices: z.array(deviceSchema).max(128),
  mixer: z.object({ enabled: z.boolean(), balance: z.number().finite().min(-1).max(1) }),
  backend: z.object({ connected: z.boolean(), error: z.string().nullable().optional() }),
  profiles: snapshotSchema.shape.profiles,
});
export function adaptSnapshot(value: unknown) {
  const direct = snapshotSchema.safeParse(value);
  if (direct.success) return direct.data;
  const native = nativeSnapshot.parse(value);
  return snapshotSchema.parse({
    ...native,
    streams: native.streams.map((s) => ({ ...s, id: String(s.id) })),
    chatmix: {
      ...native.mixer,
      wheelAvailable: false,
      reason: "The local service has not exposed verified physical-wheel input.",
    },
    audio: { available: native.backend.connected, reason: native.backend.error ?? undefined },
  });
}
export function toWireCommand(method: string, params: unknown) {
  const valid = validateCommand(method, params) as Record<string, unknown>;
  if (method === "stream.set") {
    const id = z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .parse(valid.id);
    const numeric = z.number().int().min(0).max(4294967295).parse(Number(id));
    return { ...valid, id: numeric };
  }
  return valid;
}
