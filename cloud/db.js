import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

// Bindings belong to the current Worker request; never cache across environments.
export function database(env) {
  return drizzle(env.DB, { schema });
}
