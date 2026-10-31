// Cloudflare Worker entry for the browser deployment (`entrypoint` in cloudflare.config.ts).
//
// It composes the existing cloud Worker with Start without touching cloud/ internals: it depends
// only on cloud/worker.js's default `{ fetch }` and its named Durable Object classes.
// - Backend paths (web-start/worker-paths.mjs) and every WebSocket upgrade go to the cloud Worker,
//   so room sockets (`/api/rooms/<id>/socket`) still reach the DesignRoom Durable Object.
// - Everything else is rendered by Start (the editor routes send a client-only shell).
// - The Durable Object classes are re-exported because the bindings in cloudflare.config.ts name
//   this Worker's exports.
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
// @ts-expect-error cloud/worker.js is untyped JavaScript.
import worker from "../../cloud/worker.js";
import { isWorkerPath } from "../worker-paths.mjs";

// @ts-expect-error cloud/worker.js is untyped JavaScript.
export { DesignRoom, AccountDirectory, PublishedApp } from "../../cloud/worker.js";

type CloudWorker = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };

const start = createServerEntry({ fetch: (request: Request) => handler.fetch(request) });

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    const { pathname } = new URL(request.url);
    if (isWorkerPath(pathname) || request.headers.get("upgrade"))
      return (worker as CloudWorker).fetch(request, env, ctx);
    return start.fetch(request);
  },
};
