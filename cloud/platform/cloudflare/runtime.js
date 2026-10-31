// Actor runtime on Cloudflare (`#cloud-runtime` under the `workerd` condition, package.json).
// The Durable Object classes extend the real DurableObject, so RPC, SQLite storage and WebSocket
// hibernation are the platform's own. Contract: cloud/platform/README.md.
export { DurableObject } from "cloudflare:workers";

/** Accept a WebSocket upgrade on a hibernatable socket: {socket, response}. */
export function acceptWebSocket(ctx) {
  const [client, server] = Object.values(new WebSocketPair());
  ctx.acceptWebSocket(server);
  return { socket: server, response: new Response(null, { status: 101, webSocket: client }) };
}
