// The Node runtime behind the Miniflare API the cloud tests use (`new Miniflare(options)`,
// `ready`, `dispatchFetch`, `setOptions`, `getD1Database`, `dispose`). Each instance runs the
// real Node server (tests/helpers/node-cloud-server.mjs) in a child process on a real port, so
// restarts are real process restarts and sockets are real WebSockets. Nothing is mocked.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";
import { openD1 } from "../../cloud/platform/node/d1.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SERVER = path.join(root, "tests/helpers/node-cloud-server.mjs");
const RUNTIME = pathToFileURL(path.join(root, "cloud/platform/node/runtime.js")).href;
/** cloudOptions marks the current Worker this way; tests replace it with fixture manifests. */
export const CURRENT_WORKER = { mainModule: "cloud/worker.js", modules: null };

/** Miniflare binding descriptions -> Node binding descriptions (cloud/platform/node/env.js). */
export function nodeBindings(env) {
  const bindings = {};
  for (const [name, binding] of Object.entries(env || {})) {
    if (typeof binding === "string") bindings[name] = { type: "text", value: binding };
    else if (binding.type === "d1") bindings[name] = { type: "d1", name: binding.name || name };
    else if (binding.type === "durable-object")
      bindings[name] = { type: "durable-object", exportName: binding.exportName };
    else bindings[name] = binding;
  }
  return bindings;
}

/** A fixture Worker written for workerd, loaded on Node with the Node DurableObject base. */
export async function writeModules(manifest) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-node-worker-"));
  for (const [name, module] of Object.entries(manifest.modules)) {
    const source = module.contents.replace(/(["'])cloudflare:workers\1/g, JSON.stringify(RUNTIME));
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name.replace(/\.js$/, ".mjs")), source);
  }
  return { dir, main: path.join(dir, manifest.mainModule.replace(/\.js$/, ".mjs")) };
}

/** The client side of a test WebSocket, shaped like workerd's (accept, then events). */
class TestSocket extends EventTarget {
  #ws;
  #accepted = false;
  #queued = [];
  constructor(ws) {
    super();
    this.#ws = ws;
    const emit = (event) => (this.#accepted ? this.dispatchEvent(event) : this.#queued.push(event));
    ws.on("message", (data, binary) =>
      emit(
        new MessageEvent("message", {
          data: binary ? new Uint8Array(data).buffer : data.toString("utf8"),
        }),
      ),
    );
    ws.on("close", (code, reason) =>
      emit(
        Object.assign(new Event("close"), {
          code,
          reason: reason.toString("utf8"),
          wasClean: true,
        }),
      ),
    );
    ws.on("error", (error) =>
      emit(Object.assign(new Event("error"), { error, message: error.message })),
    );
  }
  get readyState() {
    return this.#ws.readyState;
  }
  accept() {
    this.#accepted = true;
    for (const event of this.#queued.splice(0)) this.dispatchEvent(event);
  }
  send(data) {
    this.#ws.send(data);
  }
  close(code, reason) {
    try {
      this.#ws.close(code, reason);
    } catch {}
  }
}

/**
 * Miniflare's dispatchFetch against a server at `origin`: the input URL's own origin is what the
 * Worker sees (x-forwarded-host/proto); redirects are followed through `again`.
 */
export async function dispatch(origin, input, init, again) {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = new Headers(
    init.headers || (input instanceof Request ? input.headers : undefined),
  );
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
  const target = new URL(url.pathname + url.search, origin);
  if (headers.get("upgrade")?.toLowerCase() === "websocket") return socketTo(target, headers);
  const body = init.body ?? (input instanceof Request ? input.body : undefined);
  const response = await fetch(target, {
    method: init.method || (input instanceof Request ? input.method : "GET"),
    headers,
    body,
    duplex: body instanceof ReadableStream ? "half" : undefined,
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (
    init.redirect !== "manual" &&
    location &&
    [301, 302, 303, 307, 308].includes(response.status)
  ) {
    await response.body?.cancel();
    return again(new URL(location, url).href, { headers: init.headers });
  }
  return response;
}

function socketTo(target, headers) {
  const forwarded = {};
  for (const [name, value] of headers)
    if (!/^(upgrade|connection|sec-websocket-.*)$/i.test(name)) forwarded[name] = value;
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target, { headers: forwarded });
    const socket = new TestSocket(ws);
    ws.once("upgrade", () =>
      resolve({ status: 101, ok: false, headers: new Headers(), webSocket: socket }),
    );
    ws.once("unexpected-response", (_request, response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          if (typeof value === "string") responseHeaders.set(name, value);
        resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode,
            headers: responseHeaders,
          }),
        );
        ws.terminate();
      });
    });
    ws.once("error", reject);
  });
}

export class NodeCloud {
  #options;
  #child = null;
  #origin = null;
  #databases = [];
  #temp = [];

  constructor(options) {
    this.#options = options;
    this.ready = this.#start(options);
  }

  async #start(options) {
    const config = options.workers[0].config;
    let module = path.join(root, "cloud/worker.js");
    if (config.manifest && config.manifest !== CURRENT_WORKER && config.manifest.modules) {
      const written = await writeModules(config.manifest);
      this.#temp.push(written.dir);
      module = written.main;
    }
    const file = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "verynize-node-config-")),
      "config.json",
    );
    this.#temp.push(path.dirname(file));
    await fs.writeFile(
      file,
      JSON.stringify({
        module,
        fixture: module !== path.join(root, "cloud/worker.js"),
        dataDir: options.resourcePersistencePath,
        port: options.port || 0,
        bindings: nodeBindings(config.env),
      }),
    );
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER, file], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const origin = await new Promise((resolve, reject) => {
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const { listening } = JSON.parse(line);
          if (listening) return resolve(listening);
        } catch {}
        process.stdout.write(line + "\n");
      });
      child.once("exit", (code) => reject(new Error(`Node cloud server exited (${code})`)));
    });
    this.#origin = origin;
    return new URL(origin);
  }

  /** Same contract as Miniflare: the URL's own origin is what the Worker sees. */
  async dispatchFetch(input, init = {}) {
    await this.ready;
    return dispatch(this.#origin, input, init, (...args) => this.dispatchFetch(...args));
  }

  async getD1Database(name) {
    await this.ready;
    const config = this.#options.workers[0].config;
    const binding = config.env[name];
    const database = openD1(
      path.join(this.#options.resourcePersistencePath, "d1", `${binding?.name || name}.sqlite`),
    );
    this.#databases.push(database);
    return database.binding;
  }

  async #stop() {
    for (const database of this.#databases.splice(0)) database.close();
    const child = this.#child;
    this.#child = null;
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
    });
  }

  async setOptions(options) {
    await this.ready.catch(() => {});
    const port = options.port || Number(new URL(this.#origin).port);
    await this.#stop();
    this.#options = options;
    this.ready = this.#start({ ...options, port });
    await this.ready;
  }

  async dispose() {
    await this.ready.catch(() => {});
    await this.#stop();
    for (const dir of this.#temp.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  }
}
