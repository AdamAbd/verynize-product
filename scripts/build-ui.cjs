// Builds the combined UI bundle (web/src/ui.tsx → web/dist/ui.{js,css}), or only the island names passed as arguments.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const all = fs
  .readdirSync(path.join(root, "web/src/islands"))
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => name.slice(0, -4));
const islands = process.argv.slice(2).length ? process.argv.slice(2) : ["ui"];
const vp = path.join(root, "node_modules/.bin/vp");
for (const island of islands) {
  if (island !== "ui" && !all.includes(island)) throw new Error(`Unknown island: ${island}`);
  execFileSync(vp, ["build", "-c", "vite.renderer.config.ts", "--logLevel", "warn"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ISLAND: island },
  });
}
console.log(`Built UI islands: ${islands.join(", ")}`);
