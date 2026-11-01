// Sign-in on the web app (cloud/README.md "Web sign-in"). The browser app served by this server
// (web-start) shows its sign-in screen before the editor boots; this module is the server half,
// so a page that skips the screen still cannot use rooms anonymously. The desktop app keeps its
// anonymous sharing: its renderer (app://verynize) and scripts are not the web app, and capability
// links keep working for them as before.
//
// ROOM_ACCOUNT_REQUIRED selects the rule (unset means "web"):
//   web  requests from the web app (a page on this server's origin) need a signed-in account for
//        every room route: creation, reads, writes and sockets. Other clients are unchanged.
//   all  as "web", and creating a room needs an account from any client (the desktop too; its
//        anonymous "Create room" then fails until it signs in). Invite joins still work.
//   off  no account requirement (the behaviour before web sign-in).
import { fail } from "./http.js";

const MODES = new Set(["web", "all", "off"]);

/** The configured rule: "web" (default), "all" or "off". */
export function roomAccountMode(env) {
  const value = String(env?.ROOM_ACCOUNT_REQUIRED ?? "")
    .trim()
    .toLowerCase();
  return MODES.has(value) ? value : "web";
}

/**
 * True when the request comes from a page served by this server: the browser marks same-origin
 * requests (Sec-Fetch-Site, also on WebSocket handshakes), and Origin names the page. The desktop
 * renderer is cross-site (Origin app://verynize); scripts send neither header.
 */
export function fromWebApp(request, url) {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  return !!origin && origin === url.origin;
}

/** Fails with 401 when this room request needs a signed-in account and `account` is null. */
export function requireRoomAccount(env, request, url, account, { creating = false } = {}) {
  if (account) return;
  const mode = roomAccountMode(env);
  if (mode === "off") return;
  if (fromWebApp(request, url) || (mode === "all" && creating))
    fail(401, "Sign in to Verynize first");
}
