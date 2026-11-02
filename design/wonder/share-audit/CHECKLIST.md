# Share parity audit: capture checklist (2026-11-02)

Shared checklist for the **Share** feature (the Share button at the top right of a file, the Share popover, invites, file visibility, copy link, opening a shared link, and collaboration with a second account). Three capture passes:

- Wonder desktop: the live app (`/Applications/Wonder.app`), saved to `wonder/`.
- Wonder web: Wonder links and pages opened in Google Chrome and Safari, saved to `wonder-web/` (prefix `chrome-` / `safari-`).
- Verynize: the Electron app and the web build, saved to `verynize/` (prefix `web-` for the browser build).

Existing evidence: `design/wonder/13-share.png` (Share popover, Viewer invite, "New members can access all files in …", File visibility Private, Copy link).

Name every screenshot `<id>-<state>.png` with the ids below so the sides pair up by filename. Capture at native 2×, full window (1440×870 CSS) unless a tight crop is clearer; record any crop rectangle.

For every id the notes must give: the steps; exact visible strings (labels, placeholders, tooltips, menu items in order, shortcuts, disabled state); measurements in CSS px (widths, heights, padding, radius, font size); sampled RGB values; and a final line `Verdict: …` or `Verdict: not observable — …`.

## SH. Share entry point
- SH1 The **Share** button in the file header: idle, hover, tooltip, pressed (SH1-idle, SH1-hover). Avatars / presence next to it.
- SH2 Share popover open with nothing typed (SH2-open): title, invite field placeholder, role dropdown, Invite button state, the members/plan text and its links, File visibility row, Copy link.
- SH3 Keyboard: Escape, click outside, focus order, Enter in the field (SH3-*).

## SI. Inviting people
- SI1 Typing one email, several comma separated, an invalid one (SI1-typed, SI1-invalid): chips? validation text?
- SI2 Role dropdown contents and order (SI2-roles): Viewer / Editor / Admin…, disabled/Pro-gated items, descriptions.
- SI3 Invite result: success toast/text, the member list that appears in the popover (SI3-sent, SI3-members). Only invite an address the user owns (<owner>@<owner-domain> variants or the second test account); never invite strangers.
- SI4 Member row: avatar, name, email, role control, remove/resend (SI4-row, SI4-row-menu).
- SI5 Pending invitations and what the invitee receives (email / in-app notification) if observable.

## SV. File visibility
- SV1 Visibility dropdown contents (SV1-menu): Private / workspace / anyone with the link …, icons, descriptions.
- SV2 Changing visibility and the resulting row text (SV2-changed). Restore the original visibility afterwards.

## SL. Links
- SL1 Copy link: feedback (toast/label change), the copied URL format (SL1-copied). Record the URL shape, redact secrets.
- SL2 Opening that link in Chrome while signed out (SL2-chrome-signedout), signed in as the owner (SL2-chrome-owner), and as a second account (SL2-chrome-other). Same in Safari (SL2-safari-*).
- SL3 What the web shows: read-only viewer? full web editor? "open in app" prompt? sign-in wall? request-access page? (SL3-*)
- SL4 Deep link back into the desktop app (`wonder://` or similar) if offered.

## SC. Collaboration
- SC1 Two sessions on the same file (desktop + web, or two accounts): presence avatars, cursors, selection colours, names (SC1-presence).
- SC2 Live edit propagation both ways (SC2-edit).
- SC3 Role enforcement: a viewer cannot edit — what the UI shows (SC3-viewer).
- SC4 Access requests / removing a member while they are connected (SC4-*), only if reachable.

## SW. Workspace/plan context
- SW1 Settings › Members as it relates to sharing (SW1-members); the "View Pro" / "Manage" targets (SW1-links). Do not pay or upgrade.
