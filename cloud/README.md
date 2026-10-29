# Cloud collaboration service

The Worker runs one SQLite Durable Object per private room. It accepts generic JSON documents (object or array), up to 2 MB per request. Mutations use a base revision; stale writes return 409 and the current snapshot. This is revision-checked snapshot collaboration, not CRDT merging. The UI must resolve conflicts deliberately.

## API

- `POST /api/rooms` `{document}` → 201 `{id,token,revision:0}`.
- `GET /api/rooms/:id`, Bearer token → `{document,revision}`.
- `PUT /api/rooms/:id`, Bearer token, `{document,baseRevision}` → `{document,revision}` or 409 `{error,document,revision}`.
- `GET /api/rooms/:id/socket?token=...`, WebSocket upgrade → initial `{type:'snapshot',document,revision}`. Send `{type:'update',document,baseRevision}` or `{type:'presence',name,cursor:{x,y},pageId}`. Updates broadcast snapshots. Conflicts reply `{type:'conflict',error,document,revision}`. Presence broadcasts `{type:'presence',peers}`. Names are display labels, not verified identities. Maximum 32 connections per room.
- `POST /api/rooms/:id/publish`, Bearer token → `{publicId,revision}`. Publishes a frozen copy of the latest saved revision. Calling publish again rotates the public link.
- `GET /api/public/:publicId` → `{document,revision}` with no private capability or mutation rights.
- `DELETE /api/rooms/:id/publish`, Bearer token → `{unpublished:true}` and immediately revokes public reads.

Tokens are cryptographically random, hashed before storage, and checked with Workers' timing-safe comparison. Room UUIDs alone grant no access. A private token grants edit and publishing control; share it only with intended collaborators. There is no owner/member distinction or token rotation endpoint. WebSocket tokens are query parameters; do not enable logging of complete sensitive URLs. CORS permits capability-bearing desktop requests without cookies.

SQL snapshots and frozen publications survive runtime restart. Presence uses hibernatable WebSocket attachments. No broad in-memory state is needed. The `cf` typed config declares SQLite storage and API-first routing; Vite retains the web static asset output. Deploy only through `npm run deploy` (`cf deploy`). This implementation has only been built and tested locally, not deployed.

`node tests/cloud-rooms.mjs` exercises real local workerd/SQLite via Miniflare, including a dispose/restart persistence cycle, unauthenticated access denial, cross-room token denial, stale write rejection, WebSocket presence and mutations, frozen snapshots and unpublish. `npm run deploy:check` validates the complete Worker and static asset build.

Room creation is rate limited to 10 requests per 60 seconds per Cloudflare client IP using a native Workers rate-limit binding. This is a local edge limit, not a global account quota. Public-production work still needed: authenticated account quotas, room lifecycle/deletion and recovery, token rotation, and deployment checks. Unauthenticated capability rooms are not a substitute for organization access control.

The desktop cloud panel accepts invite URLs directly, displays connected peer count, reconnects closed WebSockets with bounded exponential delay, and retains dirty local work during conflicts. Users explicitly load the shared copy or replace it with their local copy. Publication waits for pending saves; editable display names and throttled cursor positions appear on collaborators’ active matching pages. A per-connection welcome ID prevents drawing your own cursor.

`node tests/cloud-desktop.mjs` launches two isolated Electron clients against a local Miniflare HTTP server. It verifies file-origin CORS, invite join, named visible cursors/presence, bidirectional changes, server restart/reconnection, retained concurrent-edit conflicts, explicit conflict resolution, and publication revocation.

Documentation retrieved with Context7: Cloudflare Durable Objects WebSocket hibernation and SQLite patterns; Workers SDK Miniflare APIs. Installed `cf/config` and Miniflare types determine the beta configuration shape.
