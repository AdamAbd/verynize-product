// The Vercel function's request handler: `{ fetch(request) }` (the Node runtime's Web signature)
// around cloud/worker.js's fetch, with room WebSockets accepted through
// `upgradeWebSocket` from @vercel/functions once the room's turn has committed.
import { pendingUpgrade, UPGRADED } from "./actors.js";

const MAX_SOCKET_MESSAGE = 8 * 1024 * 1024;
export const REWRITTEN_PATH = "__vz_path";

/**
 * vercel.json rewrites backend paths to this function as /api/server?__vz_path=<path>, and Vercel
 * adds the matched segments as `path`. Whether the function then sees the original URL or the
 * rewritten one, the Worker gets the original path and query.
 */
export function restorePath(url, original) {
  url.pathname = original;
  url.searchParams.delete(REWRITTEN_PATH);
  if (url.searchParams.get("path") === original.replace(/^\/[^/]+\/?/, ""))
    url.searchParams.delete("path");
}

/**
 * @param {object} options
 * @param {{fetch(request: Request, env: object): Promise<Response>}} options.worker
 * @param {object} options.env the bindings (env.js)
 * @param {Promise<void>} options.ready resolves once Redis, libSQL and migrations are ready
 * @param {Function} options.upgradeWebSocket from @vercel/functions
 * @param {string} [options.clientIpHeader] header the platform sets to the client address
 * @param {string} [options.publicUrl] fixed origin for request URLs (PUBLIC_URL)
 */
export function createHandler({
  worker,
  env,
  ready,
  upgradeWebSocket,
  clientIpHeader = "x-real-ip",
  publicUrl,
}) {
  const fixedOrigin = publicUrl ? new URL(publicUrl).origin : null;
  const ipHeader = clientIpHeader.toLowerCase();

  /** The router reads the client address from CF-Connecting-IP; only the platform's is kept. */
  function normalize(request) {
    const headers = new Headers(request.headers);
    const address = (headers.get(ipHeader) || headers.get("x-real-ip"))?.split(",")[0].trim();
    headers.set("cf-connecting-ip", address || "unknown");
    const url = new URL(request.url);
    const original = url.searchParams.get(REWRITTEN_PATH);
    if (original !== null) restorePath(url, original);
    const target = fixedOrigin ? new URL(url.pathname + url.search, fixedOrigin) : url;
    const hasBody = !["GET", "HEAD"].includes(request.method);
    return new Request(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });
  }

  return {
    async fetch(incoming) {
      await ready;
      const request = normalize(incoming);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
        return worker.fetch(request, env);
      const upgrade = { socket: null };
      let response;
      try {
        response = await pendingUpgrade.run(upgrade, () => worker.fetch(request, env));
      } catch (error) {
        upgrade.socket?.abandon();
        throw error;
      }
      if (!response[UPGRADED] || !upgrade.socket) {
        upgrade.socket?.abandon();
        return response;
      }
      const socket = upgrade.socket;
      try {
        return await upgradeWebSocket((ws) => socket.attach(ws), {
          maxPayload: MAX_SOCKET_MESSAGE,
        });
      } catch (error) {
        socket.abandon();
        throw error;
      }
    },
  };
}
