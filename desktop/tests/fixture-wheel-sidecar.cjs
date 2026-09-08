#!/usr/bin/env node
// Private smoke fixture only: no HID, audio, filesystem configuration or network access.
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
const state = structuredClone(require("./fixture.json"));
const mode = process.env.SSGG_TEST_WHEEL_CASE || "success";
state.devices[0].capabilities.physicalChatmix = { supported: true };
state.chatmix.inputMode = "software";
state.physical = {
  deviceId: null,
  hardwareEnabled: false,
  hardwareAcquired: false,
  connected: null,
  battery: null,
  sample: null,
  statusAtMs: null,
  stale: false,
  pending: false,
  sidetone: null,
  autoOffMinutesSent: null,
  lastCommand: null,
  error: null,
};
let readsAfterAcquire = 0;
function sample() {
  Object.assign(state.physical, {
    deviceId: state.devices[0].id,
    hardwareEnabled: true,
    hardwareAcquired: true,
    connected: true,
    pending: false,
    stale: false,
    statusAtMs: Date.now(),
    sample: { gamePercent: 100, chatPercent: 60, balance: -0.4, receivedAtMs: Date.now() },
  });
}
if (mode === "acquired") sample();
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  let result = { ok: true };
  let error;
  if (method === "device.set") {
    if (mode === "failure") error = { code: "HARDWARE_UNAVAILABLE", message: "Fixture USB permission denied" };
    else Object.assign(state.physical, { deviceId: params.id, hardwareEnabled: true, pending: true });
  } else if (method === "state.get") {
    if (state.physical.pending && ++readsAfterAcquire >= 3 && mode !== "timeout") {
      sample();
      if (mode === "offline") state.physical.connected = false;
    }
    const { chatmix, audio, ...rest } = state;
    result = {
      ...rest,
      streams: state.streams.map((s) => ({ ...s, id: Number(s.id) })),
      mixer: chatmix,
      backend: { connected: audio.available, error: null },
    };
  } else if (method === "chatmix.set") Object.assign(state.chatmix, params);
  else error = { code: "UNSUPPORTED", message: "Unsupported wheel fixture method" };
  appendFileSync(
    process.env.SSGG_TEST_REQUEST_LOG,
    JSON.stringify({
      method,
      params,
      physical: structuredClone(state.physical),
      mixer: structuredClone(state.chatmix),
    }) + "\n",
  );
  process.stdout.write(JSON.stringify(error ? { id, error } : { id, result }) + "\n");
});
