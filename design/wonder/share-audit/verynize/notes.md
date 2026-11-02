# Verynize Share capture notes (2026-11-02)

Captured by `capture.cjs` (second full run, 53 PNGs, 1440×870 CSS @2×, sRGB) at commit 2cdc493 on `feat/share-parity`.
Setup: one local server (`vp dev`, workerd, temp D1/Durable Object state) behind a small CORS-preflight proxy (see H1), two seeded
verified accounts **owner@example.test "Adam Owner"** and **other@example.test "Olive Other"** (`example.test` is undeliverable), desktop A
(owner) and desktop B (second account) in real Electron with temp `--user-data-dir`, and the web build in installed Google Chrome
(Playwright channel `chrome`). No production server, no real profile, no real email. Measurements come from `metrics.json`
(`getBoundingClientRect`, computed styles). Wonder numbers come from `design/wonder/13-share.png` (device px ÷ 2).
`<port>` and invite tokens are redacted.

Re-run: `npm run build:ui && node design/wonder/share-audit/verynize/capture.cjs [--keep] [id-prefix ...]`.

## Bugs observed (most visible first)

| # | Bug | Evidence |
| --- | --- | --- |
| B1 | File-header visibility button keeps the **lock** and aria/tooltip "Private file · Share" / "Private · Share" while the file is a connected room (owner, editor and viewer, desktop and web, every connected state captured). | `SH1-shared-idle.png`, `SC1-presence.png`, `web-SL3-owner-joined.png`; `metrics.json` `elements.lockButton.aria` |
| B2 | Changing a member's role re-sends an invitation email; status "other@example.test is now editor and was emailed an invitation". | `SI4-role-changed.png`; `cloud/worker.js:482-498` |
| B3 | The Share dialog (top 48) covers the Share button (y 47.5–71.5): the popover is not anchored under its trigger, unlike Wonder (top ≈ 77). | `SH2-open.png` |
| B4 | Viewer can use every tool. The added rectangle vanishes again (layers 4 → 4) and the only message ("You are a viewer in this room; your edits are not shared.") is inside the closed Share dialog. No read-only styling (`body.cloud-read-only` is unused). | `SC3-viewer.png`, `SC3-viewer-panel.png` |
| B5 | A member removed while connected is dropped silently: nothing on the canvas, status only inside the dialog. The dialog also keeps the stale "Workspace: Adam Owner's workspace" line after "Your role: Not connected". | `SC4-removed.png`, `SC4-removed-panel.png` |
| B6 | "Add this room to my account" (claim) shows for the signed-in owner who created the room and is already an owner member. | `SH2-open-access.png` |
| B7 | Web invite: the editor opens on the Files home (path `/`) with the dialog over it. The Invite link field is **empty** although the status says "Invite detected. Join invite to load this shared design.". The name is random ("Designer 739"). Join uses a native `confirm("Load this shared design?")`. The token stays in the address bar. Code reading: the hash handler rebinds `#cloud-connect` for the page's life (`web/cloud-panel.js:1946`). | `web-SL2-chrome-owner.png`, `metrics._dialogs` |
| B8 | Member rows: the owner's own row offers **Remove**, and emails wrap mid-word in a ~118 px column ("owner@example.te / st (you)"). | `SI3-members.png` |
| B9 | Dead or contradictory actions: **Unpublish** shown before any publish, **Disconnect** shown when not connected, **Join invite** shown to a connected owner. | `SH2-open.png`, `SH2-open-room.png` |
| B10 | Public snapshot page renders the 1000×700 export at the top-left of a white page with no header, title or branding. In the first run the same page captured blank white. A `404` resource error appears on that page every run (URL not reported to the page's response listener: likely inside the sandboxed iframe or the favicon). | `web-SL3-public-snapshot.png`, `metrics._bugsObserved` |
| H1 | Harness only: `vp dev` answers preflights in Vite's CORS middleware without `Access-Control-Allow-Origin` for `app://verynize`, so desktop sign-in against `vp dev` fails ("blocked by CORS policy"). Deployed Workers run `/api/*` first, so production is not affected. Worked around in `capture.cjs`. | first run log |

Console errors in the final run: two `HTTP 400 POST /api/rooms/<id>/members`, which are the expected server answers to the invalid and the comma-separated email (SI1); the 404 of B10.

---

## SH. Share entry point

### SH1 Share button (SH1-idle, SH1-hover, SH1-lock-tooltip, SH1-avatar-tooltip, SH1-shared-idle, web-SH1-idle)
Steps: fresh profile, editor open, pointer parked. Hover Share 900 ms. Hover the file-header lock. Hover the avatar. After Create room, close the dialog (SH1-shared-idle).
- Share `#cloud-toggle`: text **"Share"**, x 1374.75 y 47.5, **53.25 × 24**, radius 6, padding 0 10, Inter 500 12/16, bg **rgb(162,69,211)**, text rgb(255,255,255). Hover bg rgb(174,85,221). No tooltip, no pressed state; the web is identical.
  Wonder: x 1379–1427, y 48–71 (≈ 49 × 24), bg rgb(153,58,201).
- Left of Share: panel toggle, then the account button (aria "Account: <name>", 50 × 28 at x 1198) with a 24px circle showing **"P"** on a fresh profile, tooltip **"Account"** (65 × 24). Wonder shows a photo avatar + chevron. Verynize shows no collaborator avatars in any state.
- File header (left sidebar): 20 × 20 lock button at x 213 y 49.5, bg rgb(43,43,43), icon rgb(144,144,144), tooltip **"Private · Share"** (106.5 × 28). It stays a lock after sharing (B1). Wonder has a similar lock at the same place.
- Presence: `#cloud-presence` "1 connected" once in a room, 10px Inter, rgb(187,164,250), at x ≈ 1036 y 840 (bottom right of the canvas, left of the zoom).
Verdict: Share button size, place and colour match closely (≈ 4 px wider, purple 9/11/10 lighter). Avatars and presence do not match. The lock state is wrong (B1).

### SH2 Panel open (SH2-open, SH2-open-scrolled, SH2-account-signed-out, SH2-account-signed-in, SH2-open-room, SH2-open-access, web-SH2-open)
Steps: click Share on a fresh signed-out profile (SH2-open). Scroll. Open Account, sign in with email + password. Create room (SH2-open-room). Open People & access (SH2-open-access). The web (web-SH2-open) is the same panel.
- Dialog: x 1104 y 48, **328 × 679** (not in a room) / **328 × 719** (in a room), scrolls when sections open. bg rgb(34,34,34), border 1px rgb(46,46,46), radius 12, padding 16, shadow `0 12px 32px rgba(0,0,0,.4)`, text rgb(212,212,212).
  Wonder: x 1099.5–1427.5 (328 wide), y 77–388.5 (≈ 311 tall), bg rgb(28,28,28), edge rgb(47,47,47).
- Title **"Shared design"** (Inter 500 13/18, rgb(232,232,232)), icon close 24 × 24 (aria "Close"). Wonder: **"Share"**, no close button.
- Not in a room, in order: label "Server URL" + field (294 × 28, bg rgb(43,43,43), radius 6, placeholder "https://your-app.workers.dev", focused on open with a 1px rgb(162,69,211) ring); "Your name" + field ("Designer NNN", placeholder "Designer"); paragraph "Create a private room, then share its invite link with collaborators. Invite links let people edit (or only view); owner access stays with you." (12/18, rgb(144,144,144)); buttons **Create room** (purple, 100 × 28), **Join invite**, **Disconnect** (rgb(43,43,43)); "Invite link" + field (placeholder "Paste a private invite URL to join"); **Copy invite** (full width); status "Not connected" (top rule rgb(40,40,40)); file-size box "File size · 2 KB of 20 MB" (294 × 44, radius 8); collapsed sections **Account**, **People & access**, **Comments**, **Publish app**.
- Account, signed out: Email (placeholder "you@studio.com"), Password ("At least 10 characters"), "Name (for a new account)", **Sign in**, **Create account**, **Forgot password**, **Sign in with a passkey**. Signed in: "Signed in as owner@example.test on localhost:<port>", Handle, Display name, Avatar URL, Save profile, View public profile, Sign out, Sign out everywhere, Passkeys / Add a passkey, Your rooms ("No rooms yet. Rooms you create while signed in appear here."), Refresh rooms.
- In a room (owner): Create room hidden. **Join invite** + **Disconnect**. Invite link field holds `http://localhost:<port>/#room=<uuid>&token=<64 hex>`. **Can edit ▾** (native select, 70.5 × 28, options "Can edit/Can view") + **Copy invite** (217.5 × 28). **Publish snapshot** (164 × 28) + **Unpublish** (124 × 28). Status "Connected · revision 0".
- People & access (owner): "Your role: **Owner**", "Workspace: **Adam Owner's workspace** · members of this workspace reach the room", member rows, "Invite by email" (placeholder "teammate@studio.com"), role select + **Invite**, "Links" (Owner link · Original invite link / Editor link · Editor invite / Viewer link · Viewer invite, each **Revoke**), link-role select (Viewer default) + **Create link**, **Rotate all links**, **Add this room to my account** (B6), **Refresh**.
Verdict: does not match. Same width and a similar dark surface, but a different title, 2.2–2.3× taller, a different structure (server/room controls instead of invite field / members text / visibility / Copy link), and it covers its trigger (B3).

### SH3 Keyboard (SH3-enter-in-field, SH3-escape, SH3-click-outside)
- Focus on open: `#cloud-server` (first field; dialogs.tsx). Tab order: Server URL → Your name → Create room → Join invite → Disconnect → Invite link → Copy invite → Account summary → People & access → Comments → Publish app → Close → wraps to Server URL (`metrics._focusOrder`).
- Enter in the Invite link field with "hello": nothing happens (no submit, status unchanged "Not connected").
- Escape: closes (native dialog), focus returns to `#cloud-toggle` "Share".
- Click outside on the canvas (600, 450): **does not close**. The dialog stays open and focus moves to the dialog itself (the backdrop is transparent).
Verdict: Escape matches a popover. Outside click does not (Wonder's popover is a light-dismiss popover). Enter does not submit.

## SI. Inviting people (desktop owner, signed in, in a room, People & access open)

### SI1 Typing (SI1-typed, SI1-multi, SI1-invalid, SI1-empty)
- Field `#cloud-member-email` 294 × 28, placeholder **"teammate@studio.com"**, plain text (no chips).
- `other@example.test, owner@example.test` + Invite → status **"Enter a valid email address"** (server 400): comma lists are not supported.
- `not-an-email` → **"Enter a valid email address"** (server 400; no client validation, Invite is never disabled).
- Empty → **"Enter an email address to invite"**.
- Feedback only in `#cloud-status` (12px, rgb(144,144,144)), which is above the sections and usually scrolled out of view.
Verdict: does not match (Wonder: a multi-line field "Type comma separated emails to invite", Invite dim until text).

### SI2 Roles (SI2-roles)
- `#cloud-member-role` is a native `<select>` (237 × 28, aria "Role for the invited person"). Options in order: **Editor** (default), **Commenter**, **Viewer**, **Owner**. No descriptions and no plan gating. The open popup is an OS menu, so it is not in the screenshot; the options come from the DOM.
- Invite link select: **Can edit / Can view**. Link select: **Viewer / Commenter / Editor / Owner**.
Verdict: does not match (Wonder: an inline "Viewer ▾" chip, Viewer default, admins/editors Pro-gated).

### SI3 Invite result (SI3-sent, SI3-members)
- Invite other@example.test as Viewer → status **"other@example.test is now viewer and was emailed an invitation"** (local dev email binding; nothing delivered). No toast.
- Members list: `owner@example.test (you)` [Owner ▾] **Remove**; `other@example.test` [Viewer ▾] **Remove**. 294 px wide, emails wrap mid-word (B8).
Verdict: works. The presentation differs from Wonder (no toast, no avatars, no names).

### SI4 Member row (SI4-row, SI4-row-menu, SI4-role-changed)
- Row: email text (wraps), native select 104 × 28 (aria "Role for other@example.test", options **Owner / Editor / Commenter / Viewer**), **Remove** button. No avatar, no display name, no resend.
- Changing to Editor → status "other@example.test is now editor and was emailed an invitation" (B2). The connected member gets the role live (B: "Your role changed to Editor").
Verdict: functional, not Wonder-like.

### SI5 What the invitee gets (SI5-invitee-files)
- Email: the subject would be "You were invited to “<title>” on Verynize" with link `<origin>/#room=<id>` (code; not observable locally).
- In-app: no notification. The room appears on the invitee's **Files** home as a card "Untitled · **Shared with you** · cloud icon · **Viewer**" (B's `GET /api/me/rooms` → `{id, role:'viewer', title:'Untitled'}`). No pending state: the invitee is a member at once (`list-user-invitations` empty, since that list is for organizations).
Verdict: partially observable. No pending invitations exist for room invites.

## SV. File visibility

### SV1 Menu (SV1-menu)
There is no visibility dropdown. The nearest controls are **Publish snapshot** / **Unpublish** (both always visible to editors and owners) and the capability-link list.
Verdict: not observable — Verynize has no file-visibility setting (Private / workspace / anyone with link).

### SV2 Changed (SV2-changed, SV2-restored, web-SL3-public-snapshot)
- Publish snapshot → status **"Published read-only snapshot and listed it on your profile."**, link `http://localhost:<port>/#public=<id>` shown raw in the dialog as an underlined purple link (`--primary-text`, 12/16).
- Opening it anonymously in Chrome: `data-web-auth="public"`, an iframe "Published design" (sandbox "", srcdoc 4322 chars) at 1000×700 with the frozen design, the rest white. No chrome (B10).
- Unpublish → **"Public snapshot removed"** (restored).
Verdict: not equivalent. A frozen public copy is not Wonder's live visibility.

## SL. Links

### SL1 Copy (SL1-copied, SL1-viewer-link)
- Copy invite → status **"Invite copied: people who join can edit"**. Clipboard = field value = `http://localhost:<port>/#room=<uuid>&token=<64 hex>` (an editor capability link; the owner token is never shared). No toast, no label change.
- Can view → a different `token=` (viewer link), reused on later opens.
Verdict: works. The URL is a secret capability link rather than a members-only file link, and the feedback is a status line.

### SL2 Opening the link in Chrome (web-SL2-chrome-signedout, web-SL2-chrome-owner, web-SL2-chrome-other)
- Signed out: sign-in wall: logo, **"Sign in to Verynize"**, "Sign in to open the design you were invited to. Your invite link is kept.", Email, Password, **Sign in**, **Create an account**, **Forgot password?**, "or", **Sign in with a passkey**. The address keeps the fragment.
- Signed in as owner: Files home at `/` with the Share dialog open, status "Invite detected. Join invite to load this shared design.", empty invite field, name "Designer 739" (B7). Join → `confirm("Load this shared design?")` → "Connected · revision 0", role Owner, "2 connected".
- Signed in as the second account: same screen. Join → role **Editor** (the link's role), "3 connected".
- Safari: not observable — Playwright WebKit is not installed on this machine and real Safari was not driven.
Verdict: the sign-in wall exists. The signed-in flow is a manual Join with a native confirm, not a direct open.

### SL3 What the web shows (web-SL3-owner-joined, web-SL3-other-joined, web-SL3-public-snapshot)
The full web editor (same islands as the desktop) after Join. Public links show a bare read-only export. There is no request-access page and no "Open in app" prompt.

### SL4 Deep link (SL4-preference)
`verynize://join?invite=<https invite>` is handled by the desktop (opens Share and clicks Join). Settings › Preferences › Advanced: **"Open Verynize links in the desktop app — Design links open in the app when it's installed."** (toggle, on). The web never offers it, and invite links are `http(s)://…/#room=…`, not `verynize://`.
Verdict: present on the desktop, not surfaced from the web or the Share panel.

## SC. Collaboration

### SC1 Presence (SC1-presence-web, web-SC1-presence, SC1-presence-b, SC1-presence, SC1-presence-b-editor)
- Remote cursor: label **"↖ Olive Other"** / **"↖ Adam Owner"**, 70.5 × 16, bg **rgb(105,83,201)** for everyone, white 12px system-ui, radius 4, padding 3 6. No per-user colour, no remote selection outline, no avatars in the header.
- "N connected" at the bottom right of the canvas (1/2/3 connected seen).
Verdict: basic presence works. No Wonder-style avatars or colours.

### SC2 Edits (SC2-edit-from-web, SC2-edit, SC2-edit-b)
Web → desktop rectangle, desktop B → A text, A → B rectangle all arrived (each waited for up to 10 s; none timed out; status "Synced revision 1…3").
Verdict: works both ways.

### SC3 Viewer (SC3-viewer, SC3-viewer-panel)
B joined via Files › Shared with you as Viewer. Toolbar fully enabled. Rectangle via the app menu was applied and rolled back (layers 4 → 4). Status in the dialog: "You are a viewer in this room; your edits are not shared.". People & access: "Your role: **Viewer**", rows "owner@example.test · Owner", "other@example.test · Viewer (you)" **Leave**, **Refresh**.
Verdict: enforced server- and client-side, but invisible in the UI (B4).

### SC4 Removal while connected (SC4-removed-owner, SC4-removed, SC4-removed-panel)
Owner clicks Remove: owner shows "1 connected". B disconnects with status "Your access to this room was revoked. Local design retained." (dialog only), the design stays as a local file, and the access section is stale (B5). Access requests do not exist.
Verdict: works with silent UX. Access requests: not observable — no such feature.

## SW. Workspace / plan

### SW1 Members (SW1-members)
Settings › Members (workspace group under "Adam Owner · Personal", next to **Share a design**): "Members — Your personal workspace. Rooms you share land here unless you pick a team.", overview cards **Total members 1 / Pending invitations 0 / Workspace Personal**, "Manage members — Manage workspace members, roles, and invitations.", search, **+ Invite member**, table Member / Email / Role / Added ("Adam Owner You · owner@example.test · Owner · 1m ago"), "Room access — Default access for members: What members (not admins) can do in rooms shared in this workspace. Owners and admins can always manage them." [**Can edit ▾**].
Links: no "View Pro", no "Manage" link from Share, no plan or billing page.
Verdict: workspace members exist but are not linked from Share. The plan/Pro concepts are not observable — they do not exist.
