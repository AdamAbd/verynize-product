# Verynize Share: how it works today (2026-11-02, branch feat/share-parity at 2cdc493)

Audit of the code behind the Share feature, for the Wonder parity audit (`../CHECKLIST.md`). Runtime evidence is in
`notes.md` and the PNGs next to this file (captured by `capture.cjs`). Line numbers refer to this commit.

## 1. One legacy dialog, a few React wrappers

Share is one vanilla-JS `<dialog>` built by `web/cloud-panel.js`. React only adds the entry buttons, restyles the dialog
and portals a size meter into it.

| Piece | Where | What it does |
| --- | --- | --- |
| Dialog markup | `web/cloud-panel.js:13-63` | `#cloud-toggle` (legacy button, hidden by the inspector takeover), `dialog#cloud-dialog` titled **"Shared design"**, Server URL, Your name, an intro paragraph, Create room / Join invite / Disconnect, Invite link + `Can edit/Can view` select + Copy invite, Publish snapshot / Unpublish, `#cloud-public`, `#cloud-status`, `#cloud-conflict`, and four `<details>`: **Account**, **People & access**, **Comments**, **Publish app**. `span#cloud-presence` sits outside the dialog. |
| Share button | `web/src/islands/inspector/header.tsx:77-84` | Purple `Share` (`h-6 rounded-md bg-primary px-2.5 text-xs`), takes over `#cloud-toggle` (`inspector/legacy.ts:17`, `openShare()` at `:81` = `legacyClick("cloud-toggle")`). Next to it, `header.tsx:62-75` is the user's own initial + chevron (tooltip "Account", opens Settings › Account). This is not a presence list. |
| File-header lock | `web/src/islands/sidebar/FileHeader.tsx:22-33,72-84` | 20×20 lock/globe button, tooltip "Private · Share" / "Shared · Share settings", opens the same dialog. `isShared()` is read during render from `window.cloudWorkspace.isConnected()`, and nothing re-renders the header when a room connects (see bug B1). |
| Dialog chrome | `web/src/islands/settings/dialogs.tsx:8-77` | aria-label "Share", icon close button, primary styling on Create room, focus on the first field when opened, hides `#cloud-public` while it is empty. |
| Dialog CSS | `web/src/islands/settings/settings.css:236-293` | Fixed at `inset: 48px 8px auto auto`, width 328px, max-height `100vh-56px` with scrolling. `[hidden]` actions are `display:none`. The base look is shared with the other legacy dialogs (`:35-232`). |
| Size meter | `web/src/islands/storage.tsx:1-30` (+ `storage/storage-meter.tsx`) | "File size · 2 KB of 20 MB" box portaled after `#cloud-status`. It warns at 80 % and blocks shares over the limit. |
| Settings entry | `web/src/islands/settings/SettingsScreen.tsx:199-207` | "Share a design" row (`#settings-sharing`) under the workspace in Settings. |
| Settings › Members | `web/src/islands/settings/members.tsx` (`#members-page`, line 244) | Organization (workspace) members, invitations, roles and **Default access for members** (`metadata.roomRole`). It lives in a separate place from per-file sharing. |

## 2. Flow in code

- **Opening** (`cloud-panel.js:1040-1045`): `showModal()`, `renderAccount()`, and when in a room `updateInvite()`. Close: `#cloud-close`
  or native Escape. A click on the transparent backdrop does nothing.
- **Server** (`:192-218`): the web uses its own origin. The desktop fills the field from `desktop.cloudDefaults()`, which is production
  `https://verynize.gayaloo.app` unless `VERYNIZE_CLOUD_SERVER` is set. Automated runs block production.
- **Create room** (`:1046-1079`): `POST /api/rooms {document, organizationId?}`. Embedded binaries are uploaded first
  (`web/cloud-assets.js`). Then `connect()` (`:862`) opens the socket (`openSocket` `:756`). There is no "file is shared"
  step apart from creating a room: a file is either a local file or a room.
- **Invite links** (`web/cloud-invite.js:33-67`, `cloud-panel.js:246-272`): owners never share their owner token. Opening the panel
  issues or reuses a role-limited capability link `POST /api/rooms/:id/tokens {role:'editor'|'viewer', label:'Editor invite'}`, kept in
  `localStorage["verynize.cloud.invites"]`. Its shape is `<server>/#room=<uuid>&token=<64 hex>`. Non-owners share their own link, or the
  token-free `<server>/#room=<uuid>`, which opens only for account members.
- **Copy invite** (`:1118-1138`): `navigator.clipboard`, or on the desktop (clipboard permission denied) select + `execCommand('copy')`.
  The only feedback is the status line "Invite copied: people who join can edit|view".
- **Join** (`:1080-1101`): `parseInvite` needs `#room` and either `token` or a session for that origin. A native
  `confirm("Open this shared design as a separate file?")` appears unless a file for that room already exists.
- **Links opened in a browser** (`:1941-1953`): when the page loads with `#room=…`, it opens the dialog with status
  "Invite detected. Join invite to load this shared design." and **replaces** `#cloud-connect.onclick` with a handler bound to the hash
  room (native `confirm("Load this shared design?")`). The hash (including the token) is never removed from the address bar
  (no `history.replaceState` in the share code).
- **Email invites** (People & access, owner only; `:1347-1358`, `:1377-1382`): `POST /api/rooms/:id/members {email, role}`. Server:
  `cloud/worker.js:482-498` creates or links a profile, adds a direct room member in the Durable Object (`cloud/rooms.js:621`),
  records the room in D1 (`profiles.linkRoom`) and **emails on every call**, re-sends included (`cloud/accounts.js:126-138`,
  subject "You were invited to “<title>” on Verynize", link `<origin>/#room=<id>`). One address per request. The server validates
  it ("Enter a valid email address", `cloud/profiles.js:17`).
- **Member rows** (`renderAccess` `:1261-1304`): for owners, `<email> (you)` + a native role `<select>` (Owner/Editor/Commenter/Viewer)
  + **Remove**. Others see `<email> · <Role>` and **Leave** on their own row. Changing a role calls the same invite endpoint.
- **Links list** (owner): one row per capability link ("Owner link · Original invite link", "Editor link · Editor invite", …) with
  **Revoke**, Create link (role select), **Rotate all links** (`POST /tokens/rotate`, `cloud/rooms.js:663`), and the workspace move
  row (`PUT /api/rooms/:id/organization`).
- **Roles** (`setRole` `:1230-1245`): viewer < commenter < editor < owner. `body.cloud-read-only` is toggled, but **no CSS or code reads it**.
  A viewer's edit is applied locally, then rebuilt away with a status line inside the dialog (`localChange` `:395-401`).
- **Presence** (`drawPeers` `:126-160`, socket `presence` `:801-803`): a `↖ <name>` label per peer cursor (same `#6953c9` for everyone,
  12px system-ui) on the active page, plus `#cloud-presence` "N connected" (10px, bottom right of the canvas,
  `web/cloud-panel.css:18-19`). The name comes from the **Your name** field, which defaults to a random `Designer NNN`, not the account
  name (`:172`). Remote selections and avatars are not shown.
- **Visibility / publish** (`:1139-1187`): no Private / workspace / link visibility setting. "Publish snapshot" freezes a public,
  read-only copy (`POST /api/rooms/:id/publish`, `cloud/rooms.js:602`), shows the raw `#public=<id>.<hex>` URL and lists it on the
  profile. Unpublish (`:612`) revokes it. Access is otherwise decided by capability links + direct members + organization role.
- **Organizations / workspaces** (`cloud/orgs.js`): rooms of email accounts belong to an organization (personal by default). Owners
  and admins are room owners. Members get `metadata.roomRole` (default editor). People & access shows "Workspace: <name> · members of this workspace reach the room".
- **Accounts** (`:1485-1690`, `window.cloudAccount` `:1642`): email + password (Better Auth bearer `set-auth-token`), passkeys,
  profile (handle, display name, avatar URL), sessions, "Your rooms". Organization invitations are separate (Better Auth, Settings › Members).
- **Removal while connected**: the server sends `revoked` and closes with 4401. The client disconnects with status "Your access to this
  room was revoked. Local design retained." (only visible inside the dialog). The local copy stays.
- **Deep links** (`desktop/app-preferences.cjs:1-75`, `web/src/islands/settings/preference-runtime.ts:145-161`):
  `verynize://join?invite=<https invite>` opens the dialog and clicks Join. Preference "Open Verynize links in the desktop app"
  (on by default). Unpackaged builds register only with `VERYNIZE_REGISTER_PROTOCOL=1`. The web app never offers "Open in app".
- **Web sign-in gate** (`web-start/src/routes/_editor.tsx`, `web-start/src/legacy/web-auth.ts`, `web/src/islands/onboarding/web-sign-in.tsx:83`,
  server `cloud/web-access.js:18-50`): signed out, any editor path shows "Sign in to Verynize · Sign in to open the design you were
  invited to. Your invite link is kept.". The fragment survives sign-in. Server rule `ROOM_ACCOUNT_REQUIRED=web`: web-origin room
  requests need a session (401 "Sign in to Verynize first"). The desktop and scripts stay anonymous. `#public=` snapshots stay anonymous.

## 3. Endpoints involved

`cloud/worker.js` routes (`:398` create, `:440` public, `:482` members, `:288` `/api/me/rooms`) → `DesignRoom` (`cloud/rooms.js:520-700`):
`POST /api/rooms`, `GET|PUT /api/rooms/:id`, `GET /api/rooms/:id/socket`, `POST /ops`, `GET /access` (`:620`),
`POST|DELETE /members` (`:621`), `POST /claim` (`:652`), `POST /tokens` (`:658`), `DELETE /tokens/:id`, `POST /tokens/rotate` (`:663`),
`POST|DELETE /publish` (`:602`, `:612`), `GET /api/public/:id`, `GET|POST /comments` (`:679`, `:696`), `PUT /organization`;
accounts `/api/auth/*` (Better Auth, `cloud/auth.js`), `/api/me`, `/api/me/rooms`, `/api/orgs/:id/rooms`; dev only `/api/dev/outbox`.
CORS: `cloud/http.js:3-7` (`*`, OPTIONS handled at `cloud/worker.js:693`).

## 4. Tests covering it

| Test | Covers |
| --- | --- |
| `tests/cloud-desktop.mjs` | Two Electron clients: production blocked, editor invite (owner token private), viewer choice, Copy invite, join, presence + cursors, both-way sync, reconnect, op merge, local undo, publish/unpublish, legacy conflict UI. |
| `tests/cloud-rooms.mjs`, `tests/cloud-merge.mjs` | Room API, tokens, roles, rotation, members, merging. |
| `tests/cloud-web-access.mjs` | `ROOM_ACCOUNT_REQUIRED` web/all/off, sockets, invite links, public snapshots. |
| `tests/web-cloudflare.mjs` | Web sign-in screen keeps the invite fragment, the dialog shows "Invite detected", public snapshot anonymous. |
| `tests/cloud-orgs.mjs`, `tests/desktop-workspaces.mjs` | Organization roles → room roles, Share › People & access workspace display and move, Settings › Members. |
| `tests/cloud-files-desktop.mjs`, `tests/cloud-pages-desktop.mjs` | Room = library file, Files home "Shared with you", outbox, revocation detaches. |
| `tests/cloud-accounts*.mjs`, `tests/cloud-auth*.mjs`, `tests/cloud-passkeys*.mjs` | Accounts, sessions, passkeys. |
| `tests/storage-limits-ux.mjs`, `tests/cloud-assets*.mjs` | Size meter in the Share panel, room assets. |

Not covered by any test: the file-header lock state, the invite email content on role change, keyboard and outside-click behaviour of the
dialog, viewer UX (what a viewer sees when trying to edit), the web "Invite detected" handler after a disconnect.

## 5. Gaps vs the Wonder reference (`design/wonder/13-share.png`)

| Wonder | Verynize today |
| --- | --- |
| Popover titled **Share**, 328 × ~311 px, anchored **below** the Share button (top ≈ 77 px), bg rgb(28,28,28), 1px rgb(47,47,47) edge | Dialog titled **Shared design**, 328 × 679–719 px (it scrolls when sections open), top at 48 px, so it **covers the Share button** (button y 47.5–71.5). bg rgb(34,34,34), 1px rgb(46,46,46), radius 12, shadow `0 12px 32px rgba(0,0,0,.4)`. |
| One multi-line invite field "Type comma separated emails to invite" with an inline **Viewer ▾** role chip and an **Invite** button (dim until text) | Email invite hidden in the collapsed **People & access** section, single email only (comma lists → "Enter a valid email address"), separate native role `<select>` (Editor default; Editor/Commenter/Viewer/Owner), Invite always enabled. Needs sign-in. |
| "New members can access all files in <workspace>. Add admins and editors with Pro. Viewers are free. **View Pro** **Manage**" | "Workspace: <name> · members of this workspace reach the room" (only after expanding People & access). No plan or Pro text, no View Pro, no Manage link from Share. |
| **File visibility**: Private · "Only members can access" ▾ | No visibility model. The closest controls are Publish snapshot / Unpublish (a frozen public copy, not live access) and capability links. |
| **Copy link** (one full-width button) | Invite link text field + `Can edit/Can view` select + **Copy invite**. The link is a capability URL with a 64-hex token, not a members-only file link. |
| Avatar(s) next to Share | Own initial only (letter "P" on a fresh profile). Collaborators appear only as cursor labels and "N connected". |
| — | Extra controls Wonder does not have in Share: Server URL, Your name, Create room / Join invite / Disconnect, Publish snapshot / Unpublish, Account (sign in, profile, passkeys, rooms), Links (revoke, create, rotate), Comments, Publish app, file size meter. |

## 6. Bugs found (details and evidence in notes.md)

- **B1** File-header visibility button stays "Private file · Share" (lock icon) while the file is a connected room, on desktop and web, in every captured connected state (metrics `lockButton.aria`).
- **B2** Changing a member's role re-sends the invitation email ("other@example.test is now editor and was emailed an invitation"): the role select calls `POST /members`, which always calls `notifyInvite` (`cloud/worker.js:492`).
- **B3** The Share dialog opens over its own Share button (top 48 px vs button 47.5–71.5 px), so the button cannot toggle it closed and the popover does not read as anchored.
- **B4** A viewer can still use every tool. An added layer disappears again, and the only explanation ("You are a viewer in this room; your edits are not shared.") is in the closed Share dialog's status line. `body.cloud-read-only` has no styling or behaviour.
- **B5** A removed member is disconnected silently: the canvas shows nothing, and only the Share dialog status says "Your access to this room was revoked. Local design retained.".
- **B6** "Add this room to my account" (claim) is offered to the owner who created the room while signed in, even though they are already listed as an owner member.
- **B7** Opening an invite in the web app: the editor boots on the Files home (path `/`), the invite field is empty although the status says "Invite detected", the name is a random "Designer NNN", and joining uses a native `confirm()`. The hash handler permanently rebinds `#cloud-connect` for that page load (`cloud-panel.js:1946`), so a different pasted invite is ignored afterwards (code reading). The token stays in the address bar and history.
- **B8** Owner rows let the owner pick "Remove" on themselves, and the email wraps mid-word ("owner@example.te / st (you)") in the ~118 px email column.
- **B9** The "Unpublish" button shows before anything has been published, and "Join invite"/"Disconnect" show in states where they do nothing (Disconnect when not connected, Join invite while connected as owner).
- **H1 (harness only)** `vp dev` answers CORS preflights in Vite's middleware, so a desktop client cannot use a `vp dev` server (sign-in failed with a CORS error). Deployed Workers run `/api/*` first, so production is not affected. `capture.cjs` works around it with a local preflight proxy.
