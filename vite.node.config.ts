// Node build of the web app in web-start/ (`npm run build:web:node` → dist/web-node), served by
// web-start/node/server.mjs, which forwards backend paths and room WebSockets to
// VERYNIZE_BACKEND_URL. Same routes and legacy shell as the Cloudflare build (vite.config.ts), with
// Start's default server entry instead of the Worker composition. See web-start/README.md.
import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { sharedPlugins, srcDirectory } from "./web-start/build/start-config.mjs";

export default defineConfig({
  publicDir: false,
  plugins: [tanstackStart({ srcDirectory }), react(), ...sharedPlugins()],
  // Bundle dependencies into the server build so dist/web-node runs without node_modules.
  ssr: { noExternal: true },
  environments: {
    client: { build: { outDir: "dist/web-node/client", emptyOutDir: true } },
    ssr: { build: { outDir: "dist/web-node/server", emptyOutDir: true } },
  },
});
