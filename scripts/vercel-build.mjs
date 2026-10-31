// Vercel build step (vercel.json buildCommand): builds the UI bundle (web/dist) and copies the
// static web app, without web/src, to dist/vercel-web (vercel.json outputDirectory). The backend
// is the api/server.mjs function, bundled by Vercel itself.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, "web");
const out = path.join(root, "dist", "vercel-web");

execFileSync(process.execPath, [path.join(root, "scripts", "build-ui.cjs")], {
  cwd: root,
  stdio: "inherit",
});
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(web, out, {
  recursive: true,
  filter: (source) => source !== path.join(web, "src") && !path.basename(source).startsWith("."),
});
console.log(`static web app copied to ${path.relative(root, out)}`);
