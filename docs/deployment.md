# Cloudflare deployment

The application now uses a Worker with SQLite Durable Objects, a room-creation rate limiter, and static web assets. `cloudflare.config.ts` declares the entrypoint and bindings. `vite.config.ts` supplies `web/` through the Cloudflare Vite plugin. No Wrangler configuration is used.

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
npm run db:migrate -- 76210bc4-d4fe-4075-a321-776c2525a828
npm run deploy
```

For a fresh Worker, `cf` requires declared secrets at the initial upload. Create a
private temporary JSON file containing a random `BETTER_AUTH_SECRET`, then run
`npm run deploy -- --secrets-file /path/to/private-secrets.json`. Remove that file
after successful deployment. Subsequent deployments retain the existing secret;
do not rotate it on every deploy. `npx cf d1 list` lists database IDs.

Apply new migrations before deploying code that needs them; `0002_rooms.sql`
(rooms owned by organizations) must be applied before the organization release.
For a local database,
add `--local` (and optionally `--persist-to <dir>`).

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
