// Local workerd configuration shared by the cloud tests (mirrors cloudflare.config.ts, with the
// development email outbox instead of a live provider).
import fs from "node:fs/promises";
const root = new URL("../", import.meta.url);
const MODULES = [
  "cloud/worker.js",
  "cloud/http.js",
  "cloud/rooms.js",
  "cloud/accounts.js",
  "cloud/apps.js",
  "cloud/mail.js",
  "cloud/pages.js",
  "cloud/webauthn.js",
  "cloud/passkey-page.js",
  "web/cloud-ops.js",
];
export async function cloudOptions(persistence, extra = {}) {
  const modules = {};
  for (const name of MODULES)
    modules[name] = { type: "esm", contents: await fs.readFile(new URL(name, root), "utf8") };
  return {
    resourcePersistencePath: persistence,
    ...extra,
    workers: [
      {
        config: {
          name: "verynize",
          compatibilityDate: "2026-10-28",
          manifest: { mainModule: "cloud/worker.js", modules },
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
            ROOMS: { type: "durable-object", worker: "verynize", exportName: "DesignRoom" },
            ACCOUNTS: {
              type: "durable-object",
              worker: "verynize",
              exportName: "AccountDirectory",
            },
            APPS: { type: "durable-object", worker: "verynize", exportName: "PublishedApp" },
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
