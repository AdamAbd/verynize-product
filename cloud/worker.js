import { sql } from "drizzle-orm";
import { database } from "./db.js";
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
  roleRank,
  HttpError,
} from "./http.js";
import { SESSION } from "./accounts.js";
import { AUTH_BASE_PATH, createAuth } from "./auth.js";
import {
  addRoom,
  ensurePersonalOrganization,
  membership,
  moveRoom,
  orgRoomRole,
  organizationRooms,
  refreshMember,
  refreshRoom,
  roomOrganization,
  roomRoleFor,
  syncTitle,
  userOrganizationRooms,
} from "./orgs.js";
import { MAX_FILE, cleanPath } from "./apps.js";
import { profilePage, missingApp } from "./pages.js";
import { passkeyPage, passkeyScript } from "./passkey-page.js";
import { verifiedPage, resetPasswordPage, resetPasswordScript } from "./account-pages.js";
import * as profiles from "./profiles.js";
import { handleRoomAssets } from "./assets.js";

export { DesignRoom } from "./rooms.js";
export { AccountDirectory } from "./accounts.js";
export { PublishedApp } from "./apps.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROOM_ROUTE = new RegExp(
  `^/api/rooms/(${UUID})(/socket|/publish|/ops|/access|/members(?:/${UUID})?|/claim|/organization|/tokens(?:/rotate|/${UUID})?|/comments)?$`,
);
const APP_ROUTE = new RegExp(
  `^/api/apps/(${UUID})(/versions(?:/(\\d+)(/finalize|/files/(.+))?)?|/activate|/publish)?$`,
);
// Room assets (cloud/assets.js).
const ASSET_ROUTE = new RegExp(`^/api/rooms/(${UUID})/assets(?:/(${UUID}))?$`);
const SERVE_ROUTE =
  /^\/apps\/([a-z0-9][a-z0-9-]{2,29})\/([a-z0-9][a-z0-9-]{0,62})(?:@(\d+))?(\/.*)?$/;

const directory = (env) => env.ACCOUNTS.getByName("directory");
const ip = (request) => request.headers.get("CF-Connecting-IP") || "local";

// Sessions: legacy directory sessions (`vs_…`) and Better Auth bearer tokens (`<id>.<signature>`,
// cloud/auth.js). Either travels in X-Verynize-Session, Authorization (where room capability
// tokens are 64 hex characters, so the formats cannot collide) or, for sockets, ?session=.
const AUTH_TOKEN = /^[A-Za-z0-9]{16,64}\.[A-Za-z0-9+/=_%-]{16,128}$/;
const isSession = (value) => SESSION.test(value) || AUTH_TOKEN.test(value);
function sessionOf(request, url) {
  const header = request.headers.get("x-verynize-session") || "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const value = isSession(header)
    ? header
    : isSession(bearer)
      ? bearer
      : (url.pathname.endsWith("/socket") ? url.searchParams.get("session") : "") || "";
  return isSession(value) ? value : null;
}
const authHeaders = (token) => new Headers({ authorization: `Bearer ${token}` });
/** The Better Auth session for a bearer token, or null. */
async function authSession(env, request, token) {
  if (!env.DB || !AUTH_TOKEN.test(token)) return null;
  return await createAuth(env, request).api.getSession({ headers: authHeaders(token) });
}
async function accountOf(env, request, url) {
  const session = sessionOf(request, url);
  if (!session) return null;
  if (SESSION.test(session)) {
    const id = await directory(env).resolveSession(session);
    return id ? await profiles.getProfile(env, id) : null;
  }
  // Better Auth users act through their directory profile (rooms, profiles, apps, passkeys).
  const found = await authSession(env, request, session);
  if (!found?.user?.emailVerified) return null;
  const { profile: account, linked } = await profiles.linkUser(env, found.user);
  if (linked) await adoptLegacyRooms(env, request, account, found.user);
  // The Better Auth user (organizations); not serialized into responses.
  Object.defineProperty(account, "authUser", { value: found.user, enumerable: false });
  return account;
}
/**
 * First sign-in of an account that existed before email + password: the rooms it owns outside any
 * organization move into the user's personal organization, so its workspace shows them.
 */
async function adoptLegacyRooms(env, request, account, user) {
  const owned = (await profiles.rooms(env, account.id)).filter((room) => room.role === "owner");
  if (!owned.length) return;
  const personal = await ensurePersonalOrganization(env, createAuth(env, request), user);
  for (const room of owned)
    if (!(await roomOrganization(env, room.id)))
      await addRoom(env, {
        id: room.id,
        organizationId: personal,
        title: room.title,
        userId: user.id,
      });
}
/** Session responses from the credential store carry its mirror; answer with the D1 profile. */
async function withProfile(env, result) {
  if (!result?.session || !result.account?.id) return result;
  return { ...result, account: await profiles.getProfile(env, result.account.id) };
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
function roomRequest(target, request, account, body, orgRole) {
  const headers = new Headers(request.headers);
  headers.delete("x-verynize-account");
  headers.delete("x-verynize-session");
  headers.delete("x-verynize-org-role");
  if (orgRole) headers.set("x-verynize-org-role", orgRole);
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
  const streamed = !["GET", "HEAD"].includes(request.method);
  return new Request(target, {
    method: request.method,
    headers,
    body: streamed ? request.body : undefined,
    // A streamed body needs a half-duplex request outside workerd (Node's fetch).
    duplex: streamed ? "half" : undefined,
  });
}

// Better Auth endpoints that send email or check a password are limited per IP and endpoint.
const LIMITED_AUTH = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/change-password",
]);

/** Better Auth (cloud/auth.js) under /api/auth/*, after the legacy account routes. */
async function handleBetterAuth(request, env, url) {
  if (!url.pathname.startsWith(AUTH_BASE_PATH + "/")) return null;
  if (!env.DB) fail(503, "Accounts database is not configured on this server");
  const endpoint = url.pathname.slice(AUTH_BASE_PATH.length);
  if (
    request.method === "POST" &&
    LIMITED_AUTH.has(endpoint) &&
    (await limited(env.AUTH_LIMIT, `${ip(request)}:ba${endpoint}`))
  )
    fail(429, "Too many requests. Try again in a minute.");
  // Bearer tokens only (see cloud/auth.js): no cookies in, no cookies out.
  const headersIn = new Headers(request.headers);
  headersIn.delete("cookie");
  // The desktop sends one session header everywhere; Better Auth reads Authorization.
  const session = request.headers.get("x-verynize-session") || "";
  if (AUTH_TOKEN.test(session)) headersIn.set("authorization", `Bearer ${session}`);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
  const forwarded = new Request(request.url, { method: request.method, headers: headersIn, body });
  // Leaving an organization runs no Better Auth hook; refresh room access here.
  let leaving = null;
  if (endpoint === "/organization/leave" && request.method === "POST") {
    const token = sessionOf(request, url);
    const found = token ? await authSession(env, request, token) : null;
    let organizationId = null;
    try {
      organizationId = JSON.parse(body || "{}").organizationId;
    } catch {}
    if (found && typeof organizationId === "string")
      leaving = { organizationId, userId: found.user.id };
  }
  const response = await createAuth(env, request).handler(forwarded);
  if (leaving && response.ok) await refreshMember(env, leaving.organizationId, leaving.userId);
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  headers.set("access-control-expose-headers", "set-auth-token");
  return new Response(response.body, { status: response.status, headers });
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
    const { email } = await rpc(directory(env).consumeSignInLink(data.token));
    const account = await profiles.ensureProfile(env, email, { verified: true });
    await directory(env).mirrorAccount(account);
    const { session } = await directory(env).newSession(account.id, data.label);
    return json({ session, account });
  }
  if (path === "/api/auth/signout" && request.method === "POST") {
    const session = sessionOf(request, url);
    if (session && !SESSION.test(session) && env.DB) {
      await createAuth(env, request).api.signOut({ headers: authHeaders(session) });
      return json({ signedOut: true });
    }
    return json(await rpc(directory(env).signOut(session)));
  }
  if (path === "/api/auth/signout-all" && request.method === "POST") {
    const account = await requireAccount(env, request, url);
    // Ends both kinds of session: Better Auth ones of this email and directory (passkey) ones.
    const session = sessionOf(request, url);
    let revoked = 0;
    if (!SESSION.test(session)) {
      const auth = createAuth(env, request);
      revoked = (await auth.api.listSessions({ headers: authHeaders(session) })).length;
      await auth.api.revokeSessions({ headers: authHeaders(session) });
    }
    const legacy = await rpc(directory(env).signOutEverywhere(account.id));
    return json({ signedOut: true, sessions: legacy.sessions + revoked });
  }
  if (path === "/api/me" && request.method === "GET") {
    const account = await requireAccount(env, request, url);
    const session = sessionOf(request, url);
    const authSessions = SESSION.test(session)
      ? 0
      : (await createAuth(env, request).api.listSessions({ headers: authHeaders(session) })).length;
    const personalOrganizationId = account.authUser
      ? await ensurePersonalOrganization(env, createAuth(env, request), account.authUser)
      : null;
    return json({
      account,
      sessions: (await directory(env).sessionCount(account.id)) + authSessions,
      profilePath: `/u/${account.handle}`,
      personalOrganizationId,
    });
  }
  if (path === "/api/me" && request.method === "PATCH") {
    const account = await requireAccount(env, request, url);
    const data = await readJson(request, 16 * 1024);
    const updated = await rpc(
      profiles.updateProfile(env, account.id, {
        handle: data.handle,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
      }),
    );
    await directory(env).mirrorAccount(updated);
    return json({ account: updated, profilePath: `/u/${updated.handle}` });
  }
  if (path === "/api/me/rooms" && request.method === "GET") {
    const account = await requireAccount(env, request, url);
    // Direct memberships plus rooms reached through organizations; the higher role wins.
    const rooms = new Map();
    for (const room of await profiles.rooms(env, account.id)) rooms.set(room.id, room);
    if (account.authUser)
      for (const room of await userOrganizationRooms(env, account.authUser.id)) {
        const direct = rooms.get(room.id);
        const role =
          direct && roleRank(direct.role) > roleRank(room.role) ? direct.role : room.role;
        rooms.set(room.id, { ...direct, ...room, role });
      }
    return json({
      rooms: [...rooms.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    });
  }
  const orgRooms = path.match(/^\/api\/orgs\/([A-Za-z0-9_-]{1,64})\/rooms$/);
  if (orgRooms && request.method === "GET") {
    const account = await requireAccount(env, request, url);
    const role = account.authUser ? await membership(env, orgRooms[1], account.authUser.id) : null;
    if (!role) fail(404, "Organization not found");
    const org = await database(env).get(
      sql`SELECT "metadata" FROM "organization" WHERE "id" = ${orgRooms[1]}`,
    );
    return json({
      role: roomRoleFor(role, org?.metadata),
      rooms: await organizationRooms(env, orgRooms[1]),
    });
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
    const result = await withProfile(
      env,
      await rpc(directory(env).claimHandoff(data.id, data.secret, data.label)),
    );
    return json(result, result.pending ? 202 : 200);
  }
  if (path === "/api/auth/passkeys/ticket" && request.method === "POST") {
    const account = await requireAccount(env, request, url);
    await directory(env).mirrorAccount(account);
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
    return json(
      await withProfile(env, await rpc(directory(env).verifyPasskeyLogin(data, rp.origin, rp.id))),
    );
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
    const result = await profiles.publicCreator(env, profile[1]);
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
    // Email accounts create rooms in an organization: the one named, or their personal one.
    let organizationId = null;
    if (account?.authUser) {
      if (data.organizationId !== undefined) {
        organizationId = String(data.organizationId);
        if (!(await membership(env, organizationId, account.authUser.id)))
          fail(403, "You are not a member of this organization");
      } else
        organizationId = await ensurePersonalOrganization(
          env,
          createAuth(env, request),
          account.authUser,
        );
    } else if (data.organizationId !== undefined)
      fail(401, "Sign in with your email and password to create rooms in an organization");
    const id = crypto.randomUUID();
    const response = await env.ROOMS.getByName(id).fetch(
      roomRequest("https://room/create", request, account, { document: data.document }),
    );
    const result = await response.json();
    if (response.ok && account) await profiles.linkRoom(env, account.id, id, "owner", result.title);
    if (response.ok && organizationId)
      await addRoom(env, { id, organizationId, title: result.title, userId: account.authUser.id });
    return json({ id, ...result, organizationId }, response.status);
  }
  const publicMatch = url.pathname.match(new RegExp(`^/api/public/(${UUID})\\.([0-9a-f]{64})$`));
  if (publicMatch && request.method === "GET")
    return env.ROOMS.getByName(publicMatch[1]).fetch(
      new Request(`https://room/public?nonce=${publicMatch[2]}`),
    );
  // ---- Room assets (cloud/assets.js): R2 images referenced by URL from room documents. ----
  const assetMatch = url.pathname.match(ASSET_ROUTE);
  if (assetMatch) {
    const [, assetRoom, assetId] = assetMatch;
    // The caller's room role, computed by the room exactly as for /access.
    const access = async () => {
      const account = await accountOf(env, request, url);
      const orgRole = account?.authUser
        ? await orgRoomRole(env, assetRoom, account.authUser.id)
        : null;
      const asGet = new Request(request.url, { method: "GET", headers: request.headers });
      const checked = await env.ROOMS.getByName(assetRoom).fetch(
        roomRequest(new URL("https://room/access"), asGet, account, undefined, orgRole),
      );
      return { role: checked.ok ? (await checked.json()).role : null, account };
    };
    return handleRoomAssets(request, env, url, assetRoom, assetId || null, access);
  }
  // ---- end room assets ----
  const match = url.pathname.match(ROOM_ROUTE);
  if (!match) return null;
  const roomId = match[1],
    action = match[2] || "/room";
  const account = await accountOf(env, request, url);
  const orgRole = account?.authUser ? await orgRoomRole(env, roomId, account.authUser.id) : null;
  const forward = new URL("https://room" + action);
  if (action === "/socket")
    for (const key of ["token", "client"])
      if (url.searchParams.get(key)) forward.searchParams.set(key, url.searchParams.get(key));
  const stub = env.ROOMS.getByName(roomId);

  if (action === "/members" && request.method === "POST") {
    if (!account) fail(401, "Sign in to invite people by email");
    const data = await readJson(request, 16 * 1024);
    const invitee = await profiles.ensureProfile(env, data.email);
    const response = await stub.fetch(
      roomRequest(forward, request, account, { account: invitee, role: data.role }, orgRole),
    );
    const result = await response.json();
    if (response.ok) {
      await profiles.linkRoom(env, invitee.id, roomId, data.role, result.title);
      result.emailed = await directory(env).notifyInvite(
        invitee.email,
        result.title,
        data.role,
        `${url.origin}/#room=${roomId}`,
      );
    }
    return json(result, response.status);
  }
  if (action === "/organization" && request.method === "PUT") {
    // Move a room into an organization (room owners who are members of the target).
    if (!account?.authUser) fail(401, "Sign in with your email and password first");
    const data = await readJson(request, 16 * 1024);
    const organizationId = typeof data.organizationId === "string" ? data.organizationId : "";
    if (!organizationId || !(await membership(env, organizationId, account.authUser.id)))
      fail(403, "You are not a member of that organization");
    const asGet = new Request(request.url, { method: "GET", headers: request.headers });
    const checked = await stub.fetch(
      roomRequest(new URL("https://room/access"), asGet, account, undefined, orgRole),
    );
    const access = await checked.json();
    if (!checked.ok) return json(access, checked.status);
    if (access.role !== "owner") fail(403, "Only room owners can move a room");
    if (await roomOrganization(env, roomId)) await moveRoom(env, roomId, organizationId);
    else
      await addRoom(env, {
        id: roomId,
        organizationId,
        title: access.title,
        userId: account.authUser.id,
      });
    await refreshRoom(env, roomId, organizationId);
    const org = await roomOrganization(env, roomId);
    return json({ organization: { id: org.id, name: org.name } });
  }
  const response = await stub.fetch(roomRequest(forward, request, account, undefined, orgRole));
  if (action === "/socket" || !response.ok) return response;
  const result = await response.json();
  if (result?.title) await syncTitle(env, roomId, result.title);
  if (action === "/access") {
    const org = await roomOrganization(env, roomId);
    result.organization = org ? { id: org.id, name: org.name } : null;
  }
  if (action === "/publish" && request.method === "POST") {
    const publicId = `${roomId}.${result.nonce}`;
    if (account)
      await profiles.recordPublication(env, account.id, {
        kind: "design",
        ref: roomId,
        title: result.title,
        path: `/#public=${publicId}`,
      });
    return json({ publicId, revision: result.revision });
  }
  if (action === "/publish" && request.method === "DELETE")
    await profiles.removePublication(env, "design", roomId);
  if (action === "/claim" && account)
    await profiles.linkRoom(env, account.id, roomId, "owner", result.title);
  if (action.startsWith("/members/") && request.method === "DELETE")
    await profiles.unlinkRoom(env, result.removed, roomId);
  return json(result, response.status);
}

async function handleApps(request, env, url) {
  if (url.pathname === "/api/apps") {
    const account = await requireAccount(env, request, url);
    if (request.method === "POST") {
      const data = await readJson(request, 16 * 1024);
      return json({ app: await profiles.ensureApp(env, account.id, data.name, data.title) }, 201);
    }
    if (request.method === "GET") return json({ apps: await profiles.apps(env, account.id) });
    return null;
  }
  const match = url.pathname.match(APP_ROUTE);
  if (!match) return null;
  const account = await requireAccount(env, request, url);
  const appId = match[1];
  const app = await profiles.appInfo(env, appId);
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
      data.activate === false ? app : await profiles.setActiveVersion(env, appId, version);
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
    return json({ app: await profiles.setActiveVersion(env, appId, data.version) });
  }
  if (match[2] === "/publish" && request.method === "DELETE")
    return json({
      app: await profiles.setActiveVersion(env, appId, null),
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
  const app = await profiles.resolveApp(env, handle, name);
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
      // The directory moved to D1: copy the AccountDirectory data once, before it is read.
      if (/^\/(api|u|apps)\//.test(url.pathname)) await profiles.migrateDirectory(env);
      if (url.pathname === "/api/mcp") {
        // Hosted MCP (cloud/mcp.js). Loaded on first use: it bundles the design engine.
        const { handleMcp } = await import("./mcp.js");
        return await handleMcp(request, env, url, { accountOf, limited });
      }
      if (url.pathname.startsWith("/api/")) {
        const response =
          (await handleAuth(request, env, url)) ||
          (await handleBetterAuth(request, env, url)) ||
          (await handleRooms(request, env, url)) ||
          (await handleApps(request, env, url));
        return response || json({ error: "Not found" }, 404);
      }
      if (url.pathname === "/passkey" && request.method === "GET") return passkeyPage();
      if (url.pathname === "/passkey.js" && request.method === "GET") return passkeyScript();
      if (request.method === "GET") {
        if (url.pathname === "/account/verified") return verifiedPage(url);
        if (url.pathname === "/account/reset-password") return resetPasswordPage(url);
        if (url.pathname === "/account/reset-password.js") return resetPasswordScript();
      }
      const profile = url.pathname.match(/^\/u\/([a-z0-9-]{1,30})\/?$/);
      if (profile && request.method === "GET")
        return profilePage(await profiles.publicCreator(env, profile[1]));
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
