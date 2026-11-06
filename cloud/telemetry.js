// Error reports from the collaboration backend. A no-op unless the entry point started a Sentry SDK
// (web-start/src/server.cloudflare.ts on Cloudflare, server/telemetry.mjs on Node and Vercel); the
// event then passes that SDK's allowlist scrubber (web/telemetry-scrub.js).
import { captureException } from "@sentry/core";

/** Report an unexpected error (not an HttpError: those are answers, not failures). */
export function reportError(error, area) {
  try {
    captureException(error, {
      mechanism: { type: "verynize.cloud", handled: true },
      captureContext: { tags: { area } },
    });
  } catch {}
}
