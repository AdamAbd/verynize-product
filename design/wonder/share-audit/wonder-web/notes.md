# Wonder web Share audit — 2026-11-02

## Method and scope
Read CHECKLIST.md and the historical 13-share.png before capture. Phase 1 used an isolated agent-browser Chrome session at 1440×870 CSS, deviceScaleFactor 2. Phase 2 began only after wonder/DONE existed. Real Google Chrome and Safari windows measured 1440×870; screenshots use macOS screencapture -o (no shadow), 2880×1740 PNG. Browser chrome is included in native captures, so their content viewport is smaller. Headless captures contain only the viewport. No crops or rescaling. Measurements below are CSS px; Safari estimates are from the 2× raster, not DOM. Raw DOM measurements and sampled RGB frequencies are in the JSON sidecars.

The shared preview tool timed out twice; isolated Chrome was used instead. Safari WebDriver refused a session because “Allow remote automation” is disabled. Safari Apple Events JavaScript is also disabled. Neither setting was changed. Safari was inspected with accessibility and screenshots.

Private and Public entries supplied by the desktop agent were identical:
`https://app.wonder.so/<workspace>/files/<file-uuid>/branches/main/pages/<page-uuid>`.
There was no query capability token. Identifiers are redacted here. The desktop agent restored Private before the web checks; the filename Public is not proof the file was public when opened.

## SL1 — Copy link
Owner Chrome → Stay in the browser → Share → Copy link. Foreground Chrome displayed “Link copied to clipboard.” See chrome-SL1-copied.png. A first scripted click while Chrome was behind Safari displayed “Couldn't copy the link”; do not treat that automation/focus-dependent error as normal product behavior. Copy link is 364×24, 12px text, radius 6; surface RGB approximately (43,43,43).
Verdict: confirmed web copy control and success feedback; supplied private/public URLs have the same shape.

## SL2 — Open links by browser/session
- Headless clean Chrome: opening the supplied link briefly showed “Opening file…”, then the owner's profile with “Overview”, “Files”, “Search…”, “Sign in”, “Share profile”, “No public files yet.” and a transient “You no longer have access to \"Sunbird\"”. chrome-SL2-signedout.png captures the resulting profile. Visibility was being restored around this first check; this is a timing-sensitive observation.
- Real Chrome Incognito, later: stable sign-in wall at `/auth?returnTo=<encoded-file-path>`. chrome-SL2-incognito.png. This is the stronger signed-out baseline.
- Real Chrome existing owner: `/open-in-desktop?returnTo=<encoded-file-path>`, external application prompt, then “Stay in the browser” opens Sunbird in the web canvas. chrome-SL2-owner.png. Owner identity was verified by the Members page marking the owner “You”.
- Real Safari existing authenticated session: `/unsupported-browser?returnTo=<encoded-file-path>` and an external-app permission dialog. chrome-style editor never appeared. safari-SL2-owner-attempt.png includes the dialog; safari-SL2-owner.png captures after cancellation. The session had an avatar, but its identity was not independently verified as owner: filenames describe the intended test, not a verified identity.
- Safari Private Browsing: same unsupported-browser page before any sign-in flow. safari-SL2-signedout.png.
- Second account: `/signup` is reachable in isolated Chrome, with “Create your account”, “Email”, “Password”, “Password requirements”, “Create account”, social providers, and “Sign in”. chrome-SL2-other-signup.png. Registration was not submitted: it requires a password not supplied for the only authorized new account, <owner+alias2>@<owner-domain>. No verification email was requested. Existing unrelated accounts were not signed in or invited by this agent.
Verdict: owner Chrome reaches editor; Chrome Incognito requires sign-in; Safari blocks editor regardless of private/existing session. Second-account collaboration not observable.

## SL3 — Surface classification and exact strings
Chrome auth: “Sign in to Wonder”; “Welcome back. Sign in to continue.”; “Continue with Google”, “Microsoft”, “GitHub”; “Email or username”; placeholder “name@example.com or username”; “Password”; “Forgot password?”; “Sign in”; “New to Wonder? Create an account”; terms/privacy footer. Form width 336; input/button height 32, radius 8; heading 24px, controls 14px. Google button 336 wide; Microsoft/GitHub 164 each with 8px gap. Screenshot sampled background (24,24,24), input (34,34,34), button gray (43,43,43), accent (175,61,218).
Safari: “This browser isn’t supported”; “The Wonder desktop app didn’t open. Open it if it’s installed, or continue with one of the options below.”; “Open in desktop app”; “Download for macOS (Apple Silicon)”; “Download for macOS (Intel)”; “or”; “Get Google Chrome”; “Also supported”; “Microsoft Edge”, “Opera”, “Brave”. No request-access control observed. Private screenshot panel is approximately 512×578, x464/y172; primary button approximately 446×32; heading approximately 28px; decorative purple selection outline and gradient background. Raster accent (162,69,211); panel varies with gradient/compositing, commonly (44,41,41). Do not replace it with a guessed flat fill.
Verdict: Chrome has a full editor surface, not just a read-only preview; Safari presents an unsupported-browser/download handoff.

## SL4 — Desktop handoff
Chrome initially says “Opening in the desktop app...” and later “Opened in the desktop app”. Supporting text: “This design is open in the Wonder desktop app. You can close this tab. Wonder links open there by default; change this in Settings.” Links: “Settings”, “Stay in the browser”. Settings target `/<workspace>/settings/account`. Native Chrome dialog: “Open Wonder.app?”, optional “Always allow app.wonder.so to open links of this type in the associated app”, Cancel / Open Wonder.app. Safari dialog: “Do you want to allow this website to open ‘Wonder.app’?” with Always Allow / Cancel / Allow (private dialog omits Always Allow). Permission dialogs were cancelled; no persistent allow setting was selected. The custom protocol string itself was not extracted.
Verdict: desktop handoff exists, but Chrome explicitly offers a browser continuation. Safari requires desktop or switching browser.

## SH1 / SH2 — Web Share and presence
Chrome editor header has two overlapping portrait avatars and Share. The matching portraits do not prove two distinct users. Share button 49.35×24, 12px text, radius 6. Share popover in chrome-SH2-open.png is approximately 384×260 CSS with about 10px padding, dark surface around RGB (28,28,28). Current web UI differs from historical 13-share.png: compact single-line “Add emails…” input, Viewer and Invite beside it, not the tall textarea shown in the reference. Exact paragraph: “New members can access all files in Adam Abdurrahman. Add admins and editors with Pro. Viewers are free. View Pro · Manage members”. Followed by “File visibility”, “Private”, “Only members can access”, “Copy link”. Input text 13px; Viewer 81.125×28, Invite 53.883×28, radius 6. DOM reports Invite disabled=false while empty; sending was not tested.
Verdict: current Chrome Share surface confirmed; historical screenshot must not override current web evidence.

## SH3
Escape was dispatched while a submenu was open; no complete keyboard/focus-order audit was performed.
Verdict: not observable — full keyboard behavior not established.

## SI1
Empty placeholder “Add emails…” recorded. No email submitted; comma parsing and invalid-email validation not exercised.
Verdict: not observable — populated-field behavior untested.

## SI2
Click Viewer: ordered menu “Viewer”, “Editor” with “Pro”, “Admin” with “Pro”. chrome-SI2-roles.png. Text approximately 13px; menu style follows dark surface and rounded rows. Pro badges alone do not establish exact enforcement/disabled semantics.
Verdict: role labels/order and Pro markings confirmed.

## SI3 / SI4 / SI5
No invitations sent by this agent. Members page exposes an existing owner and existing viewer, with role and Added columns; this is pre-existing state, not evidence of a successful invite in this pass. Email delivery and pending invitation lifecycle not inspected.
Verdict: member listing confirmed; sending, removing, resending, and invitation delivery not observable.

## SV1
Click Private: “Private — Only members can access”, then “Public — Publicly available to everyone”. chrome-SV1-menu.png. Menu 256×95, padding 4, radius 10; rows 248×43, radius 6; text 13px. Visibility trigger 372×47.5.
Verdict: two web visibility choices confirmed.

## SV2
No visibility change made in this pass. Desktop evidence records restoration to Private; the web row showed Private.
Verdict: not observable — web transition/confirmation not tested.

## SC1
Two header avatars visible while desktop and Chrome sessions were open (chrome-SH2-open.png and chrome-SL2-owner.png). No named remote cursor or remote selection was observed. No independent identity mapping of avatars was established.
Verdict: avatar UI visible; distinct-account presence not proven.

## SC2 / SC3 / SC4
No two-account live edit, viewer edit denial, access request, or removal-while-connected test completed. No document edits were made by this agent. Browser editor access demonstrates desktop is not mandatory for owner access in Chrome, but does not prove two-account editing, role enforcement, or propagation.
Verdict: not observable — a verified second session/account test is still required.

## SW1
Share → Manage members opens `/<workspace>/settings/members` in Chrome. chrome-SW1-members.png: “Members overview”, “Total members 2”, “Billable seats 1”, “Current plan Free”; “Manage members”; “Manage workspace members, roles, and invitations.”; “Invite member”; columns Member, Email, Role, Added, Actions. Existing roles Viewer and Owner; owner marked You. Share “View Pro” href is `/<workspace>/settings/billing?upgrade=default`; link recorded only, no purchase flow opened.
Public https://wonder.design/ links Sign in to https://app.wonder.so/ and offers Download for macOS. https://wonder.design/pricing says “Free for one editor”; Pro says “Full team collaboration”. Platform FAQ: “Wonder runs in the browser, and there is a desktop app for macOS (Apple Silicon and Intel) and Windows. Download Wonder →”. chrome-SW1-marketing/pricing/platforms.png. Marketing claims are distinct from tested Safari behavior.
Verdict: web workspace member management and plan links confirmed; no upgrade purchased.

## Do not use
- Do not infer browser support for Safari from the marketing FAQ.
- Do not infer desktop is compulsory from Chrome's default handoff: Stay in the browser works.
- Do not call the second-account signup screenshot an authenticated second-account test.
- Do not call Safari's existing session a verified owner account.
- Do not claim realtime collaboration, viewer enforcement, cursors, or access requests were verified.
- Do not infer Public access from the identical link recorded while desktop toggled visibility.
- Do not treat the initial headless profile redirect as the sole signed-out result; stable Chrome Incognito showed auth.
- Do not use hidden/offscreen elements in measurement sidecars as visible UI.
- Do not interpret automation clipboard failure as normal foreground copy behavior.
- Do not use browser address-bar identifiers or existing member email addresses as reusable public fixtures.

## Cleanup
Closed the isolated headless session, real Chrome Incognito window, Safari Private window, and each normal-browser tab created for this audit. Pre-existing tabs retained. No source code edits, commits, payments, invitations, or system automation settings changes.
