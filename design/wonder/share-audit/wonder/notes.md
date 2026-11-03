# Wonder desktop Share audit — 2026-11-02

Capture target: /Applications/Wonder.app. Computer use via agent-desktop accessibility and physical keyboard/mouse; screenshots via `screencapture -x -l 171 -o`. Read CHECKLIST.md and historical `verynize-product/design/wonder/13-share.png` first. Existing scratch file **Sunbird**, Page 1, was already selected; no real files were opened or edited. Existing canvas content was not edited. Thrush and Porto remained background tabs. No browser was operated.

Window already measured 1440 × 870 at screen origin (0,30); resizing was unnecessary. All PNGs are native 2880 × 1740, window only, without shadow. No crops or rescaling. CSS coordinates below are relative to window top-left; screen coordinates add 30 to y. Visual geometry/font measurements are estimates from the raster (typically ±2 CSS px); they are not computed CSS. RGB values are actual screenshot pixels and may reflect the display profile. AX exports are supporting evidence; they can include hidden settings pages and duplicated responsive table cells, so the PNG is authoritative for visibility.

## SH1 — entry

Steps: launch/activate Wonder; verify Sunbird; capture header; hover Share. Visible button “Share”; accessible name “Share file”. Owner avatar is next to a chevron, accessible name “Multiplayer tools”; avatar “Adam Abdurrahman”. No second presence avatar. SH1-idle includes a pre-existing focus ring, so it is not a pure unfocused baseline. Hover did not yield a captured tooltip; do not infer no tooltip exists. Pressed/open state is SH2-open.
Measurements: Share about 49 × 24 CSS px at (1379,48), radius ~6; text ~13 px. Avatar ~24 px diameter. Purple base sampled RGB (162,69,211); panel/header (28,28,28).
Verdict: entry and open state observable; tooltip timing not established.

## SH2 — empty panel

Steps: click Share. Exact visible order: “Share”; “Add emails...”; “Viewer”; “Invite”; “New members can access all files in Adam Abdurrahman. Add admins and editors with Pro. Viewers are free.”; “View Pro”; “Manage members”; “File visibility”; “Private”; “Only members can access”; “Copy link”. Input AX label “Emails to invite”; role AX label “Member role”. Empty Invite is enabled, unlike the older reference's dim invite. Autofocus goes to email. No inline list of workspace members in this panel.
Measurements: panel approximately (1044,78,384,260), radius ~16, padding 12; input ~212 × 28, role ~80 × 28, Invite ~54 × 28; gap ~6; copy row ~364 × 24, radius ~6. Text ~13 px, line-height ~16. Visibility avatar ~32 px. Panel (28,28,28), controls (43,43,43), primary text (232,232,232), muted text (130,130,130). See measurements.json for sample method.
Verdict: current UI differs materially from historical 13-share.png (single inline invite row, shorter placeholder, “Manage members”, avatar instead of lock tile).

## SH3 — keyboard and dismissal

Steps: Enter with empty email; later open fresh panel, press Tab seven times, Escape; reopen and click empty canvas at screen (900,180). Enter empty produces “Enter an email address to invite.” The invalid email Enter case is SI1. Focus order: Emails to invite → Member role → Invite → View Pro → Manage members → Private visibility → Copy link → Emails to invite. Thus focus wraps inside popover. Escape closes it and returns focus to Share file; outside click also closes it. SH3-focus-order.json includes stale hidden Back to app focus entries; ignore those when interpreting visible focus. Measurements/colors same as SH2; validation adds a ~16 px text line.
Verdict: empty validation, focus trap, Escape and outside dismissal observed. Enter on a valid email was not used to send (Invite button was used).

## SI1 — email chips and validation

Steps: type `not-an-email`, press Enter. It becomes a removable highlighted chip; exact error “Fix or remove the highlighted address.” AX button “Remove not-an-email”. Remove it. Type authorized address followed by comma: it becomes a removable chip “<owner+alias>@<owner-domain>”. SI1-typed records a clean single chip before sending. The attempted long comma-separated duplicate input was corrupted by synthetic typing during re-render: it produced an extra `ad` chip and leftover suffix. Cleared suffix and removed `ad` before sending. No malformed or additional address was submitted. This attempt is excluded from parity evidence.
Measurements: same 384 px panel, text ~13; chips expand invite area vertically. Colors share SH2 palette; error color not sampled reliably.
Verdict: single-email chip and invalid chip validation observed; reliable multiple-address parsing not established.

## SI2 — roles

Steps: open Member role. Exact ordered menu: “Viewer” (checkmark), “Editor” with “Pro”, “Admin” with “Pro”. Editor and Admin are disabled in AX and visually muted; no descriptions. Did not click upgrade or disabled choices.
Measurements: menu ~176 × 96 CSS px at (1256,147), radius ~12, padding ~6; rows ~29 px; font ~13. Background (28,28,28), disabled text near (130,130,130).
Verdict: free Viewer only; Editor/Admin gated by Pro.

## SI3 — invitation submission

Steps: verify only authorized email chip; click Invite once. During request the chip remove, email field and Invite become disabled; Invite busy. Result toast “Invitation sent”; input clears. SI3-sent captures the busy state, SI3-result the actual success. No member list appears in Share afterwards; Manage members opens Settings.
Measurements: popover same as SH2; toast geometry not measured. Primary purple (162,69,211).
Verdict: invitation actually sent to <owner+alias>@<owner-domain> as Viewer, then canceled during cleanup. Delivery to mailbox was not inspected.

## SI4 — member/invitation rows

Steps: click Manage members; wait for pending row; open the authorized pending row's ellipsis. Row: circular “A” avatar, “Invitation pending”, authorized email (visually truncated), “Viewer”, “Just now”, ellipsis. Exact menu order: “Resend invitation”, “Cancel invitation”. Viewer in pending row is plain text, not role control. Existing member row has a Viewer role dropdown and ellipsis; owner row says “You” and “Owner”. Existing members were not modified, and their action menus were not opened.
Measurements: member table ~704 px wide, header ~36, rows ~48; row avatar ~24 diameter; text ~13. Settings background (26,26,26), overview/header card (34,34,34), borders near (46,46,46).
Verdict: pending-row management observed; accepted member removal/resend behavior not tested.

## SI5 — pending and cleanup

Steps: Settings Members shows pending Viewer row after request. Click Cancel invitation. Dialog: “Cancel invitation”; “Cancel the invitation to <owner+alias>@<owner-domain>? Their invite link will stop working immediately.” Buttons in order “Keep invitation”, “Cancel invitation”. Confirm once. Pending row disappears (SI5-restored); existing two members remain. SI5-cancelled is confirmation-before-action; SI5-revoked is transient busy state, not final proof. SI5-restored is final proof.
Measurements/colors: table as SI4; dialog font ~13, heading ~16; dialog geometry unmeasured.
Verdict: invitation created and revoked successfully. Inbox message, invite URL, and recipient notification not observable in this desktop-only pass.

## SV1 — visibility menu

Steps: open File visibility. Exact ordered items: “Private” / “Only members can access”; “Public” / “Publicly available to everyone”. Private has owner/avatar treatment and selected checkmark; Public has globe treatment. No separate workspace option or per-link role control observed.
Measurements: two-line rows ~48 CSS px; text ~13, secondary ~12–13; same dark palette as SH2; menu geometry not precisely measured.
Verdict: two visibility choices observed.

## SV2 — public and restore

Steps: select Public. Confirmation exact order: “Make this file public?”; “Review what changes before making this file public.”; “Anyone with the link can view in read-only mode.”; “No Wonder sign-in is needed to open.”; “You can make it private again at any time.”; “Cancel”; “Make public”. Confirm. Visibility row changes to “Anyone with the link” / “Publicly available to everyone”; header lock action changes to Make file private. Copy link, then select Private. Confirmation: “Make this file private?”; “Only members of this organization will be able to open it.”; “Existing public links will stop working and anyone currently viewing will lose access.”; “Cancel”; “Make private”. Confirm. SV2-restored shows “Private” / “Only members can access”.
Measurements: Share panel unchanged at ~384 × 260; confirmations font ~13, heading ~16, geometry not measured. Same palette.
Verdict: change works with explicit confirmations in both directions; original **Private restored**. Public browser accessibility is the UI's claim, not independently verified here. Sibling agent must account for restoration: saved Public link is no longer currently public.

## SL1 — copied link

Steps: Copy link in Private early, immediately write raw clipboard to share-link.txt; repeat in Public and label both. Exact feedback “Link copied to clipboard.” with Dismiss control. Button label remains “Copy link”. Both links identical; no query string. Redacted shape:
`https://app.wonder.so/<redacted>/files/<redacted>/branches/main/pages/<redacted>`
Full URLs are only in share-link.txt for sibling handoff. Same 364 × 24 copy row and SH2 colors. Toast geometry unmeasured.
Verdict: HTTPS web link copied successfully; visibility changes do not change URL.

## SL2 / SL3 — browser behavior

No Chrome or Safari use, as instructed. Raw link is available for sibling web capture. Public confirmation describes read-only viewing without sign-in; private confirmation describes organization-only access.
Measurements/colors: not applicable, no browser surface captured.
Verdict: not observable — delegated browser pass required for signed-out/owner/other-account behavior.

## SL4 — browser/deep link affordances

Steps: inspect Share and Sunbird file menu, then hover File submenu. Top menu: “Back to files”, “Command palette ⌘K”, “File”, “Edit”, “View”, “Help”. File submenu: “Rename”, “Make file public”, “Move to trash”. Did not execute file actions. Share offers HTTPS Copy link, not a visible Open in browser button. No wonder:// link or app-required collaboration text was observed on these inspected surfaces. This is not proof such links do not exist elsewhere.
Measurements: menu text ~13, row ~24; dark background matching SH2. Other menu geometry unmeasured.
Verdict: HTTPS link observed; deep-link launch and Open in browser not observable on inspected desktop surfaces.

## SC1 — presence surface

Steps: close Share, open avatar/Multiplayer tools. Exact strings: “Find someone...”, “You’re the only one here.”, “Adam Ab...” (AX full “Adam Abdurrahman”), “(you)”. Owner avatar green status dot. Three unchecked icon controls, AX names: “Hide cursors”, “Appear busy”, “Go invisible”. Left all unchanged.
Measurements: popover ~240 × 122 CSS px at (940,80), radius ~16; search row ~32, avatar ~24; font ~13. Background (28,28,28); green status dot not sampled.
Verdict: single-owner presence/tools observed; simultaneous second session not observable.

## SC2 / SC3 / SC4 — live collaboration and enforcement

No second session driven and no canvas content edits made. Viewer role is offered; Public dialog promises read-only viewing. Private dialog says existing viewers lose access; cancellation dialog says invite links stop immediately. These strings are evidence of intended behavior only. No access-request surface seen.
Measurements/colors: no relevant second-session UI, not applicable.
Verdict: not observable — bidirectional propagation, viewer enforcement, connected-member removal and access requests require sibling/second-account pass.

## SW1 — members and plan

Steps: Manage members from Share opens in-app Settings → Members. Heading “Members”; “Members overview”; cards “Total members” 2, “Billable seats” 1, “Current plan” “Free”. “Manage members”; “Manage workspace members, roles, and invitations.”; visual placeholder “Search members...”, AX “Search members and invitations”; “Invite member”; table “Member”, “Email”, “Role”, “Added” (Actions column has no visible heading). Pending invitations do not increment Total members. Existing members retained.
View Pro opens in-app “Upgrade to Pro” dialog: “For your personal workspace”; checked “Billed yearly”; “Save 20%”; “Pro”; “For designers and teams shipping real work.”; “$16”; “/ month”; “per editor, billed yearly”; “Everything in Free, plus”; “Unlimited AI-generated layers”; “AI image and vector generation”; “Share your running app”; “Full team collaboration”; “First access to code components (coming soon)”; “Priority support”; “Upgrade”. Closed with Close without toggling billing or purchasing. Closing leaves underlying Plan & billing settings: “Current plan: Free”, “Upgrade to Pro”, “$20 / editor / month”, “Upgrade now”. Returned via Back to app.
Measurements: Members content ~704 CSS px wide, sidebar ~256; table metrics SI4. Plan typography ~13 body/~18 heading; modal geometry unmeasured. Settings background (26,26,26), cards (34,34,34), accent (162,69,211).
Verdict: workspace-wide invitations and Free/Pro gating observed; no upgrade, purchase, or billing setting change performed.

## Restoration / handoff

Sunbird visibility restored to Private. Authorized pending invitation canceled and absence verified. Role remains Viewer; no presence toggles or billing switch changed. No existing member changed. Wonder left on Sunbird with menus closed. Raw HTTPS links saved early. No browser touched. DONE indicates screen released.

## Do not use

- Initial WINDOW_NOT_FOUND before `open /Applications/Wonder.app`: startup observation, not app failure.
- SI1-comma.png and its AX JSON: synthetic typing raced chip re-render (extra `ad` chip); not reliable multi-email evidence. Cleaned before Invite.
- SH1-idle.png as an unfocused idle baseline: it includes an existing focus ring.
- SH3-escape.png and SC1-multiplayer.png: captured underlying Plan & billing after closing Pro; not keyboard/presence evidence. Use SH3-dismissed / SH3-outside and SC1-tools instead.
- SW1-members.png predates async invitation-list refresh; use SI5-pending for pending state.
- SI3-sent / SI5-revoked as proof of completion: both are busy states. Use SI3-result / SI5-restored.
- Failed `type` invocation lacking target did not type anything; resulting Enter-empty validation is correctly preserved as SH3-empty-enter.
- AX hidden Settings subtrees and duplicate table cells must not be treated as visible UI.
