# Share parity: implementation contract (2026-11-02)

Target: Wonder's current Share flow (`wonder/notes.md`, `wonder/SH2-open.png` etc.; the old `design/wonder/13-share.png` is superseded), with one deliberate difference the user asked for: **collaboration with 2+ accounts works in the desktop app and on the web in every browser (Safari included), with no Pro gate** — Viewer, Editor and Admin are all free, and the web never forces a desktop handoff.

Three parallel workstreams (A server, B share popover, C collaboration UX). They meet only at the contracts below. Put new logic in new modules; keep hooks into the long single-line legacy files (`web/cloud-panel.js`, `web/app.js`) as small as possible.

## 1. HTTP (owned by A)

- `GET /api/rooms/:id/access` (existing) additionally returns
  `visibility: "private" | "public"`, `organization: {id, name} | null`, and `you: {role, canInvite, canChangeVisibility}`.
- `PUT /api/rooms/:id/visibility` body `{visibility: "private"|"public"}` → `{visibility}`. Room owners only (direct owner members, owner token, organization owner/admin). Making a room private immediately disconnects every socket that only had access through public visibility (message `{type:"revoked", reason:"private"}`, close 4401).
- Public rooms: with no token and no session, `GET /api/rooms/:id`, the socket and page loads work as **viewer**, on every origin, regardless of `ROOM_ACCOUNT_REQUIRED`. Viewers never write (ops and snapshot writes rejected as today).
- `POST /api/rooms/:id/share-invitations` body `{emails: string[], role: "viewer"|"editor"|"admin"}` → `{invited: [{email, status: "invited"|"already-member"}], errors: [{email, message}]}`. Invites to the room's **workspace** (organization): accepting gives access to all files in the workspace with that role (viewer/editor → room role viewer/editor; admin → organization admin = room owner). Rooms without an organization fall back to direct room members with the role (admin → owner). Validates every address ("Enter a valid email address"), max 20 per call, dedupes, requires `you.canInvite`. Sends one invitation email per new invitation only.
- `POST /api/rooms/:id/members` changing an existing member's role must not re-send the invitation email (bug B2). The last owner cannot remove themselves (B8).
- Per-member workspace roles viewer / editor / admin are visible and editable in Settings › Members (A owns `web/src/islands/settings/members.tsx`).

## 2. Renderer globals (B and C coordinate through these)

- `window.cloudWorkspace` (existing, `web/cloud-panel.js`) gains: `ensureRoom(): Promise<{server, roomId}>` (creates the room for the current file in the active workspace if it is a local file, signing-in first if needed; returns the existing room otherwise), `access(): Promise<access JSON above>`, `setVisibility(v)`, `invite(emails, role)`, `shareLink(): string` = `<server>/#room=<id>` (never a token), and fires `window` event `verynize:cloud-state` with `detail: {connected, roomId, role, visibility, peers}` whenever any of these change (connect, disconnect, role, visibility, presence). B adds these functions; C consumes `verynize:cloud-state` for presence and read-only.
- Presence peers in `detail.peers`: `[{id, name, avatarUrl, color, self, busy}]`, names from the signed-in account (display name, else email), never the random "Designer NNN" when an account exists.

## 3. UI ownership

- **B (share popover)**: `web/src/islands/share/*` (new), the Share button in `inspector/header.tsx`, the file-header lock in `sidebar/FileHeader.tsx` (B1), File menu entries "Make file public / Make file private", the legacy "Shared design" dialog demoted to Settings › "Share a design" (kept working for existing tests), B3, B6, B9.
- **C (collaboration)**: presence avatars + "Multiplayer tools" popover next to Share in the inspector header (left of the Share button; B leaves a slot `#presence-slot`), per-person cursor colours/names, viewer read-only mode (B4), removal / made-private notice on the canvas (B5), opening links in the web (B7: open the file directly, no `confirm()`, strip the token from the address bar, public rooms open read-only without sign-in, a "You don't have access" screen with sign-in-as-another-account for private rooms), Safari support.
