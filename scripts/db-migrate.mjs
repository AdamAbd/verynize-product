// Resolve the D1 target from the same configuration used to deploy the Worker.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../cloudflare.config.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: vpr db:migrate [--local] [--dry-run] [--persist-to PATH] [--profile NAME]\nUses worker.env.DB.id from cloudflare.config.ts. Targets the cloud database unless --local is supplied.",
  );
  process.exit(0);
}
// Do not accept flags that could silently choose a different config/migration directory.
for (let i = 0; i < args.length; i++) {
  if (["--local", "--dry-run"].includes(args[i])) continue;
  if (
    ["--persist-to", "--profile"].includes(args[i]) &&
    args[i + 1] &&
    !args[i + 1].startsWith("-")
  ) {
    i++;
    continue;
  }
  console.error(`Unsupported or incomplete argument: ${args[i]}. Run vpr db:migrate --help.`);
  process.exit(1);
}
if (args.includes("--persist-to") && !args.includes("--local")) {
  console.error("--persist-to requires --local.");
  process.exit(1);
}
const binding = config.worker?.env?.DB;
if (binding?.type !== "d1" || !binding.id) {
  console.error(
    "Set worker.env.DB.id in cloudflare.config.ts to your provisioned D1 database before migrating.",
  );
  process.exit(1);
}
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("cf/package.json")), "bin/cf");
const result = spawnSync(
  process.execPath,
  [cli, "d1", "migrations", "apply", binding.id, "--dir", "cloud/migrations", ...args],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
  },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
