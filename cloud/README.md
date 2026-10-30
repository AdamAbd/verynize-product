# Cloud collaboration service

The Worker (`cloud/worker.js`) routes the HTTP API to three kinds of SQLite Durable Objects:

- `DesignRoom` (`cloud/rooms.js`), one per shared room: document, capability links with roles, account members, operation merging, comments, WebSocket presence and frozen public snapshots.
- `AccountDirectory` (`cloud/accounts.js`), a single instance: accounts, magic-link sign-in, hashed sessions, public profiles, the room membership index and the app registry.
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

## Email delivery (`cloud/mail.js`)

`EMAIL_PROVIDER` selects the transport. `outbox` stores messages for `/api/dev/outbox` (tests and local development only). `webhook` POSTs `{to,subject,text}` to `EMAIL_WEBHOOK_URL` with `Bearer EMAIL_WEBHOOK_TOKEN`, so that a relay you operate sends the mail. Any other value disables email sign-in with a 503. `cloudflare.config.ts` sets `webhook` and declares both values as secrets. Real delivery **needs a live credential** and has not been exercised. Invitation emails are best effort, and a failed delivery never blocks the membership change. Passkeys work without email delivery.

## Security notes

Capability tokens, sign-in links and sessions are random 32-byte values. Only their SHA-256 digests are stored. Room UUIDs alone grant no access. The router drops client-supplied identity headers and forwards only the session-resolved account. WebSocket tokens and sessions travel as query parameters, so do not log complete sensitive URLs. CORS permits capability- and session-bearing desktop requests without cookies.

Rooms created by the previous snapshot-only Worker are migrated in place. Their single token becomes an owner link (`tests/fixtures/cloud-worker-v1.js` is that Worker, kept for the migration test). Snapshot-only clients keep working beside operation clients. The desktop panel falls back to the snapshot protocol, with its conflict prompt, when a server does not report `protocol: 2`.

## Configuration and deployment

`cloudflare.config.ts` declares the three SQLite Durable Object classes, two rate limits (`ROOM_CREATION`, `AUTH_LIMIT`), the email variables and Worker-first routing for `/api/*`, `/u/*` and `/apps/*`. Vite serves the web static assets. Deploy only through `npm run deploy` (`cf deploy`). This implementation has only been built and tested locally (`npm run deploy:check` is a dry run), not deployed. Before a public deployment, it still needs account quotas beyond the per-account app limit, room deletion and lifecycle, abuse reporting for public profiles and apps, and a dedicated apps origin.

## Tests (local workerd via Miniflare; nothing mocked)

- `node tests/cloud-rooms.mjs`: capability auth, isolation, stale-write 409, WebSocket presence and updates, publication, restart persistence, unpublish, creation rate limit.
- `node tests/cloud-merge.mjs`: the merge engine (round trips, LWW/HLC, text ranges, cycles, orphans, delete/undo, hostile operations, randomized convergence) and the room over WebSockets (concurrent edits, duplicate batches, restart-persistent stamps, future-stamp clamp, legacy snapshot coexistence).
- `node tests/cloud-accounts.mjs`: legacy room migration, magic links, sessions, profiles, member roles, role links, profile publications, rotation with socket revocation, recovery, claiming, member removal, sign-out, persistence, rate limit.
- `node tests/cloud-passkeys.mjs`: passkey ceremonies from a software authenticator written in the test (real ES256 and Ed25519 keys and signatures). It covers ticketed registration, handoff sign-in, email-scoped options, and rejection of a wrong origin, challenge replay, a tampered signature, the wrong ceremony type, another RP ID, counter regression and a mismatched user handle, plus persistence and removal.
- `node tests/cloud-passkeys-desktop.mjs`: Electron with Chromium's CDP virtual authenticator. It registers a passkey from Share › Account, signs out, signs in with the passkey through the handoff, and checks that removal refuses sign-in.
- `node tests/cloud-apps.mjs`: a real project build uploaded and served (content types, base injection, SPA fallback, ETag, versions, pinned URLs, rollback, ownership, path and manifest validation, failed builds, persistence, unpublish).
- `node tests/cloud-desktop.mjs`: two Electron clients (invite join, cursors, sync, reconnect, conflict-free merging of layers, properties and text, local-only undo/redo rebased over remote edits, publication, and the legacy-server conflict prompt).
- `node tests/cloud-accounts-desktop.mjs`: two Electron clients through the Share panel (sign-in, profile, email invites, viewer enforcement, live promotion, role links, rotation, comments, recovery, app build/publish/rollback/unpublish, sign out everywhere).
- `tests/cloud-async.cjs` (`npm run test:ux`): stale panel completions never touch a newly selected document.

The installed `cf/config` (`@cloudflare/config`) and Miniflare type definitions determine the beta configuration shape (text/secret bindings, multi-module manifests). Earlier passes consulted Context7 for Durable Object WebSocket hibernation and SQLite patterns.
