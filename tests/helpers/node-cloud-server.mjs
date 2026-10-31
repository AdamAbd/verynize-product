// Child process of tests/helpers/node-cloud.mjs: one Node cloud server for a Miniflare-shaped
// configuration (JSON file in argv[2]). The production entry is server/node.mjs; this one differs
// only in where its bindings and Worker module come from.
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createNodeEnv } from "../../cloud/platform/node/env.js";
import { createServer } from "../../cloud/platform/node/server.js";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// Fixture Workers (tests/fixtures, written for workerd) call this Workers-only extension of Web
// Crypto. The current Worker runs without it, as in production (cloud/http.js sameDigest).
if (config.fixture)
  crypto.subtle.timingSafeEqual ??= (a, b) =>
    a.byteLength === b.byteLength && timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
const module = await import(pathToFileURL(config.module).href);
const { env, close } = createNodeEnv({
  classes: module,
  dataDir: config.dataDir,
  bindings: config.bindings,
});
const server = createServer({
  worker: module.default,
  env,
  assets: env.ASSETS,
  trustProxy: true,
  clientIpHeader: "cf-connecting-ip",
});
server.listen(config.port || 0, "127.0.0.1", () =>
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${server.address().port}` })),
);
process.on("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
  close();
  process.exit(0);
});
