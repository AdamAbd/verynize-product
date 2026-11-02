# Wonder: different Chrome profiles / accounts — 2026-11-02

## Verdict
**Yes for one owner editing and other accounts viewing the same file live, entirely through Chrome. No for two editors co-editing on Free: Editor and Admin are disabled Pro roles.** Tested two different Viewer accounts alongside the owner. Paid editor/editor collaboration was not tested or purchased. Presence has an important limitation below: do not claim named Viewer cursors or reciprocal Viewer presence were confirmed.

## Method / identities
Read the two prior share-audit notes and `wonder/share-link.txt`. Used real installed Google Chrome through agent-desktop accessibility and physical keyboard/mouse. Shared preview status reported unavailable; user explicitly requested real Chrome profiles. No headless browser, API calls, source changes, or commits. PNGs captured with `screencapture -x -l <window-id> -o`; native 2880×1740 (1440×870 logical window), no crop or rescale. Browser chrome included. AX sidecars supplement screenshots; some table cell contents are omitted by compact AX, so screenshots are authoritative.

Initially all four allowed profiles showed “Sign in to Wonder.”
- Profile 1, <viewer-google>@gmail.com: Continue with Google → selected that exact Google account → signed in as “Adam Abdurrahman.” Already an existing Viewer (about 23 minutes old), not a membership created by this audit. Preserved it.
- Profile 2, <unused-google>@gmail.com: Google flow showed “Email or phone,” no existing authenticated account chooser. Did not enter credentials or create another Google account.
- Profile 5, <owner-google>@gmail.com: Wonder signed out; no Google sign-in attempted after owner was found elsewhere.
- Profile 25, <second-google>@gmail.com: Google chooser → <second account> → consent for name/profile picture/email → Continue → Wonder “Claim your handle,” accepted suggested `<handle>` → “Get ready to use Wonder” → “Skip for now” (no extension installed). Created this authorized Wonder account.
- Owner: pre-existing Chrome profile displayed “Adam (Arc Migration).” User explicitly authorized read-only identification and using that owner profile. Opened a new window from it, not the Porto tab. Members page labels Adam Abdurrahman “You” / “Owner,” email visibly begins `owner@...`. Did not infer its on-disk profile-directory ID. 00-owner-members.png shows original owner + Profile 1 Viewer, Free, one billable seat.

Window IDs created: 583 (Profile 1), 591 (Profile 2), 599 (Profile 5), 607 (Profile 25), 620 (owner). Existing window 115 (Porto and Settings tabs) was not edited or closed. Existing Wonder desktop session was left untouched; its duplicate owner presence is a confound for avatar counts, not for the two authenticated browser accounts or live-edit observations.

## 1. Private file before invitation
Profile 25, authenticated as <second account>, opened the saved Sunbird link before any invitation. It redirected to `/<workspace>`, showing “Adam Abdurrahman,” “Overview,” “Files,” “Featured,” “No public files yet.” and “Coming soon.” Sunbird canvas did not open. No exact transient access-denied toast was captured; do not invent one.
Evidence: 08-private-before-invite.png / .json. Verdict: private access blocked for the new non-member. Profile 1 was already a member, so it cannot supply a valid before-invite baseline.

## 2. Invitation and in-app acceptance (no email needed)
Owner Sunbird → Share → email `<second-google>@gmail.com`, Viewer → Invite. Verified “Invitation sent” (09-invited.png / .json). Only this address was invited in this audit.
Returned to Profile 25 and navigated to the saved link again. Wonder showed an in-app modal:
- “You have an invitation”
- “Join to work with your team in a shared workspace.”
- “<workspace>”
- “Adam Abdurrahman invited you as Viewer”
- “Decline”, “Join”, “Maybe later”
Clicked Join. Navigated to the saved Sunbird URL again; canvas opened. No mailbox or invitation email link was used. Evidence: 10-in-app-invitation.png, 11-new-viewer-open.png. Owner Members subsequently showed <second account> / <second-google>@gmail.com / Viewer / Just now and Total members 3 (16-three-members.png).
Verdict: invitation acceptance works inside Wonder after navigation; no email required. Did not establish whether the modal would appear in an idle tab without navigation.

## 3. Browser access and live propagation
Owner new window opened Sunbird after cancelling “Open Wonder.app?” with its Always allow checkbox left unchecked. In this owner window the canvas appeared after cancellation; do not claim a Stay in browser click was recorded there. Profile 1 explicitly presented `/open-in-desktop`: Cancel native prompt → “Stay in the browser” → canvas. Profile 25 opened the canvas directly after acceptance. Neither test used desktop editing.

Owner used the Frame tool (`f`) to draw one small white rectangular frame, 88×59 document units at X=1018, Y=-255, in empty space. This is Wonder's rectangular Frame primitive. It appeared in the already-open Profile 1 canvas without reload; layer count increased from ten to eleven (01-existing-viewer.json vs 03-viewer-live.json). Evidence: 02-owner-added-rectangle.png, 03-viewer-live.png. Shift+1 only adjusted the viewer framing. Owner deleted it; eventual Viewer layer count returned to ten (06b-deletion-confirmed.json/png).

Repeated the same single-rectangle test after Profile 25 joined: owner drew one rectangle in the same empty area; already-open Profile 25 received it without reload (11-new-viewer-open.png vs 12-new-viewer-live.png). No simultaneous extra test rectangles were left. Viewer selected the same node as owner; both address bars exposed node ID `<node-id>`. Owner deleted it after testing. Final canvas returned to ten layers (23-final-canvas.json/png).
Verdict: live owner → Viewer additions and deletion confirmed across distinct accounts in different Chrome profiles. No editor/editor or bidirectional edit test.

## 4. Viewer enforcement / selection
Both Viewer toolbars expose “Move” and “Hand,” without owner's Scale/Frame/Shader/Text creation tools. Viewer Share/edit controls are absent. Selecting the new rectangle works and displays a purple selection box and 88×59 dimensions. Pressing Delete, pressing `f`, and dragging the selected test rectangle did not remove/move it or create a frame. No error toast was observed: actions were inert, Move remained selected. Owner inspection still showed X=1018, Y=-255 for the Profile 25 test. Evidence: 04-viewer-edit-blocked.png, 05-viewer-owner-cursor.png (despite filename, this shows local selection, NOT a captured remote cursor), 13-new-viewer-attempt.png/.json.
Verdict: local selection allowed, editing blocked in observed UI interactions. Purple local selection is not proof of remote selection propagation.

## 5. Presence, named cursors, remote selection — limited
Viewers showed owner portrait avatar(s), AX “1 collaborator active in this file,” images “Adam Abdurrahman.” Owner multiplayer menu showed “Adam Abdurrahman,” “(you),” “Follow Adam Abdurrahman”; it did NOT list <second account> or Adam Abdurrahman. “Hide cursors” and “Go invisible” remained unchecked. Evidence: 14-owner-presence.png/.json; 03 and 12 viewer screenshots.
The pre-existing owner desktop session can explain duplicated owner avatars. Two matching owner portraits must not be described as two distinct-account presence avatars. Moving the owner pointer did not yield a captured named remote cursor in the Viewer; no reciprocal Viewer cursor or remote selection was established. This is a limitation of the tested Viewer experience, not a claim about Pro editor collaboration.
Verdict: owner presence indicators visible to Viewers; named Viewer presence/cursors and remote selections not confirmed.

## 6. Two editors without Pro
Owner Share role menu: Viewer available; “Editor Pro” and “Admin Pro” explicitly disabled in AX. Share text: “Add admins and editors with Pro. Viewers are free.” Members: Current plan Free, Billable seats 1. Evidence: 07-roles-pro.png/.json; 00-owner-members.png; 16-three-members.png.
Verdict: no second Editor role available on this Free workspace. No upgrade, payment, or billing change performed. Pro co-editing not tested.

## 7. Public / Incognito
Optional public test skipped. Sunbird remained Private throughout. 15-private-clean-canvas.png shows “Private” / “Only members can access.” No new Public/Incognito claims from this pass; prior notes describe earlier tests separately.

## Cleanup / revocation
Deleted each temporary rectangle as owner before proceeding; final ten-layer count matches baseline. Existing layers were not edited. Removed only <second account> membership: its row ellipsis → “Remove from workspace” → confirmation “Remove member” / “Remove <second account> from this organization? They’ll lose access to its files immediately.” → Remove. 17-remove-confirm.png and 18-members-restored.png show confirmation and original two-member state restored. Existing Profile 1 Viewer membership preserved.
The already-open removed Viewer's canvas remained visible initially (19-revoked.png/.json), and a reload attempt also left it visible (20-revoked-reload.png/.json). Do not assert immediate live ejection. After explicitly navigating away to the workspace profile and then reopening the private file URL, it redirected to the profile with “No public files yet.” (22-revoked-final.png/.json). This verifies fresh-open access denied after removal, not whether previously cached content is purged.
Sunbird stayed Private, no restore confirmation necessary because visibility was never changed. Authorized new <second account> Wonder account remains created, but has no membership in owner's workspace. Profile 1 and Profile 25 remain signed in to Wonder; no logout/account deletion requested.
Closed all five created Chrome windows, kept original window 115 and its tabs. No Thrush/Porto edits, source changes, commits, payments, extension installs, or Always allow selection.

## Evidence cautions
- 06-rectangle-deleted is an immediate, not-yet-propagated capture; use 06b and 23 for completion.
- 05-viewer-owner-cursor does not contain a verified named remote cursor.
- 19/20 filenames mean after revocation, not proof of ejection; they still show canvas.
- 21-revoked-fresh-navigation captures an address-bar autocomplete state; use 22 for the settled result.
- Compact AX hides some member cell contents; use PNGs for member identities.
- Shader colors animate in existing content; changing orange/yellow shader appearances between screenshots are not edits.
