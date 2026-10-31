// Actor runtime on Node (`#cloud-runtime` outside workerd, package.json). The Durable Object
// classes extend this base; cloud/platform/node/actors.js constructs them with a context that has
// the same shape as the Cloudflare one (storage.sql, getWebSockets, acceptWebSocket).
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

/** Accept the WebSocket upgrade of the request being handled: {socket, response}. */
export function acceptWebSocket(ctx) {
  return ctx.acceptUpgrade();
}
