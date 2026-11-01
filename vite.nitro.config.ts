// Opt-in Nitro build of the web app in web-start/ (spike, web-start/README.md "Nitro spike").
// The default Node build stays vite.node.config.ts + web-start/node/server.mjs, the default Vercel
// deployment stays vercel.json + api/server.mjs, and Cloudflare stays vite.config.ts.
//
//   NITRO_PRESET=node-server (default)  npm run build:web:nitro         → dist/web-nitro
//                                        npm run start:web:nitro         (node dist/web-nitro/server/index.mjs)
//   NITRO_PRESET=vercel                  npm run build:web:nitro:vercel  → .vercel/output
//
// node-server: backend paths and their WebSocket upgrades are forwarded at runtime to
// VERYNIZE_BACKEND_URL by web-start/nitro/backend.mjs.
// vercel: backend paths become CDN rewrites (config.json routes, no function invocation) to
// VERYNIZE_BACKEND_URL, which must be set at build time (for example the existing Vercel project
// that runs api/server.mjs). See docs/deployment-vercel.md for why the backend cannot simply stay
// the api/server.mjs function of the same project.
import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { sharedPlugins, srcDirectory } from "./web-start/build/start-config.mjs";
import { WORKER_PATH_PATTERNS } from "./web-start/worker-paths.mjs";

const preset = process.env.NITRO_PRESET || "node-server";
if (preset !== "node-server" && preset !== "vercel")
  throw new Error(`NITRO_PRESET must be node-server or vercel, not ${preset}`);

/** rou3 route pattern for a worker-paths pattern ("/api/*" → "/api/**"). */
const route = (pattern: string) => (pattern.endsWith("/*") ? `${pattern}*` : pattern);

function vercelBackendRules() {
  const backend = process.env.VERYNIZE_BACKEND_URL;
  if (!backend)
    throw new Error(
      "NITRO_PRESET=vercel needs VERYNIZE_BACKEND_URL at build time (origin of the backend project)",
    );
  const origin = new URL(backend).origin;
  return Object.fromEntries(
    WORKER_PATH_PATTERNS.map((pattern) => [
      route(pattern),
      { proxy: pattern.endsWith("/*") ? `${origin}${route(pattern)}` : `${origin}${pattern}` },
    ]),
  );
}

// Nitro marks Vite's whole assetsDir (/assets/**) immutable, but web/assets/fonts keeps stable
// names (web-start/node/server.mjs sends them with no-cache).
const assetRules = { "/assets/fonts/**": { headers: { "cache-control": "no-cache" } } };

export default defineConfig({
  publicDir: false,
  plugins: [
    tanstackStart({ srcDirectory }),
    react(),
    ...sharedPlugins(),
    nitro(
      preset === "vercel"
        ? { preset, routeRules: { ...assetRules, ...vercelBackendRules() } }
        : {
            preset,
            output: { dir: "dist/web-nitro" },
            routeRules: assetRules,
            features: { websocket: true },
            handlers: [{ middleware: true, handler: "./web-start/nitro/backend.mjs" }],
          },
    ),
  ],
});
