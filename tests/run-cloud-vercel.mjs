// `npm run test:cloud:vercel`: the scenarios of `npm run test:cloud`, read from package.json so the
// lists cannot drift, run against the Vercel runtime (CLOUD_RUNTIME=vercel, tests/cloud-harness.mjs):
// three function instances, a local redis-server and a libSQL file, requests spread over the
// instances. Then the multi-instance guarantees (tests/cloud-vercel-instances.mjs).
// Any other cloud test runs the same way: CLOUD_RUNTIME=vercel node tests/<file>.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const scripts = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8")).scripts;
const files = [...scripts["test:cloud"].matchAll(/node (tests\/[\w-]+\.mjs)/g)].map(
  (match) => match[1],
);
if (!files.length) throw new Error("No cloud tests found in the test:cloud script");
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
