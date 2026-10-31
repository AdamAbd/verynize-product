// One local instance of the Vercel function (api/server.mjs's configuration, from the environment)
// behind cloud/platform/vercel/local-server.js, for development without a Vercel account. Start
// several on different PORTs against the same REDIS_URL and DATABASE_URL to run a multi-instance
// setup locally. See docs/deployment-vercel.md.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upgradeWebSocket } from "@vercel/functions";
import worker, * as objects from "../cloud/worker.js";
import { createVercelEnv, optionsFromEnvironment } from "../cloud/platform/vercel/env.js";
import { createHandler } from "../cloud/platform/vercel/handler.js";
import { createLocalServer } from "../cloud/platform/vercel/local-server.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vars = process.env;
const options = optionsFromEnvironment(vars);
// Without S3, blobs go to a local directory shared by the instances of this machine.
if (!options.bindings.ASSETS_BUCKET)
  options.bindings.ASSETS_BUCKET = { type: "r2", name: "verynize-assets" };
const { env, ready, close } = createVercelEnv({
  classes: objects,
  ...options,
  dataDir: path.resolve(vars.DATA_DIR || path.join(root, "data")),
});
const handler = createHandler({ worker, env, ready, upgradeWebSocket, publicUrl: vars.PUBLIC_URL });
const server = createLocalServer({
  handler,
  webRoot: vars.WEB_ROOT || path.join(root, "web"),
  maxDurationMs: vars.MAX_DURATION_MS ? Number(vars.MAX_DURATION_MS) : undefined,
});
await ready;
server.listen(Number(vars.PORT ?? 8788), vars.HOST || "127.0.0.1", () =>
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${server.address().port}` })),
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections?.();
  await close().catch(() => {});
  setTimeout(() => process.exit(0), 100);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
