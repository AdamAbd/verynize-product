# Cloudflare deployment

The application now uses a Worker with SQLite Durable Objects, a room-creation rate limiter, and static web assets. `cloudflare.config.ts` declares the entrypoint and bindings. No Wrangler configuration is used. To run the same backend on your own server or in Docker instead, see [self-hosting.md](self-hosting.md); on Vercel, see [deployment-vercel.md](deployment-vercel.md).

The browser app is a TanStack Start app in `web-start/` (see `web-start/README.md`). `vite.config.ts` builds it with the Cloudflare Vite plugin. The Worker entry `web-start/src/server.cloudflare.ts` sends the backend paths (`/api/*`, `/u/*`, `/apps/*`, `/passkey`, `/passkey.js`, `/account/*`) and WebSocket upgrades to `cloud/worker.js`. It re-exports the Durable Object classes, so the Worker name, bindings and Durable Object data are unchanged. Start serves the editor routes as a client-only shell that boots `web/index.html`'s markup and scripts. Static assets are Start's client build plus the files of `web/`, except `web/src`, `web/index.html` and the desktop-only migration page. `npm run build` builds `web/dist/ui.js` first.

### Node

`npm run build:web:node` builds the same app into `dist/web-node` (self-contained, no `node_modules` needed at runtime). `npm run start:web:node` serves it (`PORT`, default 3000; `HOST`, default 127.0.0.1). It forwards the backend paths and their WebSocket upgrades to `VERYNIZE_BACKEND_URL`, for example `http://127.0.0.1:8787` for the Node backend. Without it, those paths answer 502. TLS, compression and process supervision are left to the hosting environment.

## Commands

Use Node.js 22.18 or newer and the lockfile's project-local `cf`:

```sh
npm install
npm test
npm run deploy:check
npm run deploy
```

`deploy:check` builds and validates without uploading. `deploy` requires a configured Cloudflare account and creates the declared bindings. The final dry run validates the asset bundle, `ROOMS` SQLite Durable Object, and `ROOM_CREATION` rate-limit binding.

## Accounts database (D1) and auth secret

Better Auth (`cloud/auth.js`) keeps users, sessions and organizations in the `DB` D1 database, whose schema is in `cloud/migrations`. The Worker needs Workers Paid, because `cloudflare.config.ts` sets `limits.cpuMs` to 30 000 for scrypt password hashing. First deployment:

Production uses `https://verynize.gayaloo.app`, with D1 database `verynize`
(`76210bc4-d4fe-4075-a321-776c2525a828`) pinned in `cloudflare.config.ts`.

```sh
vpr db:migrate
npm run deploy
```

For a fresh Worker, `cf` requires declared secrets at the initial upload. Create a
private temporary JSON file containing a random `BETTER_AUTH_SECRET`, then run
`npm run deploy -- --secrets-file /path/to/private-secrets.json`. Remove that file
after successful deployment. Subsequent deployments retain the existing secret;
do not rotate it on every deploy. `npx cf d1 list` lists database IDs.

Apply new migrations before deploying code that needs them; `0002_rooms.sql`
(rooms owned by organizations) must be applied before the organization release.
`0003_directory.sql` (profiles, room index, publications and apps in D1) must be
applied before deploying the directory release. On the first request after that
deploy, the Worker copies the existing `AccountDirectory` data into these tables once
(see cloud/README.md, "Account directory in D1"); no manual step is needed.
For a local database,
add `--local` (and optionally `--persist-to <dir>`).

### Room assets (R2 bucket and signing secret)

Shared-room images live in the R2 bucket `verynize-assets` (binding `ASSETS_BUCKET`), with metadata in D1 (`cloud/migrations/0004_room_assets.sql`). Upload and read URLs are signed with the `ASSET_SIGNING_SECRET` Worker secret (see cloud/README.md, "Room assets"). Before deploying this release:

1. Apply the migration: `vpr db:migrate` (it applies `0004_room_assets.sql`).
2. Create the bucket, unless `npm run deploy` provisions it from the declared binding: `npx cf r2 buckets create --name verynize-assets` (add `--location-hint` or `--cf-r2-jurisdiction` if needed, and `--dry-run` to check the request first).
3. Provide the secret, generated with `openssl rand -base64 32`. For the next deploy, add `ASSET_SIGNING_SECRET` to the private secrets file and run `npm run deploy -- --secrets-file /path/to/private-secrets.json`, or set it on the existing Worker with `npx cf workers secrets update ASSET_SIGNING_SECRET --worker verynize --text '<value>'` (keep the value out of shell history). Delete the file afterwards.

Do not rotate `ASSET_SIGNING_SECRET`: every image URL stored in room documents depends on it. Without the bucket or the secret, the asset endpoints answer 503 and the desktop keeps images embedded as before. These steps were checked only with `npm run deploy:check`; no bucket or secret was created against a real account.

### Transactional email

Production uses Cloudflare Email Sending through the native `EMAIL` binding.
`EMAIL_FROM` is `mada@gayaloo.app`, and the binding restricts senders to that address.
The `gayaloo.app` sending domain must be onboarded with valid sending DNS records;
Workers Paid is required to send to arbitrary recipients. No webhook URL or token
is needed. The optional webhook transport remains available for other deployments.
Never enable the development `outbox` provider on a public deployment.

`node tests/cloud-email.mjs` checks native sending and failures in local workerd.
Local simulation does not prove delivery to a real inbox.

## Sharing

After deployment, enter the deployed origin in **Share & collaborate**. Private invites store room/token in the URL fragment; REST calls authenticate with bearer tokens. WebSocket upgrade uses a token query parameter. Treat invites as editing credentials. Public URLs address frozen snapshots and do not confer edit access. Unpublish revokes the public snapshot.

Collaboration persists revision-checked document snapshots. It does not perform CRDT merging: concurrent edits require the user's choice, preserving local work until that choice. Rooms support up to 32 connections and roughly 2 MB documents. Local/native documents can be larger; large embedded images may exceed cloud limits.

This is capability sharing, not an account identity or public creator profile system. Tokens cannot yet be rotated/recovered. The native room-creation limiter permits 10 creations per client IP per minute; broader production quotas/account controls remain future work. Cloud hosting does not grant browser access to desktop project files or CLI agents.

## Evidence

Context7 resolved Cloudflare's official Workers SDK and cf documentation; configuration was verified against the installed cf types and dry-run output. Local Miniflare/workerd tests verified authorization, room isolation, restart persistence, conflicts, publication/unpublish and rate limiting. Two Electron clients verified actual REST/WebSocket CORS, joining, cursors, synchronization, reconnect and conflict resolution.

- [Cloud service implementation and API](../cloud/README.md)
- [Cloudflare project configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
- [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

### Migration shortcut

Run `vpr db:migrate` (or `npm run db:migrate`) from the product repository. The wrapper reads `worker.env.DB.id` from `cloudflare.config.ts`; no database ID argument is needed. Forks must configure their own D1 binding before deploying or migrating.

The default target is the cloud database. Use `vpr db:migrate --dry-run` to validate arguments without executing migrations, or `vpr db:migrate --local --persist-to .cloudflare/state` for the local state used by the Vite development server. A dry run does not verify credentials or SQL against the database. `--profile NAME` selects the cf authentication profile; configuration modes and arbitrary database overrides are intentionally not accepted.
