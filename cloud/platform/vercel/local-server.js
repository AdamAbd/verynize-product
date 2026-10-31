// A local stand-in for one Vercel function instance, for development and the multi-instance tests:
// a Node HTTP server that routes like vercel.json (Worker-first paths to the function, then
// static files from web/, then the SPA fallback) and calls the function's `fetch` with Vercel's
// request context, so `upgradeWebSocket` from @vercel/functions runs unchanged. `maxDurationMs`
// cuts WebSockets like the platform does when the function reaches its maximum duration.
import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import { createStaticAssets } from "../node/static-assets.js";
import { REWRITTEN_PATH } from "./handler.js";

// The @vercel/functions request context (get-context.js reads this global).
const CONTEXT = Symbol.for("@vercel/request-context");
const context = new AsyncLocalStorage();
globalThis[CONTEXT] ??= { get: () => context.getStore() };

// vercel.json rewrites these to the function; everything else is static or the SPA fallback.
export const WORKER_FIRST = [
  /^\/api\//,
  /^\/u\//,
  /^\/apps\//,
  /^\/passkey$/,
  /^\/passkey\.js$/,
  /^\/account\//,
];

/**
 * @param {object} options
 * @param {{fetch(request: Request): Promise<Response>}} options.handler the function (handler.js)
 * @param {string} [options.webRoot] static files (web/ without web/src)
 * @param {number} [options.maxDurationMs] close WebSockets after this long (platform limit)
 */
export function createLocalServer({ handler, webRoot, maxDurationMs }) {
  const assets = webRoot ? createStaticAssets(webRoot) : null;

  /** Like the platform: x-forwarded-host/proto name the public origin, x-real-ip the client. */
  function toRequest(incoming) {
    const headers = new Headers();
    for (let i = 0; i < incoming.rawHeaders.length; i += 2)
      headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost";
    const proto = headers.get("x-forwarded-proto") || "http";
    if (!headers.has("x-real-ip")) headers.set("x-real-ip", incoming.socket.remoteAddress || "");
    const method = incoming.method || "GET";
    const hasBody = !["GET", "HEAD"].includes(method);
    // The function receives what vercel.json's rewrite produces: /api/server?__vz_path=<path>.
    const url = new URL(incoming.url || "/", `${proto}://${host}`);
    if (WORKER_FIRST.some((pattern) => pattern.test(url.pathname))) {
      url.searchParams.set(REWRITTEN_PATH, url.pathname);
      url.searchParams.set("path", url.pathname.replace(/^\/[^/]+\/?/, ""));
      url.pathname = "/api/server";
    }
    return new Request(url, {
      method,
      headers,
      body: hasBody ? Readable.toWeb(incoming) : undefined,
      duplex: hasBody ? "half" : undefined,
    });
  }

  async function send(response, outgoing, method) {
    const headers = {};
    for (const [name, value] of response.headers) if (name !== "set-cookie") headers[name] = value;
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) headers["set-cookie"] = cookies;
    outgoing.writeHead(response.status, headers);
    if (!response.body || method === "HEAD") {
      await response.body?.cancel().catch(() => {});
      return void outgoing.end();
    }
    const body = Readable.fromWeb(response.body);
    body.on("error", () => outgoing.destroy());
    body.pipe(outgoing);
  }

  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const request = toRequest(incoming);
      const { pathname } = new URL(request.url);
      let response = null;
      if (assets && pathname !== "/api/server")
        response = (await assets.match(request)) || (await assets.fetch(request));
      response ||= await context.run({ waitUntil() {} }, () => handler.fetch(request));
      await send(response, outgoing, request.method);
    } catch (error) {
      console.error("request failed", incoming.url?.split("?")[0], error?.message);
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "Request failed" }));
      } else outgoing.destroy();
    }
  });

  server.on("upgrade", async (incoming, socket, head) => {
    socket.on("error", () => {});
    let upgraded = false;
    const store = {
      waitUntil() {},
      upgradeWebSocket() {
        upgraded = true;
        if (maxDurationMs) {
          const timer = setTimeout(() => socket.destroy(), maxDurationMs);
          socket.once("close", () => clearTimeout(timer));
        }
        return { req: incoming, socket, head };
      },
    };
    try {
      const response = await context.run(store, () => handler.fetch(toRequest(incoming)));
      if (upgraded) return;
      const body = Buffer.from(await response.arrayBuffer());
      const lines = [`HTTP/1.1 ${response.status} ${http.STATUS_CODES[response.status] || ""}`];
      for (const [name, value] of response.headers) lines.push(`${name}: ${value}`);
      lines.push(`content-length: ${body.byteLength}`, "connection: close", "", "");
      socket.end(Buffer.concat([Buffer.from(lines.join("\r\n")), body]));
    } catch (error) {
      console.error("upgrade failed", incoming.url?.split("?")[0], error?.message);
      if (!upgraded)
        socket.end(
          "HTTP/1.1 500 Internal Server Error\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
        );
      else socket.destroy();
    }
  });

  return server;
}
