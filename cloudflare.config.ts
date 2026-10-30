import { defineConfig, bindings, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "verynize",
    entrypoint: "./cloud/worker.js",
    compatibilityDate: "2026-10-28",
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*", "/u/*", "/apps/*", "/passkey", "/passkey.js"],
    },
    env: {
      ROOM_CREATION: bindings.rateLimit({ namespace: "1001", simple: { limit: 10, period: 60 } }),
      AUTH_LIMIT: bindings.rateLimit({ namespace: "1002", simple: { limit: 10, period: 60 } }),
      ROOMS: bindings.durableObject({ worker: "verynize", exportName: "DesignRoom" }),
      ACCOUNTS: bindings.durableObject({ worker: "verynize", exportName: "AccountDirectory" }),
      APPS: bindings.durableObject({ worker: "verynize", exportName: "PublishedApp" }),
      // Email sign-in relay (cloud/mail.js). The URL and token are deployment secrets; never use "outbox" in production.
      EMAIL_PROVIDER: bindings.text("webhook"),
      EMAIL_WEBHOOK_URL: bindings.secret(),
      EMAIL_WEBHOOK_TOKEN: bindings.secret(),
    },
    exports: {
      DesignRoom: exports.durableObject({ storage: "sqlite" }),
      AccountDirectory: exports.durableObject({ storage: "sqlite" }),
      PublishedApp: exports.durableObject({ storage: "sqlite" }),
    },
    observability: { enabled: true, traces: { enabled: true } },
  },
});
