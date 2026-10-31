// Paths owned by the cloud backend (cloud/worker.js on Cloudflare, the Node backend elsewhere),
// never by the Start app: the API (including room WebSockets) and the server-rendered account,
// profile, passkey and published-app pages. Keep in sync with `runWorkerFirst` in
// cloudflare.config.ts.
export const WORKER_PATH_PATTERNS = [
  "/api/*",
  "/u/*",
  "/apps/*",
  "/passkey",
  "/passkey.js",
  "/account/*",
];

/** True when `pathname` belongs to the backend. */
export function isWorkerPath(pathname) {
  return WORKER_PATH_PATTERNS.some((pattern) =>
    pattern.endsWith("/*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern,
  );
}
