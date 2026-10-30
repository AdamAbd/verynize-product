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

`deploy:check` builds and validates without uploading. `deploy` requires a configured Cloudflare account and creates the declared bindings. No deployment was performed during implementation. The final dry run validates the asset bundle, `ROOMS` SQLite Durable Object, and `ROOM_CREATION` rate-limit binding.

## Accounts database (D1) and auth secret

Better Auth (`cloud/auth.js`) keeps users, sessions and organizations in the `DB` D1 database, whose schema is in `cloud/migrations`. The Worker needs Workers Paid, because `cloudflare.config.ts` sets `limits.cpuMs` to 30 000 for scrypt password hashing. First deployment:

```sh
npx cf d1 create --name verynize
npm run db:migrate -- <database-id>
npm run deploy
npx cf workers secrets update BETTER_AUTH_SECRET --worker verynize --text "$(openssl rand -base64 32)"
```

The first command prints the database ID; `npx cf d1 list` shows it again. To pin the binding to that database, add `id` to `bindings.d1({ name: "verynize" })`. Apply new migrations with `npm run db:migrate -- <database-id>` before deploying code that needs them. For a local database, add `--local` (and optionally `--persist-to <dir>`). Until the secret is set, the `/api/auth/*` Better Auth endpoints fail.

## Sharing

After deployment, enter the deployed origin in **Share & collaborate**. Private invites store room/token in the URL fragment; REST calls authenticate with bearer tokens. WebSocket upgrade uses a token query parameter. Treat invites as editing credentials. Public URLs address frozen snapshots and do not confer edit access. Unpublish revokes the public snapshot.

Collaboration persists revision-checked document snapshots. It does not perform CRDT merging: concurrent edits require the user's choice, preserving local work until that choice. Rooms support up to 32 connections and roughly 2 MB documents. Local/native documents can be larger; large embedded images may exceed cloud limits.

This is capability sharing, not an account identity or public creator profile system. Tokens cannot yet be rotated/recovered. The native room-creation limiter permits 10 creations per client IP per minute; broader production quotas/account controls remain future work. Cloud hosting does not grant browser access to desktop project files or CLI agents.

## Evidence

Context7 resolved Cloudflare's official Workers SDK and cf documentation; configuration was verified against the installed cf types and dry-run output. Local Miniflare/workerd tests verified authorization, room isolation, restart persistence, conflicts, publication/unpublish and rate limiting. Two Electron clients verified actual REST/WebSocket CORS, joining, cursors, synchronization, reconnect and conflict resolution.

- [Cloud service implementation and API](../cloud/README.md)
- [Cloudflare project configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
- [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
