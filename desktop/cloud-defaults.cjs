// Share panel server default (web/cloud-panel.js asks cloudDefaults() on a fresh profile).
// The desktop page is served from app://verynize, so it has no HTTP origin to fall back on: the
// default is the production service, or VERYNIZE_CLOUD_SERVER (tests point it at local workerd).
// Automated runs (VERYNIZE_SKIP_ONBOARDING=1, set by every Electron test) and
// VERYNIZE_BLOCK_PRODUCTION_CLOUD=1 cancel every renderer request to production, so a test that
// forgets to choose its local server fails instead of writing to the live service.
const PRODUCTION_CLOUD = "https://verynize.gayaloo.app";

function cloudServerDefault(env = process.env) {
  const value = env.VERYNIZE_CLOUD_SERVER;
  if (!value) return PRODUCTION_CLOUD;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw Error("VERYNIZE_CLOUD_SERVER must be an HTTP or HTTPS origin");
  return url.origin;
}

const productionBlocked = (env = process.env) =>
  env.VERYNIZE_SKIP_ONBOARDING === "1" || env.VERYNIZE_BLOCK_PRODUCTION_CLOUD === "1";

/** Cancel requests to the production service in automated runs (the editor's default session only). */
function guardProduction(session, env = process.env) {
  if (!productionBlocked(env)) return false;
  const host = new URL(PRODUCTION_CLOUD).host;
  session.webRequest.onBeforeRequest(
    { urls: ["http", "https", "ws", "wss"].map((scheme) => `${scheme}://${host}/*`) },
    (details, callback) => {
      console.warn(
        `Blocked a request to ${host} in an automated run: ${details.method} ${new URL(details.url).pathname}`,
      );
      callback({ cancel: true });
    },
  );
  return true;
}

function registerCloudDefaults(handle, env = process.env) {
  const server = cloudServerDefault(env);
  handle("cloudDefaults", () => ({ server }));
}

module.exports = { PRODUCTION_CLOUD, cloudServerDefault, guardProduction, registerCloudDefaults };
