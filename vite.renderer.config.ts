// Builds one React "island" per run into web/dist/<island>.{js,css} as a classic IIFE script,
// so the Electron renderer can load it over file:// next to the legacy scripts.
// Usage: ISLAND=ui vp build -c vite.renderer.config.ts builds the combined bundle (`npm run build:ui`);
// ISLAND=<area> builds one island alone for development.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const island = process.env.ISLAND;
if (!island) throw new Error("Set ISLAND=<name> (see web/src/islands)");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production") },
  build: {
    outDir: "web/dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: process.env.NODE_ENV !== "development",
    lib: {
      entry: fileURLToPath(new URL(island === "ui" ? "./web/src/ui.tsx" : `./web/src/islands/${island}.tsx`, import.meta.url)),
      formats: ["iife"],
      name: `BdIsland_${island.replace(/\W/g, "_")}`,
      fileName: () => `${island}.js`,
      cssFileName: island,
    },
  },
});
