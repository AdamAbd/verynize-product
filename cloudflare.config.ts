import { defineConfig, bindings, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "verynize",
    domains: ["verynize.gayaloo.app"],
    // The Start server entry; it forwards backend paths to cloud/worker.js and re-exports its
    // Durable Objects (web-start/README.md).
    entrypoint: "./web-start/src/server.cloudflare.ts",
    compatibilityDate: "2026-10-28",
    // Better Auth imports node:async_hooks and node:crypto.
    compatibilityFlags: ["nodejs_compat"],
    // Workers Paid: room for scrypt password hashing (Better Auth's default) on sign-up and sign-in.
    limits: { cpuMs: 30_000 },
    assets: {
      // Start renders every page that is not a static file, so there is no SPA fallback.
      notFoundHandling: "none",
      // Backend paths never resolve to a static file. Same list as web-start/worker-paths.mjs.
      runWorkerFirst: ["/api/*", "/u/*", "/apps/*", "/passkey", "/passkey.js", "/account/*"],
    },
    env: {
      ROOM_CREATION: bindings.rateLimit({ namespace: "1001", simple: { limit: 10, period: 60 } }),
      AUTH_LIMIT: bindings.rateLimit({ namespace: "1002", simple: { limit: 10, period: 60 } }),
      // Hosted MCP (POST /api/mcp): per IP and per account.
      MCP_LIMIT: bindings.rateLimit({ namespace: "1003", simple: { limit: 240, period: 60 } }),
      // Model API runtime (POST /api/ai/runs, cloud/ai.js): new runs per account. The runtime is
      // off until the OPENROUTER_API_KEY secret is set (`cf secret put OPENROUTER_API_KEY`); it is
      // not declared here so deployments without it stay valid (docs/ai-runtime.md).
      AI_LIMIT: bindings.rateLimit({ namespace: "1004", simple: { limit: 20, period: 60 } }),
      ROOMS: bindings.durableObject({ worker: "verynize", exportName: "DesignRoom" }),
      ACCOUNTS: bindings.durableObject({ worker: "verynize", exportName: "AccountDirectory" }),
      APPS: bindings.durableObject({ worker: "verynize", exportName: "PublishedApp" }),
      // Model API runs (cloud/ai-run.js): one object per run id hosts the run's executor, so a run
      // outlives the request that started it (docs/ai-runtime.md, "Hosting").
      AI_RUNS: bindings.durableObject({ worker: "verynize", exportName: "AiRun" }),
      // Better Auth users, sessions and organizations (cloud/auth.js). Schema: cloud/migrations.
      DB: bindings.d1({ name: "verynize", id: "76210bc4-d4fe-4075-a321-776c2525a828" }),
      // Signs Better Auth cookies and tokens. Generate with `openssl rand -base64 32`.
      BETTER_AUTH_SECRET: bindings.secret(),
      // Room images (cloud/assets.js). ASSETS is the static web bundle, so the bucket is ASSETS_BUCKET.
      ASSETS_BUCKET: bindings.r2({ name: "verynize-assets" }),
      // Signs room image upload and read URLs. Generate with `openssl rand -base64 32`; never rotate
      // it casually, since every image URL stored in documents depends on it.
      ASSET_SIGNING_SECRET: bindings.secret(),
      // Native transactional email. Never use "outbox" in production.
      EMAIL_PROVIDER: bindings.text("cloudflare"),
      EMAIL_FROM: bindings.text("mada@gayaloo.app"),
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: ["mada@gayaloo.app"] }),
    },
    exports: {
      DesignRoom: exports.durableObject({ storage: "sqlite" }),
      AccountDirectory: exports.durableObject({ storage: "sqlite" }),
      PublishedApp: exports.durableObject({ storage: "sqlite" }),
      // New SQLite-backed class: cf deploy adds its migration (new_sqlite_classes) on first deploy.
      AiRun: exports.durableObject({ storage: "sqlite" }),
    },
    observability: { enabled: true, traces: { enabled: true } },
  },
});
