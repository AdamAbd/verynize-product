// Options shared by the Cloudflare (vite.config.ts) and Node (vite.node.config.ts) builds of the
// TanStack Start web app in web-start/.
import { fileURLToPath } from "node:url";
import { legacyWeb } from "./legacy-web.mjs";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const webDir = fileURLToPath(new URL("../../web", import.meta.url));
export const srcDirectory = "web-start/src";

/** Plugins common to both targets (Start itself is added by each config). */
export const sharedPlugins = () => [legacyWeb({ webDir })];
