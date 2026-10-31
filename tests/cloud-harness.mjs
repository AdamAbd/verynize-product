// Local cloud configuration shared by the cloud tests (mirrors cloudflare.config.ts, with the
// development email outbox instead of a live provider).
//
// CLOUD_RUNTIME selects the runtime the same scenarios run on: "workerd" (default, Miniflare and
// the built Worker bundle) or "node" (server/node.mjs's runtime: cloud/platform/node, in a child
// process). Tests import `Miniflare` from here; on Node it is tests/helpers/node-cloud.mjs, which
// takes the same options and offers the same methods.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { Miniflare as Workerd } from "miniflare";
import { CURRENT_WORKER, NodeCloud } from "./helpers/node-cloud.mjs";

export const RUNTIME = process.env.CLOUD_RUNTIME === "node" ? "node" : "workerd";
export const Miniflare = RUNTIME === "node" ? NodeCloud : Workerd;
const root = new URL("../", import.meta.url);
const BUNDLE = new URL(".cloudflare/output/v0/workers/default/bundle/", root);
const MIGRATIONS = new URL("cloud/migrations/", root);
const D1 = { type: "d1", id: "verynize-local", name: "verynize" };
export const AUTH_SECRET = "local-test-secret-not-for-production-0000";
export const ASSET_SECRET = "local-asset-signing-secret-not-for-production";

// The Worker imports npm packages (Better Auth), so tests run the same bundle that
// `cf deploy --prebuilt` uploads. It is built once per test process.
let built;
function buildWorker() {
  built ||= Promise.resolve().then(async () => {
    execFileSync(
      process.execPath,
      [new URL("node_modules/vite-plus/bin/vp", root).pathname, "build"],
      {
        cwd: root,
        stdio: "pipe",
      },
    );
    const modules = {};
    for (const file of await fs.readdir(BUNDLE, { recursive: true }))
      if (file.endsWith(".js"))
        modules[file] = { type: "esm", contents: await fs.readFile(new URL(file, BUNDLE), "utf8") };
    return modules;
  });
  return built;
}

/**
 * Applies cloud/migrations to the persisted local D1 database, recording them in d1_migrations
 * like `cf d1 migrations apply`, so tests that restart Miniflare on the same state keep their data.
 */
async function migrate(persistence) {
  const mf = new Workerd({
    resourcePersistencePath: persistence,
    workers: [
      {
        config: {
          name: "migrations",
          compatibilityDate: "2026-10-28",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: "export default {fetch(){return new Response()}}",
              },
            },
          },
          env: { DB: D1 },
        },
      },
    ],
  });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
    );
    const applied = new Set(
      (await db.prepare("SELECT name FROM d1_migrations").all()).results.map((row) => row.name),
    );
    for (const name of (await fs.readdir(MIGRATIONS))
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      if (applied.has(name)) continue;
      const sql = await fs.readFile(new URL(name, MIGRATIONS), "utf8");
      const statements = sql
        .replace(/^--.*$/gm, "")
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);
      await db.batch([
        ...statements.map((statement) => db.prepare(statement)),
        db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(name),
      ]);
    }
  } finally {
    await mf.dispose();
  }
}

export async function cloudOptions(persistence, extra = {}) {
  // The Node server applies cloud/migrations itself when it opens the database.
  const [modules] =
    RUNTIME === "node" ? [null] : await Promise.all([buildWorker(), migrate(persistence)]);
  return {
    resourcePersistencePath: persistence,
    ...extra,
    workers: [
      {
        config: {
          name: "verynize",
          compatibilityDate: "2026-10-28",
          compatibilityFlags: ["nodejs_compat"],
          manifest: modules ? { mainModule: "index.js", modules } : CURRENT_WORKER,
          env: {
            ROOM_CREATION: {
              type: "rate-limit",
              namespace: "1001",
              simple: { limit: 10, period: 60 },
            },
            AUTH_LIMIT: {
              type: "rate-limit",
              namespace: "1002",
              simple: { limit: 10, period: 60 },
            },
            MCP_LIMIT: {
              type: "rate-limit",
              namespace: "1003",
              simple: { limit: 240, period: 60 },
            },
            ROOMS: { type: "durable-object", worker: "verynize", exportName: "DesignRoom" },
            ACCOUNTS: {
              type: "durable-object",
              worker: "verynize",
              exportName: "AccountDirectory",
            },
            APPS: { type: "durable-object", worker: "verynize", exportName: "PublishedApp" },
            DB: D1,
            BETTER_AUTH_SECRET: { type: "text", value: AUTH_SECRET },
            ASSETS_BUCKET: { type: "r2", name: "verynize-assets" },
            ASSET_SIGNING_SECRET: { type: "text", value: ASSET_SECRET },
            EMAIL_PROVIDER: { type: "text", value: "outbox" },
          },
          exports: {
            DesignRoom: { type: "durable-object", storage: "sqlite" },
            AccountDirectory: { type: "durable-object", storage: "sqlite" },
            PublishedApp: { type: "durable-object", storage: "sqlite" },
          },
        },
      },
    ],
  };
}

/** Sign in through the real magic-link flow, reading the link from the development outbox. */
export async function signIn(origin, email, fetchImpl = fetch) {
  const post = (path, body, headers = {}) =>
    fetchImpl(origin + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const started = await post("/api/auth/start", { email });
  if (!started.ok) throw Error("sign-in start failed: " + (await started.text()));
  const outbox = await (
    await fetchImpl(origin + "/api/dev/outbox?to=" + encodeURIComponent(email))
  ).json();
  const link = outbox.messages[0].link;
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("signin");
  const verified = await post("/api/auth/verify", { token });
  if (!verified.ok) throw Error("sign-in verify failed: " + (await verified.text()));
  return { ...(await verified.json()), link };
}

/**
 * Create an email + password account through Better Auth, follow the emailed verification link
 * and sign in. Returns the bearer token (the desktop sends it as X-Verynize-Session).
 */
export async function passwordUser(origin, email, name, fetchImpl = fetch, ip = "192.0.2.1") {
  const password = "a long enough password";
  const post = (path, body) =>
    fetchImpl(origin + path, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    });
  const signedUp = await post("/api/auth/sign-up/email", { email, password, name });
  if (!signedUp.ok) throw Error("sign-up failed: " + (await signedUp.text()));
  const outbox = await (
    await fetchImpl(origin + "/api/dev/outbox?to=" + encodeURIComponent(email))
  ).json();
  const link = new URL(outbox.messages.find((m) => /Verify/.test(m.subject)).link);
  await fetchImpl(origin + link.pathname + link.search, { redirect: "manual" });
  const signedIn = await post("/api/auth/sign-in/email", { email, password });
  if (!signedIn.ok) throw Error("sign-in failed: " + (await signedIn.text()));
  return signedIn.headers.get("set-auth-token");
}
