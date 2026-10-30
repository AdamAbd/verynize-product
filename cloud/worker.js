// Verynize collaboration Worker: routes the HTTP API to the room, account and app Durable Objects.
// API reference: cloud/README.md.
import {
  json,
  corsHeaders,
  fail,
  readJson,
  readBytes,
  documentText,
  errorResponse,
  rpc,
  HttpError,
} from "./http.js";
import { SESSION } from "./accounts.js";
import { MAX_FILE, cleanPath } from "./apps.js";
import { profilePage, missingApp } from "./pages.js";
import { passkeyPage, passkeyScript } from "./passkey-page.js";

export { DesignRoom } from "./rooms.js";
export { AccountDirectory } from "./accounts.js";
export { PublishedApp } from "./apps.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROOM_ROUTE = new RegExp(
  `^/api/rooms/(${UUID})(/socket|/publish|/ops|/access|/members(?:/${UUID})?|/claim|/tokens(?:/rotate|/${UUID})?|/comments)?$`,
);
const APP_ROUTE = new RegExp(
  `^/api/apps/(${UUID})(/versions(?:/(\\d+)(/finalize|/files/(.+))?)?|/activate|/publish)?$`,
);
const SERVE_ROUTE =
  /^\/apps\/([a-z0-9][a-z0-9-]{2,29})\/([a-z0-9][a-z0-9-]{0,62})(?:@(\d+))?(\/.*)?$/;

const directory = (env) => env.ACCOUNTS.getByName("directory");
const ip = (request) => request.headers.get("CF-Connecting-IP") || "local";

function sessionOf(request, url) {
  const header = request.headers.get("x-verynize-session") || "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const value = SESSION.test(header)
    ? header
    : SESSION.test(bearer)
      ? bearer
      : (url.pathname.endsWith("/socket") ? url.searchParams.get("session") : "") || "";
  return SESSION.test(value) ? value : null;
}
async function accountOf(env, request, url) {
  const session = sessionOf(request, url);
  return session ? await directory(env).resolveSession(session) : null;
}
async function requireAccount(env, request, url) {
  const account = await accountOf(env, request, url);
  if (!account) fail(401, "Sign in first");
  return account;
}
async function limited(binding, key) {
  if (!binding) return false;
  return !(await binding.limit({ key })).success;
}

/** Forward to a room with only trusted identity headers: client-sent identity headers are dropped. */
function roomRequest(target, request, account, body) {
  const headers = new Headers(request.headers);
  headers.delete("x-verynize-account");
  headers.delete("x-verynize-session");
  if (account)
    headers.set(
      "x-verynize-account",
      JSON.stringify({
        id: account.id,
        email: account.email,
        handle: account.handle,
        displayName: account.displayName,
      }),
    );
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    return new Request(target, { method: request.method, headers, body: JSON.stringify(body) });
  }
  return new Request(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });
}

async function handleAuth(request, env, url) {
  const path = url.pathname;
  if (path === "/api/auth/start" && request.method === "POST") {
    const data = await readJson(request, 16 * 1024);
    if (await limited(env.AUTH_LIMIT, `${ip(request)}:${String(data.email || "").toLowerCase()}`))
      fail(429, "Too many sign-in requests. Try again in a minute.");
    return json(await rpc(directory(env).startSignIn(data.email, url.origin)));
  }
  if (path === "/api/auth/verify" && request.method === "POST") {
    const data = await readJson(request, 16 * 1024);
    if (await limited(env.AUTH_LIMIT, `${ip(request)}:verify`))
      fail(429, "Too many sign-in attempts. Try again in a minute.");
    return json(await rpc(directory(env).verifySignIn(data.token, data.label)));
  }
  if (path === "/api/auth/signout" && request.method === "POST")
    return json(await rpc(directory(env).signOut(sessionOf(request, url))));
  if (path === "/api/auth/signout-all" && request.method === "POST") {
    const account = await requireAccount(env, request, url);
    return json(await rpc(directory(env).signOutEverywhere(account.id)));
  }
  if (path === "/api/me" && request.method === "GET") {
    const account = await requireAccount(env, request, url);
    return json({
      account,
      sessions: await directory(env).sessionCount(account.id),
      profilePath: `/u/${account.handle}`,
    });
  }
  if (path === "/api/me" && request.method === "PATCH") {
    const account = await requireAccount(env, request, url);
    const data = await readJson(request, 16 * 1024);
    const updated = await rpc(
      directory(env).updateProfile(account.id, {
        handle: data.handle,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
      }),
    );
    return json({ account: updated, profilePath: `/u/${updated.handle}` });
  }
  if (path === "/api/me/rooms" && request.method === "GET") {
    const account = await requireAccount(env, request, url);
    return json({ rooms: await directory(env).rooms(account.id) });
  }
  // Passkeys. The relying party is this server's host (PASSKEY_RP_ID overrides it behind a proxy).
  const rp = { origin: url.origin, id: env.PASSKEY_RP_ID || url.hostname };
  if (path === "/api/auth/handoff" && request.method === "POST") {
    if (await limited(env.AUTH_LIMIT, `${ip(request)}:handoff`))
      fail(429, "Too many sign-in attempts. Try again in a minute.");
    return json(await rpc(directory(env).createHandoff()), 201);
  }
  if (path === "/api/auth/handoff/claim" && request.method === "POST") {
    const data = await readJson(request, 16 * 1024);
    const result = await rpc(directory(env).claimHandoff(data.id, data.secret, data.label));
    return json(result, result.pending ? 202 : 200);
  }
  if (path === "/api/auth/passkeys/ticket" && request.method === "POST") {
    const account = await requireAccount(env, request, url);
    return json(await rpc(directory(env).createPasskeyTicket(account.id)), 201);
  }
  if (path === "/api/auth/passkeys/register/options" && request.method === "POST") {
    const data = await readJson(request, 16 * 1024);
    return json(await rpc(directory(env).registrationOptions(data.ticket, rp.id, "Verynize")));
  }
  if (path === "/api/auth/passkeys/register/verify" && request.method === "POST") {
    const data = await readJson(request, 64 * 1024);
    return json(await rpc(directory(env).verifyPasskeyRegistration(data, rp.origin, rp.id)), 201);
  }
  if (path === "/api/auth/passkeys/login/options" && request.method === "POST") {
    const data = await readJson(request, 16 * 1024);
    return json(await rpc(directory(env).loginOptions(data.handoff, rp.id, data.email)));
  }
  if (path === "/api/auth/passkeys/login/verify" && request.method === "POST") {
    const data = await readJson(request, 64 * 1024);
    return json(await rpc(directory(env).verifyPasskeyLogin(data, rp.origin, rp.id)));
  }
  if (path === "/api/me/passkeys" && request.method === "GET") {
    const account = await requireAccount(env, request, url);
    return json({ passkeys: await directory(env).passkeys(account.id) });
  }
  const passkeyMatch = path.match(/^\/api\/me\/passkeys\/([A-Za-z0-9_-]{1,1400})$/);
  if (passkeyMatch && request.method === "DELETE") {
    const account = await requireAccount(env, request, url);
    return json(await rpc(directory(env).deletePasskey(account.id, passkeyMatch[1])));
  }
  if (path === "/api/dev/outbox" && request.method === "GET") {
    if (env.EMAIL_PROVIDER !== "outbox") fail(404, "Not found");
    return json({ messages: await rpc(directory(env).outbox(url.searchParams.get("to"))) });
  }
  const profile = path.match(/^\/api\/profiles\/([a-z0-9-]{1,30})$/);
  if (profile && request.method === "GET") {
    const result = await directory(env).profile(profile[1]);
    return result ? json(result) : json({ error: "Profile not found" }, 404);
  }
  return null;
}

async function handleRooms(request, env, url) {
  if (url.pathname === "/api/rooms" && request.method === "POST") {
    if (await limited(env.ROOM_CREATION, ip(request)))
      return json({ error: "Too many new rooms. Try again in a minute." }, 429);
    const data = await readJson(request);
    documentText(data.document);
    const account = await accountOf(env, request, url);
    const id = crypto.randomUUID();
    const response = await env.ROOMS.getByName(id).fetch(
      roomRequest("https://room/create", request, account, data),
    );
    const result = await response.json();
    if (response.ok && account)
      await directory(env).linkRoom(account.id, id, "owner", result.title);
    return json({ id, ...result }, response.status);
  }
  const publicMatch = url.pathname.match(new RegExp(`^/api/public/(${UUID})\\.([0-9a-f]{64})$`));
  if (publicMatch && request.method === "GET")
    return env.ROOMS.getByName(publicMatch[1]).fetch(
      new Request(`https://room/public?nonce=${publicMatch[2]}`),
    );
  const match = url.pathname.match(ROOM_ROUTE);
  if (!match) return null;
  const roomId = match[1],
    action = match[2] || "/room";
  const account = await accountOf(env, request, url);
  const forward = new URL("https://room" + action);
  if (action === "/socket")
    for (const key of ["token", "client"])
      if (url.searchParams.get(key)) forward.searchParams.set(key, url.searchParams.get(key));
  const stub = env.ROOMS.getByName(roomId);

  if (action === "/members" && request.method === "POST") {
    if (!account) fail(401, "Sign in to invite people by email");
    const data = await readJson(request, 16 * 1024);
    const invitee = await rpc(directory(env).ensureAccount(data.email));
    const response = await stub.fetch(
      roomRequest(forward, request, account, { account: invitee, role: data.role }),
    );
    const result = await response.json();
    if (response.ok) {
      await directory(env).linkRoom(invitee.id, roomId, data.role, result.title);
      result.emailed = await directory(env).notifyInvite(
        invitee.email,
        result.title,
        data.role,
        `${url.origin}/#room=${roomId}`,
      );
    }
    return json(result, response.status);
  }
  const response = await stub.fetch(roomRequest(forward, request, account));
  if (action === "/socket" || !response.ok) return response;
  const result = await response.json();
  if (action === "/publish" && request.method === "POST") {
    const publicId = `${roomId}.${result.nonce}`;
    if (account)
      await directory(env).recordPublication(account.id, {
        kind: "design",
        ref: roomId,
        title: result.title,
        path: `/#public=${publicId}`,
      });
    return json({ publicId, revision: result.revision });
  }
  if (action === "/publish" && request.method === "DELETE")
    await directory(env).removePublication("design", roomId);
  if (action === "/claim" && account)
    await directory(env).linkRoom(account.id, roomId, "owner", result.title);
  if (action.startsWith("/members/") && request.method === "DELETE")
    await directory(env).unlinkRoom(result.removed, roomId);
  return json(result, response.status);
}

async function handleApps(request, env, url) {
  if (url.pathname === "/api/apps") {
    const account = await requireAccount(env, request, url);
    if (request.method === "POST") {
      const data = await readJson(request, 16 * 1024);
      return json(
        { app: await rpc(directory(env).ensureApp(account.id, data.name, data.title)) },
        201,
      );
    }
    if (request.method === "GET") return json({ apps: await directory(env).apps(account.id) });
    return null;
  }
  const match = url.pathname.match(APP_ROUTE);
  if (!match) return null;
  const account = await requireAccount(env, request, url);
  const appId = match[1];
  const app = await directory(env).appInfo(appId);
  if (!app || app.accountId !== account.id) fail(404, "App not found");
  const site = env.APPS.getByName(appId);
  const version = match[3] ? Number(match[3]) : null;
  const sub = match[4] || "";
  if (!match[2] && request.method === "GET") return json({ app, versions: await site.versions() });
  if (match[2] === "/versions" && request.method === "POST") {
    const data = request.body ? await readJson(request, 16 * 1024) : {};
    return json(await rpc(site.createVersion(data.note)), 201);
  }
  if (version !== null && sub.startsWith("/files/") && request.method === "PUT") {
    const path = cleanPath(match[5]);
    if (!path) fail(400, "Invalid file path");
    return json(await rpc(site.putFile(version, path, await readBytes(request, MAX_FILE))));
  }
  if (version !== null && sub === "/finalize" && request.method === "POST") {
    const data = await readJson(request);
    const sealed = await rpc(site.finalize(version, data.files));
    const info =
      data.activate === false ? app : await rpc(directory(env).setActiveVersion(appId, version));
    return json({
      ...sealed,
      app: info,
      url: `${url.origin}${info.path}`,
      versionUrl: `${url.origin}/apps/${info.handle}/${info.name}@${version}/`,
    });
  }
  if (version !== null && !sub && request.method === "DELETE") {
    if (app.activeVersion === version)
      fail(409, "Activate another version or unpublish before deleting the live version");
    return json(await rpc(site.deleteVersion(version)));
  }
  if (match[2] === "/activate" && request.method === "POST") {
    const data = await readJson(request, 16 * 1024);
    if (!Number.isSafeInteger(data.version) || !(await site.isReady(data.version)))
      fail(404, "Version not found");
    return json({ app: await rpc(directory(env).setActiveVersion(appId, data.version)) });
  }
  if (match[2] === "/publish" && request.method === "DELETE")
    return json({
      app: await rpc(directory(env).setActiveVersion(appId, null)),
      unpublished: true,
    });
  return null;
}

/** Serve a published app build. Apps run sandboxed (opaque origin) so they cannot read editor or API state. */
async function serveApp(request, env, url) {
  const match = url.pathname.match(SERVE_ROUTE);
  if (!match || !["GET", "HEAD"].includes(request.method)) return null;
  const [, handle, name, pinned, rest] = match;
  if (rest === undefined)
    return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const app = await directory(env).resolveApp(handle, name);
  if (!app) return missingApp();
  const version = pinned ? Number(pinned) : app.activeVersion;
  if (version === null || version === undefined) return missingApp("This app was unpublished.");
  const file = await env.APPS.getByName(app.id).read(version, rest.slice(1));
  if (!file)
    return missingApp(
      pinned ? "That version or file does not exist." : "That file is not part of this app.",
    );
  const prefix = `/apps/${app.handle}/${app.name}${pinned ? "@" + version : ""}/`;
  const headers = new Headers({
    "content-type": file.contentType,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "access-control-allow-origin": "*",
    "content-security-policy":
      "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
    "cache-control": pinned ? "public, max-age=31536000, immutable" : "no-cache",
    etag: `"${file.sha256}"`,
    "x-verynize-app-version": String(version),
  });
  if (request.headers.get("if-none-match") === `"${file.sha256}"`)
    return new Response(null, { status: 304, headers });
  let body = file.body;
  if (file.contentType.startsWith("text/html")) {
    // A base element makes relative asset URLs resolve from the app root for nested client routes.
    let html = new TextDecoder().decode(body);
    if (!/<base\s/i.test(html)) {
      const tag = `<base href="${prefix}">`;
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (head) => head + tag)
        : tag + html;
    }
    body = new TextEncoder().encode(html);
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (url.pathname.startsWith("/api/")) {
        const response =
          (await handleAuth(request, env, url)) ||
          (await handleRooms(request, env, url)) ||
          (await handleApps(request, env, url));
        return response || json({ error: "Not found" }, 404);
      }
      if (url.pathname === "/passkey" && request.method === "GET") return passkeyPage();
      if (url.pathname === "/passkey.js" && request.method === "GET") return passkeyScript();
      const profile = url.pathname.match(/^\/u\/([a-z0-9-]{1,30})\/?$/);
      if (profile && request.method === "GET")
        return profilePage(await directory(env).profile(profile[1]));
      if (url.pathname.startsWith("/apps/"))
        return (await serveApp(request, env, url)) || missingApp();
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Verynize API", { status: 200 });
    } catch (error) {
      if (!(error instanceof HttpError))
        console.error("request failed", url.pathname, error?.message);
      return errorResponse(error);
    }
  },
};
