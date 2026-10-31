# Wonder preview — live reference, 2026-10-31

Documentation-only pass in `feat/preview-parity`. All design mutations were in **Sunbird / Audit**. Thrush and Porto remained existing tabs; neither was opened-and-modified. No app source, account or billing setting was changed. Publish was opened and dismissed, never submitted. The only repository added was `/tmp/preview-sandbox`, initialized and committed as `d54751e` with index.html, about/index.html and bird.svg. Wonder created its own `adamabd/dipper` worktree at `~/wonder/workspaces/preview-sandbox/dipper`. “Dipper” is a worktree/chat name, not another user design file.

## Capability model

Preview is a persistent canvas object tied to a repository/worktree, with a separate full-window **Preview tab** available. Lifecycle observed: no configuration → agent investigation → saved run profile → starting → running, or failed; stopping retains a paused canvas object with the last address. The first start sent **Set up the Preview** to the agent. In the existing **Auto** mode the agent saved `python3 -m http.server 8000` directly, with no setup command. Its expandable card said **Preview setup / Saved by auto mode**. It did not start the server; a second Start preview did. This is an observed alternative to the older static Setup/Run/Port approval-card example, not proof that approval cards have been removed in other modes.

Navigate sends pointer/typing into the app, with a blue outer focus outline. Edit highlights and selects DOM elements, exposes computed layout/typography, and permits direct text editing. A changed heading was staged as **1 change** with **Preview changes / Not in your code yet**. Both scratch worktrees remained git-clean immediately afterward. No automatic source synchronization was observed; no agent request to apply the staged change was sent. A new Preview tab loaded the original heading, while the canvas retained its staged edit. Stop warns that unsaved edits will be lost. Capture of the heading created a native editable **Text** layer to the right of the preview, not a flat image. Other DOM types and full-page capture were not tested.

## Evidence method and measurements

All delivered PNGs are unmodified full-window captures: `screencapture -x -R0,30,1440,870`, **2880×1740 native pixels**, representing **1440×870 CSS px**. Wonder was activated before every capture. Each PNG was inspected; the ten hover captures were also reviewed together through crops of their relevant regions. Coordinates below are screenshot CSS coordinates (add 30 to y for screen input). Geometry/font/radius estimates are optical, generally ±2px; they are not extracted app CSS. Canvas coordinates/dimensions explicitly distinguished from screen pixels. Most frame tests use **55% canvas zoom**; app content and status cards scale with that zoom, while contextual toolbar remains screen-sized.

Common measured palette **C**: panels/toolbars RGB(28,28,28), canvas/fields (43,43,43), selected layer (68,40,83), preview blank/status surface (26,26,26), status card (24,24,24), popover (32,32,32). The rendered sandbox background sampled (244,246,254), not its authored CSS value. `measurements.json` supplies point samples and dominant RGB counts for every PNG. Common geometry **G**: left/right design panels 280px each; inspector fields ≈24px high with ≈6px radius, panel inset12px; UI text mostly ≈12–14px. Purple selection ≈1px, white square corner handles≈8px, bottom dimension badge≈22px high, ≈4px radius, ≈10px below bounds. These C/G references apply to each section that cites them.

## PS1 — Header entry

Steps: add sandbox through Repositories → Add repository → Start from local folder; inspect new Dipper chat attached to Sunbird; open split arrow. Evidence PS1-idle, PS1-menu; later X5-running-menu. Exact idle strings: **Start preview**; introduction **Preview your app on the canvas / See your changes live, next to this chat. / Start preview** (close accessibility label **Don’t show this again**). Idle dropdown order: **Open in a tab ⌘⌥P**; separator; **Preview settings**. Running dropdown adds **Go to preview**, **Open in browser** before the separator. Header running label **Stop preview**, pause glyph/green dot. Investigation uses Start preview with spinner. PS1-hover captured investigation, not a tooltip.

Measurements / RGB: split button≈140×26, arrow segment24wide; dropdown176wide, ≈25px item pitch, ≈12radius, 4px outer inset; C. Chat column500px with repository sidebar hidden; repository sidebar200px when visible.

Verdict: Idle/running split menu confirmed; idle header tooltip not observable in this pass.

## PS2 — First-start configuration

Steps: click Start preview; observe agent for38s; expand Preview setup; open Preview settings via split menu. Evidence PS2-card-final, PS2-edit, X1-settings. Exact order: **Set up the Preview**; **Wondered for 38s**; **Preview setup / Saved by auto mode**; `python3 -m http.server 8000`; **You can change it in Preview settings.** Agent says it saved a run profile from repo root, no setup, and has not started server. Preview settings transcribed under X1. No Setup/Run/Port card or Edit/Save & start action was presented under Auto mode.

Measurements / RGB: chat text≈14px, rows≈25px; config dialog≈992×640 at(224,114), sidebar192wide, radius≈16; fields29high, C. Early PS2-card and PS2-card-verified contain thinking rather than a finished card.

Verdict: Auto saves a proposed profile without review, then requires Start; old static card not confirmed or universally refuted.

## PS3 — Startup

Steps: after normal launch, use controlled `exit 7` run profile and start again to capture brief startup. **PS3-starting-verified** is valid startup of that failing command. Exact: **Starting preview…**; **Starting your app**; **preview-sandbox · App · 0:01**; **Stop**; **Starting app**; `exit 7`; **Waiting for the app**; **Show terminal**. Purple tiled activity icon, yellow breadcrumb status dot. Header during startup shows Stop preview with spinner (PS4-error first attempt). No setup phase because fixture needs none. Running logs under X3; startup log expansion was not captured.

Measurements / RGB: card at55%≈220×115, equivalent400×209 document px; inset≈10screen px, border1scaled; card24/24/24, surrounding26/26/26; C/G.

Verdict: Starting/Stop/timer/progress observed; setup-progress and startup-expanded-logs not observable with this no-setup fixture.

## PS4 — Failure

Steps: Preview settings Start command replaced with `exit 7`, Save; stop prior server using chat header, start. PS4-error-verified. **Preview failed**; **Couldn’t start your app**; **preview-sandbox · App**; **The start command exited before the app was ready.**; **App stopped**; **exit 7 · exit 7**; **Show preview / Not reached**; **View logs**, **Try again**, **Fix with agent**; **Sends the error and available logs to your agent.** Red error icons/text and tab dot. Try again semantics seen through a second start, not the button itself. Fix with agent not invoked. Valid Python run command subsequently restored and successfully launched (PS6-code/show-preview).

Measurements / RGB: centered card≈220×164 at55%, screen x610,y345; C/G; exact red samples in measurements.json. Error frame toolbar lacks Publish/Stop, retaining expand.

Verdict: Non-zero exit is actionable failure with logs, retry, agent fix; busy-port alternative untested.

## PS5 — Paused

Steps: Stop with staged edit → Discard and stop. PS5-paused. **Preview paused**; toolbar **Publish / Start / [expand]**. Center card: **Ready to start your preview**; **preview-sandbox · App**; **Start this preview to connect to your local app.**; **Last address: localhost:8000**; **Start preview**. Gray breadcrumb dot, frame/layer/bounds retained. Reopen-file persistence not independently tested.

Measurements / RGB: card≈220×120 at55%, centered around(720,427), C/G; status surface26/26/26.

Verdict: Stop preserves a restartable canvas frame with last address.

## PS6 — Code workspace

Steps: top-right {} Code control while sandbox running; click **Show preview**. PS6-code, PS6-show-preview. Code layout has repository/chat header, **Stop preview** split button, right **All files** list (about, bird.svg, index.html), **zsh** terminal at scratch worktree. **Your app is running / Open the Preview on the canvas next to this chat. / Show preview**. Show preview returns to Sunbird canvas with same Dipper frame. **Publish to GitHub** also visible but untouched.

Measurements / RGB: repository sidebar200px, right files/terminal area≈384px; chat fills remainder; C, standard26px split button.

Verdict: Shared preview controls exist in Code; Show preview returns to canvas. Stop/start from Code was not isolated successfully, so no independent launch-success claim.

## PF1 — Running selection

Steps: start server, hide chat, select Dipper layer, ⇧2. PF2-toolbar and PS6-show-preview are clear selected evidence; PF1-selected has OS notifications covering right corner. For unselected appearance use X4-more-actions (first attempt) or PM1-toolbar (first attempt): no handles/modes, gray breadcrumb, content remains. Exact **preview-sandbox › Dipper / Local**, green status dot; selected **1512 x 982**. Preview label follows worktree.

Measurements / RGB: at55% body≈827×537 CSS px, screen x306,y158; toolbar≈30px high, rounded top≈8px; G/C. Selected purple vs unselected gray breadcrumb; size badge centered below. PF1-running is selected and clipped by side panels, not unselected evidence.

Verdict: Persistent browser-like layer with repository/worktree breadcrumb, Local badge and standard selection bounds.

## PF2 — Frame browser toolbar

Steps: inspect selected frame; hover each control; click slash. PF2-toolbar, PF2-*-hover, PF2-path-verified. Order: Back, Forward, Reload, path `/`, Publish, Stop, expand. AX Back/Forward disabled initially. Tooltips observed: **Back ⌘[**; **Forward ⌘]**; **Reload / ⇧-click ignores cache**; path **http://localhost:8000/**; **Publish to the web**; **Open in a tab ⌘⌥P**. Stop hover had no tooltip; AX name Stop preview. Slash click becomes a wide dark inline editor with selected slash. Typing /about trial did not navigate; do not claim typed-path success. Link navigation did update path to /about/ (PM2).

Measurements / RGB: toolbar30high at55% fixture view; icon spacing≈23px, Publish≈64×22, Stop≈50×22, expand≈22×22; path grows to fill; tooltip≈24high, ≈6radius,12px text; C/G. Browser toolbar stays legible despite canvas zoom.

Verdict: Browser history/reload/path editor plus publish/stop/tab; path editable state confirmed, submission behavior unresolved.

## PF3 — Expanded preview tab

Steps: expand → wait for new tab; return via top-right **Show on canvas** icon. PF3-expanded-verified. Tab **Dipper · Preview**, green dot. Full-width browser bar; bottom Navigate/Edit/Capture. It is a new internal app tab, not OS fullscreen. Original heading/input state loaded in new tab while canvas retained its staged edit. Show on canvas returns to Sunbird; tab remains available.

Measurements / RGB: top app strip40px; browser bar≈36px; content1440wide; C. Modes toolbar same screen-size as canvas.

Verdict: Expand opens a separate internal Preview tab with return-to-canvas control.

## PF4 — Responsive size

Steps: Screen template dropdown → iPhone17 → restore MacBookPro14. PF4-presets, PF4-resize, PF6-inspector. Exact preset order: **iPhone 17 402 × 874; iPhone 18 Pro 402 × 874; iPhone Air 420 × 912; iPhone 18 Pro Max 440 × 956; iPhone Duo Folded 466 × 678; iPhone Duo Open 626 × 890; iPad Air 11" 820 × 1180; iPad Mini 8.3" 744 × 1133; MacBook Air 1280 × 832; MacBook Pro 14" 1512 × 982; MacBook Pro 16" 1728 × 1117; Desktop 1920 × 1080; TV 3840 × 2160**. This is literal installed-UI text, not a claim about actual devices. Portrait rotate button AX **Rotate to portrait**. iPhone updates W/H and badge402×874, heading wraps; compact toolbar hides text labels. Four corner handles visible; drag resize not independently exercised.

Measurements / RGB: dropdown≈224wide, item24px; at55% phone body≈220×478; C/G.

Verdict: Preset resize changes viewport and reflows app; pointer-handle behavior untested.

## PF5 — Frame context menu

Steps: right-click preview body outside interaction mode. PF5-context. Order: **Copy ⌘C [disabled]; Copy as › [disabled]; Copy link to selection** | **Select layer ›; Paste ⌘V; Paste styles ⌘⌥V; Paste to replace ⌘⇧R; Paste over selection ⌘⇧V; Duplicate ⌘D [disabled]** | **Hide ⌘⇧H; Lock ⌘⇧L** | **Arrange ›; Show terminal; Clear preview data; Clear preview data (including logins)** | **Layout ›** | **Set as file thumbnail**. Last clear label visually truncated; full spelling confirmed by AX. Clear commands not invoked.

Measurements / RGB:176wide,≈25px rows,4px inset,≈12radius; C. Menu can extend to window bottom.

Verdict: Preview-specific terminal/data clearing; copying/duplication disabled in observed menu.

## PF6 — Preview inspector

Steps: select Dipper layer. PF6-inspector. Properties order **Screen template** (MacBookPro14, rotation icon), **Position** (alignment controls disabled, X418 Y246 rotation0, Left/Top disabled, Z Auto, anchors disabled), **Layout** (W1512 px, H982 px, aspect icon), **Appearance** (Opacity100%), **Export**. No ordinary frame background/border/shadow sections in this preview inspector.

Measurements / RGB:280wide,12px inset,24px fields, C/G; alignment positions read-only where AX marks disabled.

Verdict: Preview uses specialized screen/viewport inspector.

## PF7 — Layers

Steps: inspect selected and hover Dipper row. PF6-inspector, PS4-error-verified. Browser-window outline icon, **Dipper**, lock/eye controls on hover. Captured Text appears as a separate sibling, not expanded preview children.

Measurements / RGB:32px row pitch, selected inset6px, radius≈4; selected68/40/83, textlightgray; C/G.

Verdict: One browser-type layer named for worktree, independent from captured editable layers.

## PF8 — Multiple previews

Steps: inspect Duplicate in PF5; open separate Preview tab in PF3. Duplicate disabled; separate tab is not evidence of a second canvas object. No second repo/profile was configured.

Measurements / RGB: disabled menu item in176px menu, C; no second-frame geometry available.

Verdict: not observable — no reachable second canvas preview established; internal tab is a distinct presentation only.

## PM1 — Contextual modes

Steps: select frame and hover three mode buttons. Authoritative PM2-navigate, PM1-navigate-hover/edit-hover/capture-hover. Exact visible **Navigate / Edit / Capture / …**. Tooltips **Navigate inside**; **Inspect element ⌘⇧I**; **Capture / Add an editable design to canvas**. Active Navigate/Edit/Capture uses lighter rounded inset, preview blue outer glow. While paused, Edit/Capture visibly dim (X5).

Measurements / RGB: toolbar≈296×40 centered in canvas near bottom, y766 with main tools48px below; ≈14radius,4px padding. Active fill≈54/54/54; body28/28/28. It stays viewport-anchored, not immediately under frame bounds. C/G.

Verdict: Three distinct interaction modes; contextual toolbar remains screen-sized.

## PM2 — Navigate

Steps: choose Navigate; click Count; type Sunbird; click About; Back. PM2-navigate, PM2-typed-verified, PM2-about. Count0→1; input **Sunbird**; link loads **About Sunbird / Home**, path **/about/**. Back restored home with counter0 and inputSunbird. Clicking canvas outside returns ordinary selection (seen later). Escape/scroll release not isolated; short fixture has no scrolling content.

Measurements / RGB: blue outline≈2px plus glow; form scales at55%; blue samples in measurements.json, C/G. Input focus orange outline is sandbox/browser rendering, not Wonder theme.

Verdict: Interactive embedded page verified for click/type/link/back; scrolling and all-input keyboard release untested.

## PM3 — Edit

Steps: Edit → hover h1 → click → double-click word “preview” → type “edited” → click outside. PM3-hover-verified, PM3-select, PM3-inspector, PM3-edited; X2-changes. Hover thin purple DOM bounds; selected four corners and **1432 Fill x 42.5 Hug** badge. Inspector Position X40 Y64.12 disabled; Layout W1432 H42.5, min0, padding0/0, margins0/24.12; Appearance; Typography **system-ui (unsupported) / Bold / 36px / Line height Auto / Letter spacing0**; Text Fill172340. Double click selects word; typing changes heading to **Sunbird edited sandbox**. **1 change** appears. Style edit trial via AX failed (font remained36); undo/redo not established. Staged change did not modify either sandbox git worktree. Stop discarded it after confirmation; capture retained its edited text independently.

Measurements / RGB: at55% h1 outline≈783×23; badge22high; same280px inspector; C/G. Text highlight pale purple; numeric samples preserved.

Verdict: DOM selection and direct text edits work as staged preview edits. Inspector exposes styles but successful style mutation and undo/redo remain unverified; no immediate code sync.

## PM4 — Capture

Steps: Capture → hover h1 → click. PM4-capture, PM4-result. Hover outlines element, **1432 × 43** badge; floating keyboard strip shows arrow keys, Shift+up/down, return, Command+return, esc (actions not all tested). Result **Text** layer with **1432 x 42.5**, content **Sunbird edited sandbox**, typography system-ui(unsupported), Bold36, fill172340; X2030 Y246. Preview was X418 Y246 W1512, so captured layer begins100 document px to its right, aligned to preview top (not original h1 y).

Measurements / RGB: same55% zoom; keyboard strip≈308×32 with shadow; C/G. New text layer editable inspector, not Image fill.

Verdict: Element capture creates native editable Text, places right of preview and pans to it; other element/full-page formats unresolved.

## PM5 — Agent context

Steps: Edit/select heading → Add to chat button. PM3-select shows tooltip **Add to chat ⌘L**; PM5-context-verified shows chat open with purple target icon and truncated **h1 "Sunbird previe…** chip. No message sent. Initial PM5-context is transition before chat content mounts.

Measurements / RGB: chat500wide, chip≈170wide within composer, purple text/icon; C. DOM selection badge remains on canvas.

Verdict: Selected DOM element can be attached to chat without sending a prompt.

## PP1 — Publish

Steps: click frame Publish, inspect, Escape. PP1-publish. **Publish to the web / Not published yet**; **Share your app / Pro lets you publish your app to the web.**; **Environment variables / 0 keys sent ›**; purple **Publish [Pro]**. No Cancel button; Escape dismisses. Publish not clicked, environment variables not opened.

Measurements / RGB: popover≈320×192 at(736,158),≈12radius,10px inset; action≈300×28; interior32/32/32, primary purple sampled in JSON.

Verdict: Publish is Pro-labelled and includes environment-variable disclosure; actual publication intentionally not tested.

## PP2 — Stop

Steps: frame Stop after one text change → confirmation → Discard and stop; later header Stop. PP2-stopped and PP2-stopped-verified show **Discard preview edits? / 1 unsaved edit will be lost when this preview stops. / This can’t be undone. / Keep editing / Discard and stop**. PS5-paused is actual result. X5 shows canvas paused while chat still Stop preview and tab green; later header Stop changes tab **Dipper · Stopped** and header **Start preview** (PS4-transition). This may reflect separate ownership or stale surface state; causal mechanism not established.

Measurements / RGB: dialog400×156, title16px, body14px, radius≈16; red destructive button≈126×28. Dimmed overlay; C/G.

Verdict: Staged edits require discard confirmation. Frame persists; per-surface stop/header synchronization needs careful handling rather than assumptions.

## PP3 — External browser

Steps: inspect running split menu and modes More. X5-running-menu, X4-more-actions-verified both show **Open in browser** with external-link icon. No external-browser navigation was invoked.

Measurements / RGB:176wide menu,25px rowpitch, C.

Verdict: External browser affordance observed; actual launch not observable in this pass.

## X1 — Repository preview settings

Steps: split menu Preview settings, before and after agent configuration. X1-settings, PS2-edit. Left **preview-sandbox / Repository settings**, sections **Worktrees / Context / Memory / Preview**. Main **Preview / How the Preview starts, opens and stops your app in a worktree.**; **Preview commands / Each command starts a part of your app. Leave “Opens at” on Default to open the address the command prints.** Columns **Name / Start command / Opens at**, default NameApp, placeholder npm run dev, Default. **Add start command**. **Setup and stop**; **Setup command / Runs in each worktree before the Preview first starts your app, and again after you change it or if it didn’t finish. Chain steps with &&.** placeholder npm install. **Stop command / Runs when you stop the Preview, to end what the start command left running, like containers.** placeholder docker compose down partly clipped at bottom. Footer **Detect with agent / Cancel / Save**; detect busy/disabled during agent investigation. No explicit Port field in this settings view. Additional command not added.

Measurements / RGB:992×640 modal,192wide sidebar, main inset40px, fields29px; C/G.

Verdict: Profiles support multiple start commands, inferred/explicit opening address, setup and stop commands; observed single-command implementation works.

## X2 — Staged-change review

Steps: click amber1change badge. X2-changes. **Preview changes / Not in your code yet**; **h1 “Sunbird preview sandbox”** with eye/revert icons; **Text**, old text struck through, new **“Sunbird edited sandbox”**; **Hide all changes / Compare with the original**; **Revert all changes / Put back the original values**. No apply-to-code button in captured popover. Source sync not inferred from absent button alone; both scratch git statuses clean corroborate no immediate write.

Measurements / RGB:≈320×250 popover,≈12radius,10px inset;32/32/32; amber badge; C.

Verdict: Explicit temporary edits with comparison/revert controls, not automatic code writes.

## X3 — Embedded terminal

Steps: context menu Show terminal. X3-terminal. **Terminal / Your keys go to the app / Copy logs / Hide terminal**. Python serving stdout and GET request logs; footer **Detected localhost:8000 / Esc to stop typing**. No terminal command typed.

Measurements / RGB: bottom terminal≈174px screen high at55%; monospace logs≈6screen px (scaled); panel26/26/26; C/G.

Verdict: Per-preview interactive terminal/logs are embedded inside frame; key-routing and detected-address hints explicit.

## X4 — More actions

Steps: selected frame modes ellipsis. X4-more-actions-verified. Exact order **Send all input to app / Open in browser**. Neither action invoked. First X4-more-actions contains only deselected frame and is not menu evidence.

Measurements / RGB:176wide,≈66high,25px rows,≈12radius; C.

Verdict: All-input mode and external-browser affordance are separate from ordinary Navigate.

## X5 — Multiple presentation state

Steps: open Preview tab; stop only canvas; inspect chat split menu. X5-running-menu, PS5-paused, PF3-expanded-verified. CanvasStart vs chatStop and green preview-tab dot coexist. Later chatStop changes tabStopped. Tab loaded original heading separately from canvas staged edits. No second canvas object established.

Measurements / RGB: standard40px tab strip; green/gray/red status dots; C/G, detailed color samples JSON.

Verdict: Canvas, tab, header can disagree visibly; this pass does not determine whether by design or stale synchronization.

## Do not use

Filenames denote intended trials, not proof. Excluded for the claimed state: **PS1-hover** (agent investigation, no tooltip); **PS2-card**, **PS2-card-verified** (thinking, no final config); **PS3-starting** (stale pre-start); **PF1-running** (selected/clipped, not unselected); **PM1-toolbar**, **PM1-toolbar-verified** (deselected, no contextual toolbar); **PM2-typed** (paste created Pasted Text on canvas, not input; that temporary text was deleted before subsequent tests); **PM3-hover** (Edit active but no DOM outline yet); **PF2-path** (no editor); **PF2-path-about** (path remained/, no successful navigation); **PF3-expanded** (Starting Wonder transitional screen); **PS4-error** (actually starting); **PS4-transition** (stopped, not error); **PS4-logs** (no logs opened); **PM5-context** (mount transition); **X4-more-actions** (no menu). PP2-stopped and PP2-stopped-verified are valid confirmation evidence but NOT stopped-result evidence; use PS5-paused. PF2-stop-hover shows no tooltip; do not invent one. Notifications cover top-right of early PS1/PS2/PF1 captures; these cannot support obscured details. All later authoritative geometry captures are unobscured.

Intermediate native picker screenshots stayed in /tmp and are not audit evidence. Path typing initially lost characters; AX set-value corrected and verified `/tmp/preview-sandbox` before Open. Focus issues sometimes routed synthetic keys to Sunbird canvas. Only verified screen changes are claimed. Early selected existing scratch frames and accidental pasted text do not represent preview behavior.

## Remaining limitations

PF8 second canvas instance not established (Duplicate disabled). PS2 non-Auto approval card, PS3 setup/logs during startup, PS5 reopening persistence, PS6 independent Code start, PF2 typed-path submission/Stop tooltip, PF4 pointer resizing, PM2 scrolling/input-release details, PM3 successful style mutation/undo/redo/apply-to-code, PM4 full-page/other DOM captures, PP3 actual external launch remain unverified. Publish intentionally stopped at UI. No claims of absence for these features.

No app-source edits or tests; no audit commit made. Screenshot hashes and dimensions are in manifest.json. The valid Python run profile was restored and running success reverified in PS6-code/show-preview after the failure test.
