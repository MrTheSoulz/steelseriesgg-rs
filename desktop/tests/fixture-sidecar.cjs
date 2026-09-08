#!/usr/bin/env node
// Explicit test transport. Never imported or bundled by application code.
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
const state = structuredClone(require("./fixture.json"));
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (process.env.SSGG_TEST_REQUEST_LOG)
    appendFileSync(process.env.SSGG_TEST_REQUEST_LOG, JSON.stringify({ method, params }) + "\n");
  let result = { ok: true };
  if (method === "state.get") {
    const { chatmix, audio, ...rest } = state;
    result = {
      ...rest,
      streams: state.streams.map((s) => ({ ...s, id: Number(s.id) })),
      mixer: chatmix,
      backend: { connected: audio.available, error: null },
    };
  } else if (method === "stream.set")
    Object.assign(
      state.streams.find((s) => Number(s.id) === params.id),
      params,
    );
  else if (method === "group.set")
    Object.assign(
      state.groups.find((g) => g.id === params.id),
      params,
    );
  else if (method === "chatmix.set") Object.assign(state.chatmix, params);
  else if (method === "profiles.save") {
    if (!state.profiles.some((p) => p.name === params.name)) state.profiles.push({ name: params.name });
  } else if (method !== "profiles.apply") {
    process.stdout.write(
      JSON.stringify({ id, error: { code: "unsupported", message: "Unsupported test method" } }) + "\n",
    );
    return;
  }
  process.stdout.write(JSON.stringify({ id, result }) + "\n");
});
