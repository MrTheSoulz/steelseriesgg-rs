// @vitest-environment node
import { it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { JsonLineClient } from "../electron/rpc";
it("matches split JSON-lines responses without mixing concurrent calls", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const lines: string[] = [];
  input.on("data", (chunk) => lines.push(String(chunk)));
  const client = new JsonLineClient(input, output, 100);
  const a = client.request("state.get", {}),
    b = client.request("profiles.list", {});
  const [first, second] = lines.map((l) => JSON.parse(l));
  output.write(JSON.stringify({ id: second.id, result: ["saved"] }) + "\n");
  const result = JSON.stringify({ id: first.id, result: { ok: true } }) + "\n";
  output.write(result.slice(0, 9));
  output.write(result.slice(9));
  expect(await a).toEqual({ ok: true });
  expect(await b).toEqual(["saved"]);
  client.close();
});
