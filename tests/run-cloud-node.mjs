// `npm run test:cloud:node`: the scenarios of `npm run test:cloud`, read from package.json so the
// two lists cannot drift, run against the Node runtime (CLOUD_RUNTIME=node, tests/cloud-harness.mjs).
// Any other cloud test runs on Node the same way: CLOUD_RUNTIME=node node tests/<file>.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const scripts = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8")).scripts;
const files = [...scripts["test:cloud"].matchAll(/node (tests\/[\w-]+\.mjs)/g)].map(
  (match) => match[1],
);
if (!files.length) throw new Error("No cloud tests found in the test:cloud script");
// The Node runtime's own guarantees and the production entry (server/node.mjs).
files.push("tests/cloud-node-server.mjs");
for (const file of files) {
  console.log(`[node] ${file}`);
  const run = spawnSync(process.execPath, [file], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CLOUD_RUNTIME: "node" },
  });
  if (run.status !== 0) {
    console.error(`[node] ${file} failed (${run.status ?? run.signal})`);
    process.exit(run.status || 1);
  }
}
console.log(`[node] ${files.length} cloud test files passed`);
