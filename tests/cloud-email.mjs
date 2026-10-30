// Exercise the native email transport through real local workerd bindings.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-email-"));
let mf;
try {
  const options = await cloudOptions(path.join(dir, "state"));
  const env = options.workers[0].config.env;
  env.EMAIL_PROVIDER = { type: "text", value: "cloudflare" };
  env.EMAIL_FROM = { type: "text", value: "mada@gayaloo.app" };
  env.EMAIL = { type: "send-email", allowedSenderAddresses: ["mada@gayaloo.app"] };
  mf = new Miniflare(options);
  const start = () =>
    mf.dispatchFetch("https://verynize.gayaloo.app/api/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "recipient@example.com" }),
    });
  let response = await start();
  assert.equal(response.status, 200, await response.text());
  env.EMAIL_FROM.value = "unauthorized@gayaloo.app";
  await mf.setOptions(options);
  response = await start();
  assert.equal(response.status, 502, await response.text());
  delete env.EMAIL;
  await mf.setOptions(options);
  response = await start();
  assert.equal(response.status, 503, await response.text());
  console.log("cloud email: native sending, sender restrictions and missing binding passed");
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
