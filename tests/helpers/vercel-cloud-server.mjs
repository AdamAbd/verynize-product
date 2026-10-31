// Child process of tests/helpers/vercel-cloud.mjs: one instance of the Vercel function for a
// Miniflare-shaped configuration (JSON file in argv[2]), behind the local Vercel stand-in. The
// deployed entry is api/server.mjs; this one differs only in where its bindings, Worker module
// and timings come from, plus two test hooks:
// - pause: when the file `<pauseFile>` names an actor, the next turn of that actor stops this
//   process (SIGSTOP) after running the actor code and before committing, holding the lease.
// - fenced: a turn whose commit was refused prints {"fenced": actor}.
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { upgradeWebSocket } from "@vercel/functions";
import { createVercelEnv } from "../../cloud/platform/vercel/env.js";
import { createHandler } from "../../cloud/platform/vercel/handler.js";
import { createLocalServer } from "../../cloud/platform/vercel/local-server.js";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (config.fixture)
  crypto.subtle.timingSafeEqual ??= (a, b) =>
    a.byteLength === b.byteLength && timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
const module = await import(pathToFileURL(config.module).href);
const say = (value) => console.log(JSON.stringify(value));

const hooks = {
  beforeCommit({ actor }) {
    if (!config.pauseFile || !fs.existsSync(config.pauseFile)) return;
    if (fs.readFileSync(config.pauseFile, "utf8").trim() !== actor) return;
    fs.rmSync(config.pauseFile, { force: true });
    // Written synchronously: stdout is an asynchronous pipe and the process stops right after.
    fs.writeSync(1, JSON.stringify({ paused: actor }) + "\n");
    process.kill(process.pid, "SIGSTOP");
  },
  fenced({ actor }) {
    say({ fenced: actor });
  },
};

const { env, ready, close } = createVercelEnv({
  classes: module,
  bindings: config.bindings,
  redisUrl: config.redisUrl,
  database: { url: config.databaseUrl },
  dataDir: config.dataDir,
  coordinator: { leaseMs: config.leaseMs, aliveMs: config.aliveMs, hooks },
});
const handler = createHandler({
  worker: module.default,
  env,
  ready,
  upgradeWebSocket,
  clientIpHeader: "cf-connecting-ip",
});
const server = createLocalServer({ handler, maxDurationMs: config.maxDurationMs });
await ready;
server.listen(config.port || 0, "127.0.0.1", () =>
  say({ listening: `http://127.0.0.1:${server.address().port}` }),
);
process.on("SIGTERM", async () => {
  server.close();
  server.closeAllConnections();
  await close().catch(() => {});
  process.exit(0);
});
