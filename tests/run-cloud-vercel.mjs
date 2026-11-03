// The scenarios of `npm run test:cloud`, read from scripts/test-manifest.mjs so the lists cannot
// drift, run against the Vercel runtime (CLOUD_RUNTIME=vercel, tests/cloud-harness.mjs):
// three function instances, a local redis-server and a libSQL file, requests spread over the
// instances. Then the multi-instance guarantees (tests/cloud-vercel-instances.mjs).
// `npm run test:cloud:vercel` runs the same entries through scripts/run-tests.mjs --group cloud-vercel.
// Any other cloud test runs the same way: CLOUD_RUNTIME=vercel node tests/<file>.mjs
import { spawnSync } from "node:child_process";
import { CLOUD_SCENARIOS } from "../scripts/test-manifest.mjs";

const root = new URL("../", import.meta.url);
const files = [...CLOUD_SCENARIOS];
files.push("tests/cloud-vercel-instances.mjs");
for (const file of files) {
  console.log(`[vercel] ${file}`);
  const run = spawnSync(process.execPath, [file], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CLOUD_RUNTIME: "vercel" },
  });
  if (run.status !== 0) {
    console.error(`[vercel] ${file} failed (${run.status ?? run.signal})`);
    process.exit(run.status || 1);
  }
}
console.log(`[vercel] ${files.length} cloud test files passed`);
