# Vercel deployment

The collaboration backend can run on Vercel Functions (Node.js runtime, Fluid compute) with the static web app on Vercel's CDN. It runs the same code as Cloudflare (`cloud/worker.js`) and the Node server ([self-hosting.md](self-hosting.md)). Function instances share nothing, so state lives in three external services and a coordinator keeps each room single-writer across instances. The runtime layer is described in [cloud/platform/README.md](../cloud/platform/README.md). Cloudflare deployment is unchanged ([deployment.md](deployment.md)).

Status: built and tested locally against several instances (below). It has not been deployed to Vercel, and the platform limits quoted here come from Vercel's documentation, not from measurements.

## What gets deployed

| Piece                     | Where                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/server.mjs`          | One Vercel Function (`export default { fetch }`). `vercel.json` rewrites `/api/*`, `/u/*`, `/apps/*`, `/account/*`, `/passkey` and `/passkey.js` to it, room WebSockets included (`upgradeWebSocket` from `@vercel/functions` ≥ 3.10). The original path travels as `?__vz_path=` and is restored before the Worker sees the request. |
| `dist/vercel-web`         | The static web app: `web/` without `web/src`, after `build:ui` (`scripts/vercel-build.mjs`). Other paths that are not files fall back to `index.html` (the SPA).                                                                                                                                                                      |
| `cloud/platform/vercel/*` | The bindings: `libsql-d1.js` (accounts database), `actor-store.js` + `actors.js` (rooms, the account directory and published apps), `redis.js` (leases, fan-out, rate limits), `env.js`, `handler.js`, `local-server.js` (local stand-in).                                                                                            |

### External services (all required)

| Service                             | Used for                                                                                                                                                    | Notes                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **libSQL** (Turso)                  | `env.DB` (Better Auth, organizations, profiles, asset metadata; `cloud/migrations`, applied at start-up) and the storage of every actor (`actor_*` tables). | HTTP (`libsql://` or `https://` URL + token). One database for both by default.                                                                                                                |
| **Redis** 6.2+ over TCP             | Room leases and fencing tokens, the live-socket registry, per-instance delivery channels (pub/sub), instance heartbeats, rate-limit counters.               | Needs `EVAL`, `MULTI` and `SUBSCRIBE` on a non-cluster endpoint (the lease script touches keys of several slots). Redis Cloud or Upstash from the Vercel Marketplace, or self-hosted.          |
| **S3-compatible storage**           | Room images (`ASSETS_BUCKET`).                                                                                                                              | R2, S3, B2, MinIO (path-style). Vercel Blob is not implemented: it would need its own adapter for private reads, and R2/S3 already work through `S3BlobStore`. Without it, uploads answer 503. |
| **Email** (SMTP relay or a webhook) | Sign-in links, verification and invites (`cloud/mail.js`).                                                                                                  | Port 587/465 SMTP, or `EMAIL_PROVIDER=webhook` for an HTTP mail API.                                                                                                                           |

## Environment variables

| Variable                                                                                                                 | Meaning                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                                                                                    | libSQL database (`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, as set by the Turso integration, also work). Required.                                                                        |
| `REDIS_URL`                                                                                                              | `redis://` or `rediss://` URL (`KV_URL` also works). Required.                                                                                                                          |
| `BETTER_AUTH_SECRET`                                                                                                     | Required, 32+ random bytes. Keep it stable.                                                                                                                                             |
| `ASSET_SIGNING_SECRET`                                                                                                   | Signs room image URLs; keep it stable.                                                                                                                                                  |
| `PUBLIC_URL`                                                                                                             | The public origin (custom domain). Without it the request's own host is used, which differs between preview and production deployments.                                                 |
| `AUTH_URL`, `PASSKEY_RP_ID`                                                                                              | Optional overrides, as on Cloudflare.                                                                                                                                                   |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN`                                               | As in [self-hosting.md](self-hosting.md). Never use `outbox` on a public deployment.                                                                                                    |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASS`                                    | SMTP relay.                                                                                                                                                                             |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                      | Room images. `S3_BUCKET` switches the binding on.                                                                                                                                       |
| `ROOM_LEASE_MS`                                                                                                          | Lease time-to-live (default 5000). How long a crashed instance can block its rooms; turns renew it every third of it.                                                                   |
| `INSTANCE_ALIVE_MS`                                                                                                      | Heartbeat time-to-live (default 15000). After it, a vanished instance's sockets leave the registry and presence.                                                                        |
| `ROOM_CREATION_LIMIT`, `AUTH_LIMIT`, `MCP_LIMIT`, `AI_LIMIT`                                                             | Requests per minute per key (defaults 10, 10, 240, 20, as on Cloudflare), counted in Redis and shared by all instances.                                                                 |
| `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `VERYNIZE_AI_MODELS`, `VERYNIZE_AI_MAX_TURNS`, `VERYNIZE_AI_MAX_TOOL_CALLS` | Model API runtime ([ai-runtime.md](ai-runtime.md)); off without `OPENROUTER_API_KEY`. A run lives inside one function invocation (`maxDuration` 300 s, `waitUntil` after a disconnect). |

Client addresses for rate limits come from `x-real-ip`, which Vercel sets; whatever the client sent as `CF-Connecting-IP` is replaced.

## Setup (done by the operator; nothing here touches an account automatically)

1. Create the libSQL database and the Redis store (Marketplace integrations set `TURSO_*` and `REDIS_URL`/`KV_URL`), an S3-compatible bucket and a mail relay.
2. Import the repository as a Vercel project. `vercel.json` sets the framework to none, the install command (`npm ci --ignore-scripts`: Electron and native desktop modules are not needed), the build command and the output directory. Set the Node.js version to **24.x** (the actor copies use `node:sqlite`). Fluid compute must stay enabled (the default): it is what lets one instance hold several sockets and turns at once.
3. Add the environment variables above, then deploy. Migrations run on the first request of each new instance; the first instance to record a migration applies it, the others skip it.
4. Optional: `npm run build:vercel` builds the static output locally. Build on Vercel (Git integration or `vercel deploy` without `--prebuilt`): a local `vercel build` on macOS bundles the macOS libSQL binary into the function.

## How rooms stay single-writer

Durable Objects give each room one instance, one thread and storage that commits before replies leave. On Vercel any instance may receive any request, and a WebSocket stays on the instance that accepted it. The coordinator (`cloud/platform/vercel/actors.js`) rebuilds those guarantees.

**A turn.** Each actor event (an HTTP request forwarded by the router, an RPC such as `agentApply`, a socket message or close) runs as a turn on the instance that received it:

1. **Lease.** Take the actor's Redis lease in one Lua script: `SET NX PX` with a fencing token from `INCR`. The same script returns the room's socket registry, minus sockets of instances whose heartbeat expired. Other instances wait (backing off 2–50 ms) and give up after 20 s. Turns of one actor on one instance are queued locally first.
2. **Claim and catch up.** One libSQL write batch sets `actor_heads.fence` to the token (only a newer fence wins) and returns the rows other instances committed since this instance's copy. The copy is an in-memory SQLite database. It is patched, or rebuilt when the schema changed or tombstones were purged, and the actor object is recreated on the new state, as after a Durable Object eviction. A warm copy with nothing new costs no reload.
3. **Run.** The unchanged actor code runs against the copy (`ctx.storage.sql` stays synchronous). Temporary triggers record each changed primary key.
4. **Commit.** One libSQL write batch: the head update (`seq = expected + 1`) and every changed row (`actor_rows`, JSON), each statement conditional on `fence = mine AND seq = expected+1`. If the head did not move (a newer lease claimed the actor, or another commit landed), the whole batch is void and the turn fails with `FencedError`.
5. **Deliver and release.** One Redis `MULTI`: publish the turn's socket messages to each owning instance's channel, update the registry (attachments, accepted and closed sockets), then release the lease with a compare-and-delete. HTTP and RPC results return only after this point.

**Persist before acknowledge.** Results, `ops` acknowledgements and broadcasts leave after the commit (step 4). A turn whose commit fails sends nothing. Its local copy is dropped, and its sockets get close code 1012 and reconnect. The client resends unacknowledged batches; `clients.last_batch` (the room's own dedup) drops any batch whose commit actually landed.

**Fencing.** A holder that stalls past its lease (GC pause, frozen instance, network partition) can resume after another instance claimed the room with a newer token. Its commit then matches no head row and writes nothing. Nothing it computed reaches a client. The libSQL check is the guard; the Redis lease only keeps turns from colliding. Before anyone claims the room again, a late commit from the old holder is still the latest state, which is linearizable. If Redis loses its counters (restart without persistence), a claim finds a stored fence above its own, raises the counter past it and retries.

**Ordering and fan-out.** A socket's sends, its own included, are published to the channel of the instance holding it, inside the `MULTI` that releases the lease. The next turn can only start after that release. Redis therefore writes the messages of successive turns to every subscriber in commit order, and every socket sees revisions in order, each exactly once. Pub/sub is at-most-once: when an instance's subscriber reconnects, the instance closes its sockets (1012) so they resynchronize from `welcome` + `snapshot`.

**Presence, revocation and roles** use the socket registry in Redis: `getWebSockets()`, `serializeAttachment()`, `peers()`. `refreshSockets()` after a token or member change runs in the turn that made the change and closes revoked sockets on whichever instance holds them (`revoked`, then 4401).

**Room code unchanged.** Dedup (`last_batch`), HLC stamps, revision checks on snapshot writes and role checks are `cloud/rooms.js` as on Cloudflare. The only behavioural difference: an actor object is recreated whenever another instance committed in between. The room's server clock then restarts from wall time, as after a Durable Object eviction; clock skew between instances only affects stamps the server assigns to ops that arrive without a usable one.

### Why this design

- **Owner plus forwarding** (one instance owns a room, others forward to it through Redis request/response streams) fits a long-lived server, not Fluid compute. An instance only runs while it has a request in flight and cannot be addressed directly. An owner without an open socket may be suspended, so a forwarded request would wait up to a lease time. Moving the lease to whichever instance has the event costs one claim round trip and needs no forwarding path.
- **Optimistic concurrency on the database alone** would need serializable transactions around `applyBatch`'s reads and writes plus a separate fan-out channel. The lease serializes turns cheaply, and the fenced commit makes a lost lease harmless.
- **Shared rows instead of one database per room.** Every actor's rows sit in two shared tables keyed by actor, table and primary key, and are written incrementally: a turn writes only the rows it changed. A database per room (Turso namespaces) needs the Platform API, a token with database-creation rights and per-account database limits, and would add room-creation latency. Per-room tables would make the schema grow with users. A log of SQLite changesets with snapshots was also considered; a published app (up to 100 MB in 1 MB chunks) would make periodic snapshots too expensive.
- **A stateful room service** (the Node server, `server/node.mjs`, on a VPS, with Vercel proxying room traffic to it) remains the fallback if the lease path proves too slow for busy rooms. It needs a WebSocket proxy in the function and an internal RPC endpoint for `agentApply`/`applyOrgRoles`. It is not implemented here.

## Limits

- **WebSocket lifetime.** Connections close when the function reaches its maximum duration: `maxDuration` is 300 s in `vercel.json` (the Hobby ceiling; Pro allows up to 800). `web/cloud-panel.js` already reconnects after any close, after 0.5 s and then with backoff up to 15 s. It resends unacknowledged batches after `welcome`/`snapshot` (`acked`), so a forced close loses nothing (test 4 below). Presence briefly drops the peer.
- **Latency per turn.** About four round trips to services: Redis lease, libSQL claim, libSQL commit (only if something changed), Redis `MULTI`. Keep Redis and libSQL in the functions' region. Operations of a busy room are serialized across instances, at most one turn per room at a time. `AccountDirectory` is a single actor (`"directory"`) used by sign-in, passkeys and handoffs, so its turns serialize globally.
- **Message and row sizes.** Socket messages up to 8 MiB (`maxPayload`). Room documents are rewritten whole on each batch (one `actor_rows` row). Published-app uploads write up to 25 × 1 MiB chunks (base64 JSON) in one commit. Check your libSQL plan's request and row size limits.
- **Crash recovery time.** A crashed lease holder blocks its rooms for up to `ROOM_LEASE_MS`; its sockets stay in presence for up to `INSTANCE_ALIVE_MS`.
- **Memory.** Each instance keeps copies of the actors it touched (dropped after a minute without sockets or turns).

## Cost notes

- **Functions.** Open WebSockets keep an instance provisioned: memory time is billed for as long as editors are connected, CPU only when turns run. Idle instances also send a heartbeat to Redis every `INSTANCE_ALIVE_MS / 3`.
- **libSQL.** Every turn makes one write request (the claim). Turns that change data make a second one, which writes the head row plus each changed row; a room batch rewrites the document row and its stamps. Turso bills rows read and written: a cold copy reads all of an actor's rows once per instance.
- **Redis.** Per turn: one `EVAL` (lease), a few renewals for long turns, one `MULTI` (publishes, registry, release). Per instance: one subscription. Command-priced plans (Upstash) bill each of these.
- **Blob storage and email** cost the same as on the other runtimes.

## Failure modes

| Failure                                      | Effect                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance crashes mid-turn                    | The lease expires (`ROOM_LEASE_MS`); the next instance claims with a newer fence. Unacknowledged batches are resent by clients and applied once. Its sockets close and reconnect elsewhere.        |
| Instance freezes mid-turn and resumes        | Its commit is fenced (`FencedError`); it sends nothing, drops its copy and closes its sockets with 1012.                                                                                           |
| libSQL unreachable or commit outcome unknown | The turn fails (HTTP 500 / socket close 1012); the copy is dropped; resent batches are deduplicated if the commit landed.                                                                          |
| Redis unreachable                            | No turn can take a lease: room requests fail and sockets reconnect until Redis is back. Committed data is unaffected.                                                                              |
| Redis loses its data                         | Fence counters restart and are raised above the stored fences on first claim; the socket registry is empty, so sockets whose entry vanished are closed (1012) on their next message and reconnect. |
| Subscriber connection drops                  | Messages published meanwhile are lost for that instance; it closes its sockets (1012) so clients resync.                                                                                           |
| `MULTI` fails after a commit                 | The change is durable but its acknowledgements and broadcasts were not sent. The instance closes its sockets; clients reconnect and receive a snapshot that contains it.                           |
| Function reaches max duration                | Socket closes; the client reconnects (see Limits).                                                                                                                                                 |

## Local validation (no Vercel account)

`npm run test:cloud:vercel` runs every `npm run test:cloud` scenario on this runtime and then `tests/cloud-vercel-instances.mjs`. Each scenario gets a throwaway `redis-server` (from `PATH`, or `REDIS_SERVER`) on a random port without persistence, a libSQL database in a `file:` URL shared by the processes (in WAL mode, with a busy timeout), and three function instances, each a separate process on its own port. Requests and sockets go to the instances in turn. Every instance runs `api/server.mjs`'s handler behind `cloud/platform/vercel/local-server.js`, which routes like `vercel.json` and provides Vercel's request context, so `upgradeWebSocket` from `@vercel/functions` runs unmodified. `sqld` was not used; the libSQL HTTP protocol (Hrana) is therefore exercised only in production. Any cloud test runs this way with `CLOUD_RUNTIME=vercel node tests/<file>.mjs`.

`tests/cloud-vercel-instances.mjs` uses four instances (A can be frozen mid-turn by a test hook, D cuts sockets after 2 s like a maximum duration):

1. 85 batches sent at once by sockets on A, B and C and by HTTP `/ops` through D converge. Every socket sees revisions 1…85 exactly once and in order, no batch is applied twice, the four instances return the same document, and replaying the broadcast stream reproduces it.
2. A freezes (`SIGSTOP`) after running a batch and before committing. B takes over and commits; A resumes and its commit is fenced. Its client got no acknowledgement from A, is closed with 1012, reconnects and resends, and the batch is applied once.
3. A is killed (`SIGKILL`) mid-turn: takeover, resend applied once, A's sockets leave presence after its heartbeat expires.
4. A socket cut at the maximum duration reconnects with `acked` = its last batch; no duplicate, no loss.
5. A link created on B and used by a socket on C is revoked through D: the socket receives `revoked` and closes with 4401.
6. Every instance and Redis restart (fence counters lost): state is kept and writes continue.

A local cluster for manual testing: start `redis-server`, then several `npm run start:vercel-local` with the same `REDIS_URL`, `DATABASE_URL=file:/abs/path/verynize.db`, `DATA_DIR` and the secrets, and different `PORT`s. `MAX_DURATION_MS` simulates the function limit.

## Replacing the static serving with TanStack Start

The web app is served here as plain files with an SPA fallback (`scripts/vercel-build.mjs`, the last rewrite in `vercel.json`). When the TanStack Start app replaces `web/`, its Nitro `vercel` preset writes a Build Output API directory (`.vercel/output`: static files plus its own server function). Then `buildCommand`/`outputDirectory` and the SPA rewrite go away, and the backend keeps working one of two ways:

- as a separate Vercel project (for example `api.example.com`) with this `vercel.json` minus the static parts. Clients already take the server origin from configuration (`info.server` in `web/cloud-panel.js`); or
- in the same output, as a Nitro catch-all server route for the backend paths that calls `createHandler(...).fetch(request)` from `cloud/platform/vercel/handler.js`. WebSocket upgrades must then reach `upgradeWebSocket` without Nitro's own WebSocket layer in the way; verify this on a preview deployment before switching.
