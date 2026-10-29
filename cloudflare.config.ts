import { defineConfig, bindings, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "verynize",
    entrypoint: "./cloud/worker.js",
    compatibilityDate: "2026-10-28",
    assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*"] },
    env: { ROOM_CREATION: bindings.rateLimit({ namespace: "1001", simple: { limit: 10, period: 60 } }), ROOMS: bindings.durableObject({ worker: "verynize", exportName: "DesignRoom" }) },
    exports: { DesignRoom: exports.durableObject({ storage: "sqlite" }) },
    observability: { enabled: true, traces: { enabled: true } },
  },
});
