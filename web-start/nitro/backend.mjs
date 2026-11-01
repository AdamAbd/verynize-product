// Nitro middleware of the opt-in Nitro build (vite.nitro.config.ts, preset node-server): backend
// paths (web-start/worker-paths.mjs) go to VERYNIZE_BACKEND_URL, read at runtime, exactly like
// web-start/node/server.mjs. Everything else falls through to Nitro's static files and Start.
//
// - HTTP: h3's proxyRequest (fetch). Request and response bodies stream, the client's abort signal
//   cancels the upstream fetch, and every Set-Cookie header is kept. X-Forwarded-For is appended,
//   Host is the backend's.
// - WebSocket: needs `features.websocket`. The upgrade hook takes the raw Node socket (the
//   node-server preset passes it as `request.runtime.node.upgrade`) and splices it to the backend,
//   which does the handshake itself; crossws never creates a peer (`handled: true`).
import net from "node:net";
import tls from "node:tls";
import { defineHandler, defineWebSocketHandler, proxyRequest } from "nitro/h3";
import { isWorkerPath } from "../worker-paths.mjs";

const backendURL = () => {
  const value = process.env.VERYNIZE_BACKEND_URL;
  return value ? new URL(value) : undefined;
};

const noBackend = () =>
  new Response(JSON.stringify({ error: "No backend configured (set VERYNIZE_BACKEND_URL)" }), {
    status: 502,
    headers: { "content-type": "application/json" },
  });

/** Forward the upgrade request verbatim and splice the two sockets (same as node/server.mjs). */
function splice(backend, req, socket, head) {
  const secure = backend.protocol === "https:";
  const port = Number(backend.port) || (secure ? 443 : 80);
  const upstream = secure
    ? tls.connect({ host: backend.hostname, port, servername: backend.hostname })
    : net.connect({ host: backend.hostname, port });
  upstream.once(secure ? "secureConnect" : "connect", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(
        `${name}: ${name.toLowerCase() === "host" ? backend.host : req.rawHeaders[i + 1]}`,
      );
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  socket.on("close", close);
  upstream.on("close", close);
  upstream.on("error", close);
  socket.on("error", close);
}

const websocket = {
  upgrade(request) {
    const backend = backendURL();
    if (!backend) throw new Response("No backend configured", { status: 404 });
    const node = request.runtime?.node;
    // Only the node-server preset exposes the raw socket. Elsewhere, refuse instead of letting
    // crossws accept a socket that nothing would serve.
    if (!node?.upgrade)
      throw new Response("WebSocket proxy needs the node-server preset", { status: 501 });
    splice(backend, node.req, node.upgrade.socket, node.upgrade.head);
    return { handled: true };
  },
};

const http = defineHandler((event) => {
  const backend = backendURL();
  if (!backend) return noBackend();
  const forwarded = event.req.headers.get("x-forwarded-for");
  const ip = event.req.ip;
  return proxyRequest(event, new URL(event.url.pathname + event.url.search, backend).href, {
    headers: ip ? { "x-forwarded-for": forwarded ? `${forwarded}, ${ip}` : ip } : undefined,
  });
});

const backend = defineWebSocketHandler(websocket, http);

// crossws accepts an upgrade even when the route returned no hooks, so a socket on /editor would
// open and hang. Refuse upgrades outside backend paths, as node/server.mjs does.
const refuse = defineWebSocketHandler({
  upgrade() {
    throw new Response("Not Found", { status: 404 });
  },
});

export default defineHandler((event) => {
  if (isWorkerPath(event.url.pathname)) return backend(event);
  if (event.req.headers.get("upgrade")?.toLowerCase() === "websocket") return refuse(event);
  // Not a backend path: undefined lets Nitro continue (static files, then Start).
});
