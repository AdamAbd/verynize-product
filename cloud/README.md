# Cloud collaboration service

The Worker (`cloud/worker.js`) serves Better Auth identities from D1 (`cloud/auth.js`) and routes the rest of the HTTP API to three kinds of SQLite Durable Objects:

- `DesignRoom` (`cloud/rooms.js`), one per shared room: document, capability links with roles, account members, operation merging, comments, WebSocket presence and frozen public snapshots.
- `AccountDirectory` (`cloud/accounts.js`), a single instance: credentials only. It holds magic-link sign-in, hashed legacy sessions, passkeys, handoffs, the development outbox and a mirror of each account (id, email, handle, name) for passkey ceremonies. Profiles, the room membership index, publications and the app registry live in D1 (`cloud/profiles.js`, see "Account directory in D1").
- `PublishedApp` (`cloud/apps.js`), one per published app: immutable, versioned static builds.

Documents are generic JSON (object or array) up to 2 MB per request. Version-2 design documents (`pages[].nodes[]`) merge per page, per node and per property. Other documents merge per top-level key.

## Merging (`web/cloud-ops.js`, shared by the Worker and the desktop panel)

Each local change is turned into small operations: `doc`, `page`, `node` (property set or delete), `add` and `remove` (node), `addPage` and `removePage`, `nodeOrder` and `pageOrder`, `text` (string edit with its base), and `root` (whole-value fallback). Every operation carries a hybrid logical clock stamp (`wall.count.replica`, compared as a string). The room applies batches in arrival order:

- Each property path keeps the newest stamp, so the last writer wins per property. Stale writes are dropped even when they arrive late or after a restart, because stamps persist in SQLite. Stamps more than five minutes in the future are replaced with a server stamp.
- Text edits made from the same base are merged by range: disjoint edits are both kept, and overlapping edits fall back to the newest stamp.
- A `parentId` change that would create a cycle, or that points at a missing parent, is rejected. After each batch, orphaned children (whose parent was deleted concurrently) are reattached to the page.
- Deleting a node beats concurrent property edits. A newer re-add (undo) restores the node, but an older add cannot resurrect it.
- Each batch is applied at most once per `client` and `batch` number, and the reconnect snapshot reports the last acknowledged batch.

The room broadcasts only accepted, resolved operations (`{type:'ops',revision,client,batch,ops,rejected}`). Replaying them in order reproduces the server document exactly. Each client renders the confirmed server state plus its own unacknowledged batches.

While collaborating, undo and redo step through this client's own changes only (`window.cloudHistory`, which `web/app.js` consults). Each step stores the documents around the local change, and consecutive changes within 600 ms with no remote edit between them form one step. Undo replays the inverse operations rebased over the remote operations received since that step:

- Properties, page and node orders, and nodes that a collaborator changed later are left alone.
- An add is not undone if a collaborator edited that node.
- Text inverses are merged by range into the current text, and are skipped when the ranges overlap.

Redo works the same way.

This is server-sequenced operation merging, not a peer-to-peer CRDT. It needs the room to order batches, and edits made while offline are merged when the socket reconnects.

## Cloud files and offline edits (`web/cloud-panel.js`, `web/wonder-shell.js`)

A room behaves like a file that the desktop and the web editor open:

- **Identity.** A file library record can be cloud-backed: `cloud: {server, roomId, token?, role, detached?}`. The capability token is kept only for rooms joined or created with a link, in the same device-local storage as the record itself. Rooms reached through an account (direct member or organization) store no token and reconnect with the account session. Duplicating a file drops the link.
- **Opening.** Opening a cloud-backed record (`fileLibrary.open`, which emits `library-file-opened`), or starting the app with one as the current file, reconnects to its room. Joining a room (invite, Account › Your rooms, Files home) opens the room's existing record instead of creating another copy; the first join creates it. Create room marks the open file as the room's file. Disconnect, leaving the room and revocation keep the local copy and mark it `detached`; a detached copy that was edited since is left as a separate local file when the room is joined again, and the room gets a new record.
- **Files home.** Signed in with an email account, the Files home lists the rooms of the active workspace (`GET /api/orgs/:id/rooms`) and rooms shared with you directly (`GET /api/me/rooms` entries without an organization), merged with the device's cloud-backed records so a room appears once. Cards carry `data-room-id`, the workspace (or "Shared with you"), a cloud mark and the role. Opening a listed room joins it (`cloudWorkspace.openRoom`).
- **Persistent outbox.** For each room the device stores, in IndexedDB (`verynize-cloud` › `outbox`, key `<server>|<roomId>`), its client id, batch counter, unacknowledged batches and the last confirmed document and revision. It is written shortly after every queued batch, acknowledgement or remote change, and immediately when the file is switched. Reopening the file (also after a restart) reuses the client id, so the socket's `acked` drops the batches the server already applied and the rest are resent; the server applies each batch at most once per client id. Edits in the file beyond the stored confirmed document and batches (made while the room was closed, or not yet stored when the app quit) are diffed and sent as one more batch. Beyond 4000 operations or about 1.5 MB of batches only the confirmed document is kept, and the file is diffed against it again (whole-document fallback).
- **Offline.** When the server is unreachable, a file with a stored outbox opens offline: edits queue and persist, and the socket keeps retrying (backoff up to 15 s). On reconnect the server snapshot replaces the confirmed document and the pending batches are rebased onto it as usual. A file never opened on the device cannot open offline.
- **Clearing.** Disconnect, leaving the room, revocation (`revoked`, or 401/403/404 when reopening) clear the stored outbox. Signing out keeps the record linked; it reconnects after signing in again.

`window.cloudWorkspace` also exposes `room()`, `openRoom({server,id})`, `pendingCount()` and `storedOutbox(server,id)`; `window.fileLibrary` adds `findCloud(server,roomId)`, `cloudOf(id)` and `setCloud(id,cloud)`.

## API

Rooms (capability `Authorization: Bearer <64 hex>` and/or session `X-Verynize-Session: vs_…`):

- `POST /api/rooms` `{document}` → 201 `{id,token,revision:0,role:'owner'}`. With a session, the creator becomes an owner member. Rate limited to 10 per minute per IP.
- `GET /api/rooms/:id` → `{document,revision,role,protocol:2,title}`.
- `PUT /api/rooms/:id` `{document,baseRevision}` (editor) → `{document,revision}`, or 409 `{error,document,revision}`. This legacy whole-snapshot write is still supported, and it stamps its changes so that older operations lose to it.
- `POST /api/rooms/:id/ops` `{client,batch,ops}` (editor) → the ops message. This is the REST fallback when no socket is open.
- `GET /api/rooms/:id/socket?token=…&session=…&client=…` upgrades to a WebSocket. The server sends `welcome {id,protocol,role,acked}`, then `snapshot {document,revision,acked}`. Clients send `ops {batch,ops}`, `presence {name,cursor,pageId}` or the legacy `update {document,baseRevision}`. The server sends `ops`, `snapshot`, `presence {peers}`, `role {role}`, `revoked`, `comment {comment}`, `conflict` (legacy only) and `error`. A room allows at most 32 connections.
- `POST /api/rooms/:id/publish` (editor) → `{publicId,revision}`. It freezes the latest revision, and publishing again rotates the public link. With a session, the design is listed on the creator's profile. `DELETE /api/rooms/:id/publish` revokes public reads and removes the listing. `GET /api/public/:publicId` → `{document,revision}`.
- `GET /api/rooms/:id/access` → `{role,members,title}`. Owners also receive `links` (id, role, label, created).
- `POST /api/rooms/:id/members` `{email,role}` (signed-in owner) adds or changes an account member. An unknown email gets an unverified account, and an invitation is emailed. `DELETE /api/rooms/:id/members/:accountId` removes a member (owners remove anyone; anyone may leave). The last owner account cannot be removed unless an owner link exists.
- `POST /api/rooms/:id/tokens` `{role,label}` (owner) → `{id,token,role}` for a role-limited invite link. `DELETE /api/rooms/:id/tokens/:id` revokes one link.
- `POST /api/rooms/:id/tokens/rotate` (owner) → `{token,role:'owner',revoked}`. Every capability link is deleted and a new owner link is issued. Sockets that relied on a revoked link receive `revoked` and are closed with code 4401. Account members keep their access. An owner account can call this with only its session, which is how a lost owner link is recovered.
- `POST /api/rooms/:id/claim` (owner link plus session) adds the signed-in account as an owner. Rooms created before accounts can be attached to an account this way.
- `GET|POST /api/rooms/:id/comments`: reading needs viewer, posting needs commenter. Comments take `{text,nodeId?,pageId?}`.

Roles are `viewer` < `commenter` < `editor` < `owner`. A request's role is the higher of its capability link's role and its account membership's role. Viewers and commenters can read the room and see presence. Comments need commenter. Edits, snapshots and publishing need editor. Members, links, rotation and claiming need owner.

Accounts:

- `POST /api/auth/start` `{email}` sends a single-use sign-in link (`<origin>/#signin=<64 hex>`) that is valid for 15 minutes. It is rate limited per IP and email.
- `POST /api/auth/verify` `{token,label?}` → `{session:'vs_…',account}`. The account is created on first use. Sessions last 30 days and are stored as SHA-256 hashes.
- `GET /api/me` → `{account,sessions,profilePath}`. `PATCH /api/me` takes `{handle?,displayName?,avatarUrl?}`. Handles are unique, 3–30 characters of `a-z 0-9 -`, and some names are reserved. Avatars must be `https:` URLs. `GET /api/me/rooms` lists the account's rooms and roles.
- `POST /api/auth/signout` ends the current session. `POST /api/auth/signout-all` ends every session of the account.
- Passkeys (original WebAuthn verification in `cloud/webauthn.js`: WebCrypto plus a minimal CBOR/COSE reader; ES256, Ed25519 and RS256; attestation is requested as `none` and never evaluated). The ceremony runs on the server's own `GET /passkey` page (script `/passkey.js`, CSP `script-src 'self'`), and the relying party ID is the request host (`PASSKEY_RP_ID` overrides it).
  - Registration: `POST /api/auth/passkeys/ticket` (session) → `{ticket}` (10 min). The page then calls `register/options {ticket}` → creation options (discoverable credential required, exclude list) and `register/verify {ticket,challenge,credential,label?}`. The checks cover type, single-use challenge, origin, RP ID hash, user presence and credential ID, and the key must import. A successful registration ends all tickets of the account.
  - Sign-in: `login/options {handoff?,email?}` → request options. Without an email, browsers offer the site's discoverable passkeys. With an email, the account's credential IDs are listed; Electron windows need this because they have no passkey chooser. This reveals whether an email has passkeys. `login/verify {challenge,credential}` checks the signature over `authData‖SHA-256(clientData)`, the user handle and a counter that must advance (cloned authenticator).
  - Handoff for other origins: `POST /api/auth/handoff` → `{id,secret}`. The page signs in for that `id`, and the desktop polls `POST /api/auth/handoff/claim {id,secret}`, which returns 202 while pending and `{session,account}` once (single use, 10 min).
  - `GET /api/me/passkeys` lists the account's passkeys and `DELETE /api/me/passkeys/:id` removes one.
- `GET /api/profiles/:handle` returns the public JSON profile (`handle`, `displayName`, `avatarUrl`, `publications`; never the email). `GET /u/:handle` returns the server-rendered profile page. It is escaped, runs no script, and sends a strict CSP.
- `GET /api/dev/outbox?to=<email>` works only when `EMAIL_PROVIDER=outbox` and returns the stored messages. It exists for local development and tests.

Published apps (session required; the app owner only):

- `POST /api/apps` `{name,title?}` → `{app}` (idempotent per account). `GET /api/apps` lists the account's apps. `GET /api/apps/:id` → `{app,versions}`.
- `POST /api/apps/:id/versions` → `{version}`. `PUT /api/apps/:id/versions/:v/files/<path>` uploads raw bytes (25 MB per file, 3000 files and 100 MB per version, 20 sealed versions). Paths are relative; `..`, absolute paths, backslashes and control characters are rejected.
- `POST /api/apps/:id/versions/:v/finalize` `{files:[{path,size,sha256}],activate?}` checks every file against the manifest, requires `index.html`, drops stray uploads, seals the version and (by default) makes it live → `{version,files,bytes,url,versionUrl,app}`.
- `POST /api/apps/:id/activate` `{version}` rolls back or forward. `DELETE /api/apps/:id/versions/:v` deletes a version (the live one is refused). `DELETE /api/apps/:id/publish` unpublishes the app and removes it from the profile while keeping its versions.
- `GET /apps/<handle>/<name>/…` serves the live version, and `GET /apps/<handle>/<name>@<v>/…` serves a pinned version (cached as immutable). Content types follow the file extension. Directory paths resolve to `index.html`, and extension-less paths fall back to the root `index.html` for client-side routes. Responses carry an ETag and `x-verynize-app-version`. HTML gets a `<base href>` for the app root.

Apps are served with `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads`. They therefore run with an opaque origin and cannot read the editor's storage or call the API with its credentials. Assets carry `Access-Control-Allow-Origin: *` so that module scripts load. As a consequence, apps cannot use `localStorage` or cookies. Full origin isolation needs a separate apps domain, which needs a live domain.

The desktop publisher (`desktop/app-publish.cjs`) runs the project's own `build` script and gives Vite/Vite+ builds a relative base. It finds `dist`, `build`, `out` or `public` (or `package.json` `verynize.outputDir`), hashes the files and uploads them four at a time.

## Better Auth on D1 (`cloud/auth.js`)

Email + password accounts and organizations run on [Better Auth](https://better-auth.com) with the `DB` D1 binding. The schema lives in `cloud/migrations/*.sql`; `node scripts/auth-schema.mjs` prints the SQL for the current options, which is the starting point for a new migration after changing plugins or fields. The desktop signs in with email + password (Share › Account: Sign in, Create account, Forgot password). Profiles, the room index, publications and apps are in D1 (below); passkeys keep their own `vs_…` sessions.

- Every Better Auth endpoint is served under `/api/auth/*`, after the legacy account routes (their paths do not overlap). The main ones are `POST sign-up/email {email,password,name}`, `POST sign-in/email {email,password}`, `GET get-session`, `POST sign-out`, `POST request-password-reset {email,redirectTo}`, `POST reset-password {token,newPassword}`, `GET verify-email?token=…` and `POST send-verification-email`, plus the organization plugin under `organization/*` (`create`, `list`, `get-full-organization`, `invite-member`, `accept-invitation`, `update-member-role`, `remove-member`, …).
- Passwords are 10–128 characters and hashed with Better Auth's default scrypt. Email verification is required before sign-in. A password reset revokes every session of the account. Reset, verification and organization invitation emails go through `cloud/mail.js` (invitation links are `<origin>/#invitation=<id>`).
- Sessions last 30 days and travel only as bearer tokens: sign-in returns the token in the body and in the `set-auth-token` response header, and clients send `Authorization: Bearer <token>`. The Worker drops request `Cookie` and response `Set-Cookie` headers, so there are no ambient credentials, and Better Auth's cookie CSRF check is disabled (it refuses the `Origin: null` sent by the desktop's `file://` renderer). Redirect and callback URLs are still validated against trusted origins. Responses carry the desktop CORS headers and expose `set-auth-token`.
- `sign-up/email`, `sign-in/email`, `request-password-reset`, `reset-password`, `send-verification-email` and `change-password` are limited by `AUTH_LIMIT` per IP and endpoint. Better Auth's own limiter is off because it keeps state in isolate memory.
- **Bridge to directory accounts.** Every API that takes a session (`X-Verynize-Session`, `Authorization: Bearer` or the socket's `?session=`) accepts either a legacy `vs_…` session or a Better Auth token. A Better Auth user acts through the directory account with the same email (`linkVerifiedAccount`): it is created when missing (display name from the sign-up name), and an account made earlier by a magic link or an email invitation is linked and marked verified. This is safe because Better Auth only signs in verified addresses and does not allow email changes. Room roles, invitations by email, profiles, passkey registration and apps therefore work unchanged.
- `POST /api/auth/signout` ends the Better Auth session it is called with (or the legacy session). `POST /api/auth/signout-all` revokes every Better Auth session of the user and every directory session of the linked account. `GET /api/me` counts both.
- Emailed links land on Worker pages (`cloud/account-pages.js`). Clients pass `callbackURL: "/account/verified"` to sign-up and sign-in, and `redirectTo: "/account/reset-password"` to `request-password-reset`. `/account/verified` runs no script. `/account/reset-password` loads only `/account/reset-password.js` (CSP `script-src 'self'`), which drops the token from the address bar and posts `reset-password`. An unverified sign-in (403 `EMAIL_NOT_VERIFIED`) emails a fresh verification link.
- The legacy magic-link routes (`/api/auth/start`, `/api/auth/verify`) remain for older desktop builds; the current desktop no longer offers them.
- `BETTER_AUTH_SECRET` signs tokens. `AUTH_URL` (optional) overrides the origin used in emailed links, which otherwise is the request origin.

## Account directory in D1 (`cloud/profiles.js`)

Migration `0003_directory.sql` adds `profile`, `room_membership`, `publication`, `app` and `migration_state`. Account ids are the former `AccountDirectory` ids, so room members, live sockets and app versions keep their references.

- A **profile** is the public account: email, handle, display name, avatar and `verified`. `userId` links it to its Better Auth user. Better Auth sessions resolve through that link, or on first use through the verified email, which also links profiles made earlier by a magic link, a passkey or an invitation. Legacy `vs_…` sessions resolve to an account id in `AccountDirectory`, then to its D1 profile.
- Magic links (`/api/auth/start`, `/api/auth/verify`) still work for older desktop builds. The link is consumed in `AccountDirectory`, the profile is created or found in D1, and the session is issued for its id. Creating a passkey ticket and editing a profile refresh the account's mirror in `AccountDirectory`.
- **One-time copy.** The first request to `/api/*`, `/u/*` or `/apps/*` after the upgrade copies `accounts`, `memberships`, `publications` and `apps` from `AccountDirectory` into D1 (`migrateDirectory`). Progress is recorded in `migration_state` (`running`, `done` or `failed`; a run stuck for 5 minutes is taken over), and each isolate checks it once. The copy is idempotent:
  - an email that already has a D1 profile keeps it, and the old account's rows are mapped onto it;
  - a handle that is already taken is replaced by a free one;
  - re-running adds nothing.

  The old tables stay in `AccountDirectory`, unused.
- **Adopting old rooms.** The first email + password sign-in of an account that existed before moves the rooms it owns that are not in any organization into the user's personal organization.

## Organizations and room access (`cloud/orgs.js`)

Rooms created by an email + password user belong to a Better Auth organization, recorded in the D1 `room` table (`cloud/migrations/0002_rooms.sql`). The document stays in the room's Durable Object. Rooms created with a legacy session, or without signing in, stay outside organizations until an owner moves them.

- **Personal organization.** Each user has one, created on first use (`GET /api/me` returns `personalOrganizationId`; `POST /api/rooms` without `organizationId` uses it). Its slug is `personal-<user id>`, and its metadata carries `personal: true`. Other organizations cannot use that slug prefix or set the marker, and metadata updates keep the marker as it is.
- **Room role from the organization.** Owners and admins of the organization become room owners. Members get the organization's `metadata.roomRole` (`viewer`, `commenter` or `editor`; the default is `editor`). A request's role is the highest of its capability link, its direct room membership and its organization role. The router computes the organization role from D1 and forwards it as `x-verynize-org-role`; a client-sent header of that name is dropped.
- **Live changes.** Adding a member, accepting an invitation, removing a member, changing a member role, changing `roomRole` and leaving the organization all update the live sockets of the affected rooms (`DesignRoom.applyOrgRoles`). The update sends `role` messages, or `revoked` followed by a close with code 4401.
- `POST /api/rooms {document, organizationId?}` creates the room in an organization the caller belongs to (403 otherwise; 401 for legacy sessions). The response includes `organizationId`.
- `PUT /api/rooms/:id/organization {organizationId}` moves a room. The caller must be a room owner and a member of the target organization. It also attaches legacy rooms to an organization.
- `GET /api/orgs/:id/rooms` (members) → `{role, rooms:[{id,title,createdAt,updatedAt}]}`. `GET /api/me/rooms` merges direct memberships with organization rooms (`organizationId`, `organizationName`), keeping the higher role. `GET /api/rooms/:id/access` adds `organization {id,name}`.
- An organization that still has rooms cannot be deleted (409). Titles listed from D1 follow the room's title whenever a room response reports it.
- Better Auth endpoints also accept the session in `X-Verynize-Session`, so the desktop sends one header everywhere.
- **Desktop UI (phase 3).** Files › workspace switcher lists the account's organizations (personal first), creates organizations and opens Settings › Members. Settings › Members handles invitations, roles, the default member room access (`metadata.roomRole`), invitations addressed to you, leaving and deleting. Share › People & access shows the room's workspace and lets owners move it. Rooms created from the Share panel go to the active workspace. The first-run onboarding signs in or creates the account (default server `https://verynize.gayaloo.app`, changeable) before the agent setup. Tests: `tests/desktop-onboarding.mjs`, `tests/desktop-workspaces.mjs`.

## Email delivery (`cloud/mail.js`)

`EMAIL_PROVIDER` selects the transport. `cloudflare` sends through the `EMAIL` send-email binding from `EMAIL_FROM` (what `cloudflare.config.ts` uses). `outbox` stores messages for `/api/dev/outbox` (tests and local development only). `webhook` POSTs `{to,subject,text}` to `EMAIL_WEBHOOK_URL` with `Bearer EMAIL_WEBHOOK_TOKEN`, so that a relay you operate sends the mail. Any other value disables email sign-in with a 503. The webhook relay needs its own live credential and has not been exercised. Invitation emails are best effort, and a failed delivery never blocks the membership change. Passkeys work without email delivery.

## Security notes

Capability tokens, sign-in links and sessions are random 32-byte values. Only their SHA-256 digests are stored. Room UUIDs alone grant no access. The router drops client-supplied identity headers and forwards only the session-resolved account. WebSocket tokens and sessions travel as query parameters, so do not log complete sensitive URLs. CORS permits capability- and session-bearing desktop requests without cookies.

Rooms created by the previous snapshot-only Worker are migrated in place. Their single token becomes an owner link (`tests/fixtures/cloud-worker-v1.js` is that Worker, kept for the migration test). Snapshot-only clients keep working beside operation clients. The desktop panel falls back to the snapshot protocol, with its conflict prompt, when a server does not report `protocol: 2`.

## Configuration and deployment

`cloudflare.config.ts` enables `nodejs_compat` (Better Auth imports `node:async_hooks`), raises the CPU limit to 30 s per invocation (Workers Paid, for scrypt), and declares the `DB` D1 database, the `BETTER_AUTH_SECRET` secret, the three SQLite Durable Object classes, two rate limits (`ROOM_CREATION`, `AUTH_LIMIT`), the email variables and Worker-first routing for `/api/*`, `/u/*` and `/apps/*`. Vite serves the web static assets. Deploy only through `npm run deploy` (`cf deploy`). This implementation has only been built and tested locally (`npm run deploy:check` is a dry run), not deployed. Before a public deployment, it still needs account quotas beyond the per-account app limit, room deletion and lifecycle, abuse reporting for public profiles and apps, and a dedicated apps origin.

## Tests (local workerd via Miniflare; nothing mocked)

`tests/cloud-harness.mjs` builds the Worker with `vp build` once per test process and runs that bundle (the same one `cf deploy --prebuilt` uploads), and applies `cloud/migrations` to the persisted local D1 database, recording them in `d1_migrations` as `cf d1 migrations apply` does.

- `node tests/cloud-auth-bridge.mjs`: Better Auth sessions acting through directory accounts. Legacy account linking by verified email, new accounts, profiles, room roles and email invitations, socket sessions, passkey tickets, unverified resend, the reset page flow, sign out and sign out everywhere.
- `node tests/cloud-directory-migration.mjs`: the upgrade from the previous `AccountDirectory` (seeded by `tests/fixtures/account-directory-v1.js`) to D1. It checks preserved account ids and legacy sessions, profiles, the room index, publications and apps, email collision mapping, handle replacement, private unverified profiles, a single run across restarts and retries, and the adoption of owned rooms on the first password sign-in.
- `node tests/cloud-orgs.mjs`: personal organizations, rooms in organizations, organization roles granting room roles, the default member role, live role changes and revocation on update, removal and leaving, rejoining, direct and organization roles combined, listings, moving rooms (including legacy ones), a forged role header, reserved slugs and refusal to delete an organization with rooms.
- `node tests/cloud-account-pages.mjs`: the verification landing and the password-reset page in a real Electron browser window (no preload).
- `node tests/cloud-auth.mjs`: Better Auth on D1. Sign-up, required email verification (including a tampered token), password sign-in with bearer tokens and no cookies, sessions, organizations with emailed invitations and acceptance, password reset that revokes sessions, sign-out, per-IP rate limit and restart persistence.
- `node tests/cloud-rooms.mjs`: capability auth, isolation, stale-write 409, WebSocket presence and updates, publication, restart persistence, unpublish, creation rate limit.
- `node tests/cloud-merge.mjs`: the merge engine (round trips, LWW/HLC, text ranges, cycles, orphans, delete/undo, hostile operations, randomized convergence) and the room over WebSockets (concurrent edits, duplicate batches, restart-persistent stamps, future-stamp clamp, legacy snapshot coexistence).
- `node tests/cloud-accounts.mjs`: legacy room migration, magic links, sessions, profiles, member roles, role links, profile publications, rotation with socket revocation, recovery, claiming, member removal, sign-out, persistence, rate limit.
- `node tests/cloud-passkeys.mjs`: passkey ceremonies from a software authenticator written in the test (real ES256 and Ed25519 keys and signatures). It covers ticketed registration, handoff sign-in, email-scoped options, and rejection of a wrong origin, challenge replay, a tampered signature, the wrong ceremony type, another RP ID, counter regression and a mismatched user handle, plus persistence and removal.
- `node tests/cloud-passkeys-desktop.mjs`: Electron with Chromium's CDP virtual authenticator. It registers a passkey from Share › Account, signs out, signs in with the passkey through the handoff, and checks that removal refuses sign-in.
- `node tests/cloud-apps.mjs`: a real project build uploaded and served (content types, base injection, SPA fallback, ETag, versions, pinned URLs, rollback, ownership, path and manifest validation, failed builds, persistence, unpublish).
- `node tests/cloud-desktop.mjs`: two Electron clients (invite join, cursors, sync, reconnect, conflict-free merging of layers, properties and text, local-only undo/redo rebased over remote edits, publication, and the legacy-server conflict prompt).
- `node tests/cloud-files-desktop.mjs`: rooms as files. Create room marks the open file, a restart reconnects it without a copy, the Files home lists workspace and directly shared rooms and joins them once, edits made with the server stopped survive an app restart and reach the room exactly once with the same client id, a second device sees them, and Disconnect detaches the file and clears the outbox.
- `node tests/cloud-accounts-desktop.mjs`: two Electron clients through the Share panel (email + password sign-up, verification and sign-in, profile, email invites, viewer enforcement, live promotion, role links, rotation, comments, recovery, app build/publish/rollback/unpublish, sign out everywhere).
- `tests/cloud-async.cjs` (`npm run test:ux`): stale panel completions never touch a newly selected document.

The installed `cf/config` (`@cloudflare/config`) and Miniflare type definitions determine the beta configuration shape (text/secret bindings, multi-module manifests). Earlier passes consulted Context7 for Durable Object WebSocket hibernation and SQLite patterns.

## Drizzle ORM on D1

`db.js` constructs a request-scoped Drizzle D1 client. `schema.js` maps the eight existing D1 tables (Better Auth plus the organization room index). Better Auth uses its Drizzle adapter with SQLite and interactive transactions disabled for D1. Organization queries use the query builder and parameterized `sql` templates for joins. Durable Object storage remains independent.

Existing SQL migrations in `cloud/migrations` remain authoritative and are applied by `npm run db:migrate`; this adapter change requires no new migration. Auth date fields deliberately use ISO text mappings, preserving the original adapter's stored values in SQLite `date` columns; room timestamps stay epoch milliseconds. Do not regenerate those fields as integer timestamps without a separate data migration.

When changing auth plugins or fields, use `scripts/auth-schema.mjs` as a reference for Better Auth's required SQL, review an incremental SQL migration (never replay the initial CREATE TABLE statements), and update `cloud/schema.js` to match. The generator intentionally uses the native SQLite adapter only for schema discovery. It is not the runtime database adapter. No Drizzle Kit push or remote credentials are needed for this integration.

Validation: `npm run test:cloud` covers old-format session reads/expiry/revocation, new account flows, room permissions, and restart persistence; `npm run deploy:check` validates Worker packaging without uploading.
