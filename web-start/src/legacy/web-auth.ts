// Sign-in before the editor (cloud/README.md "Web sign-in"). The editor layout (routes/_editor.tsx) asks webAccess()
// before it boots the legacy editor: without a session for this server it renders the sign-in screen
// (web/src/islands/onboarding/web-sign-in.tsx) in place of every editor route, at the requested address, so the
// path and an invite fragment (`#room=…&token=…`) are still there when the editor boots after signing in. Published
// snapshots (`#public=…`) open without an account. The server enforces the same rule for room requests from this
// origin (cloud/web-access.js).
//
// Loaded client-side only (a dynamic import from the layout), so the server never evaluates the renderer modules.
import { platform } from "@/lib/platform";
import { checkWebSession, isPublicLink, storedWebSession } from "@/lib/web-session";
import { loadLegacyStyles } from "./boot";

/** `<html data-web-auth>`: checking, then signed-out (sign-in screen), signed-in or public (snapshot link). */
export type WebAccess = "checking" | "signed-out" | "signed-in" | "public";

export async function webAccess(): Promise<Exclude<WebAccess, "checking">> {
  // Only the web runtime signs in here. The desktop app (app://verynize, web/index.html) never loads this app, and its
  // local-first editor is not gated.
  if (platform.kind !== "web") return "signed-in";
  const [signedIn] = await Promise.all([checkWebSession(), loadLegacyStyles()]);
  if (signedIn) return "signed-in";
  return isPublicLink() ? "public" : "signed-out";
}

/**
 * Once the editor runs: when the session for this server goes away (Sign out in the Share panel or Settings, or an
 * account on another server), load the page again, which shows the sign-in screen. The short delay lets the legacy
 * sign-out finish its own work (closing the room, storing its outbox).
 */
export function watchSignOut() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (storedWebSession() || isPublicLink()) return;
    clearTimeout(timer);
    timer = setTimeout(() => location.reload(), 250);
  };
  window.addEventListener("cloud-account-changed", changed);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("cloud-account-changed", changed);
  };
}
