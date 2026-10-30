// Prints the SQL that creates the Better Auth tables for cloud/auth.js, derived from the same
// options the Worker uses (run against an empty in-memory node:sqlite database). Use it to start
// a new D1 migration after changing auth plugins or fields:
//   node scripts/auth-schema.mjs > cloud/migrations/000N_<name>.sql   (then review the diff)
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../cloud/auth.js";

const options = authOptions(
  { BETTER_AUTH_SECRET: "schema-generation-only-secret-000000" },
  { baseURL: "http://localhost", database: new DatabaseSync(":memory:") },
);
const { compileMigrations } = await getMigrations(options);
process.stdout.write((await compileMigrations()).trim() + "\n");
