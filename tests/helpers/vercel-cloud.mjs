// The Vercel runtime behind the Miniflare API the cloud tests use (`new Miniflare(options)`,
// `ready`, `dispatchFetch`, `setOptions`, `getD1Database`, `dispose`), as a real multi-instance
// deployment on this machine: a local redis-server, a libSQL database (file: URL, shared by the
// processes) and VERCEL_INSTANCES (default 3) function instances, each its own process on its own
// port (tests/helpers/vercel-cloud-server.mjs). Requests and sockets go to the instances in turn,
// so consecutive calls of one scenario land on different instances. Nothing is mocked.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { libsqlD1, openLibsql } from "../../cloud/platform/vercel/libsql-d1.js";
import { CURRENT_WORKER, dispatch, nodeBindings, writeModules } from "./node-cloud.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SERVER = path.join(root, "tests/helpers/vercel-cloud-server.mjs");
const REDIS = process.env.REDIS_SERVER || "redis-server";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A throwaway redis-server (no persistence) in its own directory; stopped with stop(). */
export async function startRedis() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-redis-"));
  const port = await freePort();
  const child = spawn(
    REDIS,
    ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => /Ready to accept connections/.test(line) && resolve());
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`redis-server exited (${code})`)));
  });
  return {
    url: `redis://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill("SIGTERM");
        });
      }
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** One function instance process; `events` emits its JSON stdout lines (paused, fenced, ...). */
export async function startInstance(config) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-vercel-config-"));
  const file = path.join(dir, "config.json");
  await fs.writeFile(file, JSON.stringify(config));
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SERVER, file], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const events = new EventEmitter();
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const origin = await new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        return void process.stdout.write(line + "\n");
      }
      if (value?.listening) return resolve(value.listening);
      for (const [name, detail] of Object.entries(value || {})) events.emit(name, detail);
    });
    child.once("exit", (code) => reject(new Error(`Vercel instance exited (${code})`)));
  });
  return {
    origin,
    child,
    events,
    /** SIGTERM (graceful) or SIGKILL (crash); resolves once the process is gone. */
    async stop(signal = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null)
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill(signal);
        });
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export class VercelCloud {
  #options;
  #redis = null;
  #instances = [];
  #next = 0;
  #databases = [];
  #temp = [];

  constructor(options) {
    this.#options = options;
    this.ready = this.#start(options);
  }

  get instances() {
    return this.#instances;
  }

  /** The instance configuration (also used by tests that start extra instances). */
  async config(options = this.#options) {
    const config = options.workers[0].config;
    let module = path.join(root, "cloud/worker.js");
    if (config.manifest && config.manifest !== CURRENT_WORKER && config.manifest.modules) {
      const written = await writeModules(config.manifest);
      this.#temp.push(written.dir);
      module = written.main;
    }
    const persistence = options.resourcePersistencePath;
    await fs.mkdir(path.join(persistence, "libsql"), { recursive: true });
    return {
      module,
      fixture: module !== path.join(root, "cloud/worker.js"),
      dataDir: persistence,
      bindings: nodeBindings(config.env),
      redisUrl: this.#redis.url,
      databaseUrl: `file:${path.join(persistence, "libsql", "verynize.db")}`,
      leaseMs: options.leaseMs ?? 2000,
      aliveMs: options.aliveMs,
      maxDurationMs: options.maxDurationMs,
    };
  }

  async #start(options) {
    this.#redis ||= await startRedis();
    const config = await this.config(options);
    const count = Number(process.env.VERCEL_INSTANCES || options.instances || 3);
    // The first instance applies the migrations; the others then start together.
    this.#instances = [await startInstance(config)];
    this.#instances.push(
      ...(await Promise.all(Array.from({ length: count - 1 }, () => startInstance(config)))),
    );
    return new URL(this.#instances[0].origin);
  }

  /** Same contract as Miniflare; each call goes to the next instance. */
  async dispatchFetch(input, init = {}) {
    await this.ready;
    const instance = this.#instances[this.#next++ % this.#instances.length];
    return dispatch(instance.origin, input, init, (...args) => this.dispatchFetch(...args));
  }

  async getD1Database() {
    await this.ready;
    const client = openLibsql({
      url: `file:${path.join(this.#options.resourcePersistencePath, "libsql", "verynize.db")}`,
    });
    this.#databases.push(client);
    return libsqlD1(client);
  }

  async #stop() {
    for (const client of this.#databases.splice(0)) client.close();
    await Promise.all(this.#instances.splice(0).map((instance) => instance.stop()));
  }

  async setOptions(options) {
    await this.ready.catch(() => {});
    await this.#stop();
    this.#options = options;
    this.ready = this.#start(options);
    await this.ready;
  }

  async dispose() {
    await this.ready.catch(() => {});
    await this.#stop();
    await this.#redis?.stop();
    this.#redis = null;
    for (const dir of this.#temp.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  }
}
