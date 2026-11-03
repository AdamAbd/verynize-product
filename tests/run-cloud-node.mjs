// The scenarios of `npm run test:cloud`, read from scripts/test-manifest.mjs so the lists cannot
// drift, run one after another against the Node runtime (CLOUD_RUNTIME=node, tests/cloud-harness.mjs).
// `npm run test:cloud:node` runs the same entries through scripts/run-tests.mjs --group cloud-node.
// Any other cloud test runs on Node the same way: CLOUD_RUNTIME=node node tests/<file>.mjs
import { spawnSync } from "node:child_process";
import { CLOUD_SCENARIOS } from "../scripts/test-manifest.mjs";

const root = new URL("../", import.meta.url);
const files = [...CLOUD_SCENARIOS];
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
