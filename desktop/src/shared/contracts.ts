import { z } from "zod";
export const identifier = z.string().min(1).max(256);
export const gain = z.number().finite().min(0).max(1);
export const groupId = z.enum(["game", "chat", "media", "unmanaged"]);
export const side = z.enum(["a", "b", "none"]);
const profileName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N} _-]+$/u, "Use letters, numbers, spaces, hyphens or underscores");
const patchFields = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((v) => Object.keys(v).some((k) => k !== "id"), "Choose a setting to change");
const empty = z.object({}).strict();
const schemas: Record<string, z.ZodTypeAny> = {
  "state.get": empty,
  "streams.list": empty,
  "settings.get": empty,
  "profiles.list": empty,
  "devices.list": empty,
  "stream.set": patchFields({
    id: identifier,
    volume: gain.optional(),
    muted: z.boolean().optional(),
    group: groupId.optional(),
  }),
  "group.set": patchFields({
    id: groupId.exclude(["unmanaged"]),
    volume: gain.optional(),
    muted: z.boolean().optional(),
    wheelSide: side.optional(),
  }),
  "chatmix.set": patchFields({
    balance: z.number().finite().min(-1).max(1).optional(),
    enabled: z.boolean().optional(),
  }),
  "settings.set": z.object({ closeToTray: z.boolean() }).strict(),
  "profiles.save": z.object({ name: profileName }).strict(),
  "profiles.apply": z.object({ name: profileName }).strict(),
  // Unverified HID controls are deliberately not exposed at this boundary.
};
export function validateCommand(method: string, params: unknown): unknown {
  const schema = Object.hasOwn(schemas, method) ? schemas[method] : undefined;
  if (!schema) throw new Error("Unsupported command");
  return schema.parse(params);
}
export const streamSchema = z.object({
  id: identifier,
  appKey: identifier,
  name: z.string().max(512),
  appName: z.string().max(256),
  volume: gain,
  muted: z.boolean(),
  group: groupId,
  sinkId: z.union([z.string(), z.number()]).nullable().optional(),
});
export const groupSchema = z.object({
  id: groupId.exclude(["unmanaged"]),
  name: z.string().max(64),
  volume: gain,
  muted: z.boolean(),
  wheelSide: side,
});
export const deviceSchema = z.object({
  id: identifier,
  name: z.string().max(256),
  vendorId: z.number().int().min(0).max(65535),
  productId: z.number().int().min(0).max(65535),
  connected: z.boolean(),
  kind: z.enum(["headset", "keyboard", "other"]).default("other"),
  battery: z.number().min(0).max(100).nullable().optional(),
  capabilities: z.record(z.object({ supported: z.boolean(), reason: z.string().max(1024).optional() })).default({}),
});
export const snapshotSchema = z.object({
  readOnly: z.boolean().optional(),
  streams: z.array(streamSchema).max(1024),
  groups: z.array(groupSchema).max(3),
  devices: z.array(deviceSchema).max(128),
  chatmix: z.object({
    balance: z.number().min(-1).max(1),
    enabled: z.boolean(),
    wheelAvailable: z.boolean().default(false),
    reason: z.string().optional(),
  }),
  audio: z.object({ available: z.boolean(), reason: z.string().optional() }),
  profiles: z.array(z.object({ name: profileName })).default([]),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Stream = z.infer<typeof streamSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type StreamPatch = { id: string; volume?: number; muted?: boolean; group?: Stream["group"] };
export type GroupPatch = { id: Group["id"]; volume?: number; muted?: boolean; wheelSide?: Group["wheelSide"] };
export type RuntimeInfo = {
  readOnly?: boolean;
  connected: boolean;
  message: string;
  trayAvailable: boolean;
  closeToTray: boolean;
  transport: "sidecar";
  testMode: boolean;
};
export interface DesktopBridge {
  getState(): Promise<Snapshot>;
  getRuntime(): Promise<RuntimeInfo>;
  setStream(value: StreamPatch): Promise<void>;
  setGroup(value: GroupPatch): Promise<void>;
  setChatmix(value: { balance?: number; enabled?: boolean }): Promise<void>;
  saveProfile(name: string): Promise<void>;
  applyProfile(name: string): Promise<void>;
  setCloseToTray(enabled: boolean): Promise<RuntimeInfo>;
  getArtwork(deviceId: string): Promise<string | null>;
  chooseArtwork(deviceId: string): Promise<string | null>;
  downloadArtwork(deviceId: string): Promise<string | null>;
}
declare global {
  interface Window {
    ssgg?: DesktopBridge;
  }
}
