# Renderer router spike

This spike adds `@tanstack/react-router` 1.170.46, using code-based routes and a
null-rendering React island. `/` selects the existing Files home and `/editor`
selects the existing editor. The canvas, document, other islands, settings and
code-mode implementations remain legacy-owned. `/settings/<section>` mirrors the
settings overlay (see "Settings route" below).

`fileLibrary.showHome()` and `showEditor()` emit `bd:view-change`; the router
listens and pushes a path only when the view differs. Route effects call those
same APIs, with a guard against feedback. Opening another file while already in
the editor does not create another route entry. History is view history, not
file history: Back returns to the home/editor view, not the previous document.
`window.shellRouter` exposes the imperative router for integrations and the
file-history regression test.

HTTP(S) and the proposed `app://verynize` origin use browser history.
`/index.html` is replaced with `/` before router construction, preserving search
and fragment. Only top-level route paths are supported; relative assets still
resolve beside index.html. Extensionless deep links require the supplied SPA
fallback contract. Neither Electron nor the Cloudflare serving configuration is
changed here.

`file://` uses memory history initialized from the legacy startup view (currently
editor). This preserves existing desktop/test startup behavior, avoids invalid
file path pushState operations and leaves the fragment exclusively available to
`#room=...&token=...` / `#public=...`. Navigation in this mode does not change the
address bar, survive reload, or use native browser Back/Forward; the router's
history back/forward methods work. Every navigation on browser history keeps the
current cloud fragment by construction (see "Cloud fragments" below); legacy
navigation also carries search forward. Router scroll restoration and fragment
scrolling are disabled.

The router never loads a document or connects a room. Existing cloud code still
reads invite/public fragments and owns their network/dialog behavior. Unknown
paths render no router content and leave the shell as-is; a full 404 experience,
trailing-slash deep links and per-document URLs are outside this spike.

## Cloud fragments: `#room=` / `#public=` stay in the hash

Rule: room invites keep the existing format, `<origin>/#room=<id>&token=<capability>`
(token omitted for account invites) and `<origin>/#public=<id>`. They never move
into the path or query string. The router preserves them by construction.

Why the hash, checked against the code:

- No server ever needs the fragment. `cloud/rooms.js` `access()` reads the
  capability from `Authorization: Bearer` (and from `?token=` only on
  `/api/rooms/<id>/socket`, because browsers cannot set WebSocket headers; that
  request URL is never a page URL). The editor page is a static asset served by
  the Worker's `single-page-application` fallback (`cloudflare.config.ts`); it
  takes no room parameters. `web/cloud-panel.js` reads `location.hash` once at
  startup and joins through `request()` with the token in a header.
- A token in the page query would leak. The editor page has no
  `Referrer-Policy` (only Worker-rendered pages, apps and room assets send
  `no-referrer`), so the browser default `strict-origin-when-cross-origin` would
  send the full URL, query included, as `Referer` on every same-origin script,
  style, asset and `/api/*` request. The query is also in the request line itself,
  which reaches Worker logs (`observability` is enabled). Browsers never send the
  fragment. The plain-browser check below served 176 requests for a
  `/editor#room=…&token=…` session; none carried the token in its path, query or
  `Referer`.
- Links already sent stay valid. Links are built in `web/cloud-panel.js`
  (`updateInvite`, the role-link generator and publish use `url.hash`),
  `cloud/worker.js` (invite email: `${origin}/#room=<id>`) and `cloud/mcp.js`
  (`editorUrl`: `${origin}/#room=<id>`). All point at `/`, now the Files home
  route, and the startup invite dialog opens regardless of route.

Preservation by construction (`web/src/lib/router/shell-router.ts`): the browser
history object's `push`/`replace` are wrapped. A target without its own fragment
inherits the current `#room=`/`#public=` fragment. This covers
`shellRouter.navigate`, `navigate()`, links, `history.push` and legacy view
changes alike; nobody has to remember `hash: true`. If the fragment makes a push
equal to the current URL, the push becomes a replace, so there are no duplicate
entries. Every entry pushed in the session carries the fragment, so Back/Forward
and reload keep it. A target with an explicit fragment replaces it. App code
navigates with the exported `navigate()`; lint (`no-restricted-imports` in
`vite.config.ts`) rejects importing `shellRouter` anywhere except the router
island. Search params are not preserved by construction.

Leaving: `cloud-panel.js` never cleared the hash before. With preservation, a
left room's invite would be offered again on every reload. Now
`disconnect(…, leave=true)` calls `window.shellNavigation.clearRoomHash(roomId)`.
This replaces the current entry without the fragment (only if it names that room)
and remembers the room for the page session, so Back/Forward onto an older
entry of the same room drops the fragment again. `#public=` is never cleared. A
fresh page load of the invite link is a new invitation.

Desktop: `verynize://join?invite=<https invite>` (`desktop/app-preferences.cjs` →
`desktop:open-link` → `openDesignLink` in
`web/src/islands/settings/preference-runtime.ts`) closes settings, fills the
share dialog and joins. It never writes `location.hash`, so the `app://verynize`
URL stays on its route with no fragment, and the capability never enters the
renderer URL or session history. Desktop rooms persist through the file
library's cloud record. Under `file://` (memory history) the real address bar is
untouched, so the fragment is preserved trivially; `clearRoomHash` uses
`replaceState` there.

## Settings route

`/settings/<section>` (`account`, `preferences`, `agents`, `accounts`, `tools`,
`projects`, `usage`, `models`, `connections`, `memory`, `members`,
`permissions`) mirrors the legacy overlay (`window.appSettings`, body class
`settings-open`, `#settings-screen`). `web/settings.js` emits `bd:view-change`
when it opens, switches section and closes. `/settings` and unknown sections are
replaced in place by `/settings/preferences`.

The URL names only the section. The view underneath is not in the URL. It is
stored in that entry's history state (`settingsUnder`: `/` or `/editor`,
`settingsPushed`). Settings is app-level, not view-specific, so the URL stays
canonical and shareable. Per-entry history state survives reload and
Back/Forward, so a reload of `/settings/account` opened over Files home comes
back over Files home. A typed or shared `/settings/...` URL has no state. It opens
over the current view, which on a fresh load is the editor (the legacy startup
view).

History:

- Opening (menu `#shell-settings`, ⌘,, `appSettings.open`, avatar/profile
  buttons, or a router navigation from `/` or `/editor`) pushes one entry.
  Switching sections replaces it, so Back always closes settings in one step.
- Back closes settings and shows the view underneath. Forward reopens it.
- Closing (`#settings-back`, Escape, `appSettings.close`, code mode, deep links)
  steps back to the entry it was pushed from (`history.back()`), so no entry is
  added. Forward can reopen settings. If there is no such entry (a typed URL), or
  the view underneath changed meanwhile, the settings entry is replaced with the
  current view.
- Repeated `open`/`select` calls for the current section do not touch history.

Legacy shell changes (home/editor/settings) write the history directly
(`commit()`), and the router follows its notification. `router.navigate` compares
against `router.latestLocation`, which lags a push made in the same tick.
`showHome(); showEditor()` would otherwise leave the URL on `/` with the editor
showing, and the route effect would then switch the shell back to home. That
broke `tests/views-templates.cjs` until the change, and `tests/shell-router.cjs`
now covers it.

Known edges: settings closes through `history.back()`, so the URL catches up one
tick after the overlay hides. A reload in that tick reopens settings. Escape over
Files home with settings open still closes settings and also leaves home (two
pre-existing key handlers); the URL ends on `/editor`, matching the shell.
`leftRooms` lives only for the page session.

### Room-hash and settings validation (spike/room-hash-settings)

- `npm run build:ui`, `lint:ui`, `typecheck:ui` and `check` exit 0.
  `oxfmt --check` passes on the changed files. `web/settings.js` is minified
  legacy and already fails the baseline check.
- `node tests/shell-router.cjs` and `node tests/settings-route.cjs`: 3/3 PASS each.
- `test:ux` run file by file (wonder-shell, settings, views-templates, views-store,
  document-lifecycle, cloud-async, shell-router, settings-route): all PASS.
  `npm run test:cloud`: PASS.
- Plain Chrome against a static `web/` server with SPA fallback: `/settings` →
  `/settings/preferences` (section clicks replace, Back to app → `/editor`, ⌘,
  pushes, Back/Forward/reload work). `/editor#room=…&token=…` opens the invite
  dialog. `shellRouter.navigate({to: "/"})`, settings over home, two Backs and
  reload all keep the exact fragment. There were no page errors. Of 176 server
  requests, none contained the token.

## Validation

Validation results and the measured generated bundle delta are recorded below.
The generated `web/dist` files are built, ignored by Git, and never hand-edited.

Dependency selection: `npm view @tanstack/react-router version` returned
`1.170.46`; `npm install @tanstack/react-router@latest` installed that version
and synchronized the lockfile. Context7 `/tanstack/router` was consulted for
code-based routes, RouterProvider and custom memory history.

Generated `web/dist/ui.js`: 1,681,220 bytes before, 1,757,543 bytes after;
76,323 bytes added (4.54%, uncompressed). Both builds used the same local
Node 26.13.0/toolchain and production build command.

Plain browser checks used the T3 browser and a temporary Node static server on
127.0.0.1:4317, serving `web/` with extensionless-path fallback to index.html:

- Direct `/editor`: route `/editor`, `files-view=false`, three existing canvas layers.
- Files button: URL `/`, `files-view=true`.
- Native `history.back()`: `/editor`, `files-view=false`; `history.forward()`:
  `/`, `files-view=true`.
- Fresh `/`: Files home with the existing file; clicking Open Untitled:
  `/editor`, `files-view=false`.
- `/index.html?spike=1#room=router-test&token=a%2Fb%3D`: replaced with
  `/?spike=1#room=router-test&token=a%2Fb%3D`; invite dialog remained open.
  Switching to editor preserved the exact encoded hash and search.
- `#public=router-test` was preserved through home/editor switching.

The browser exposed no `window.desktop`, as expected. Native project access,
agent execution and IPC were not tested there. The static server has no cloud
API: successful room joining and public-document fetching were not end-to-end
browser checks. Existing cloud async/document lifecycle tests and the fragment
checks cover the integration boundary of this spike.

Still to verify after merging the parallel protocol work: privileged app origin,
`app://verynize/editor` direct load/reload and asset resolution, Back/Forward,
and origin-based IPC authorization after a path change. The new regression test
intentionally asserts `file:` for this branch; adapt its startup assertions when
the desktop protocol lands, while retaining coverage of the memory fallback.

Checks completed:

- `npm run build:ui`: exit 0, `Built UI islands: ui`. Existing unresolved asset
  warnings for `x.png` and `…` also occur in the baseline build.
- `npm run lint:ui`: exit 0, no diagnostics.
- `npm run typecheck:ui`: exit 0, no diagnostics.
- `npm run check`: exit 0, `All JavaScript syntax and entry asset checks passed`.
- `npm run build` (Cloudflare): exit 0, final output `✓ built in 94ms`.
- `npm run format:check`: exit 1, `Format issues found in above 509 files. Run
  without --check to fix.` The exact same 509 file paths fail on a clean archive
  of staging `0a5e9f88a0ff76c9dd30ebf21b905a2d19aca3ca`; no new failing paths.
  New TypeScript and regression test files pass a targeted format check.
- `node tests/shell-router.cjs`: exit 0:

```text
PASS shell router: file memory history, route/view sync, Back/Forward, Escape, deduplication, document and cloud hash preservation
```

The pre-router bundle baseline passed `test:canvas` and the original `test:ux`.
The named onboarding/capture/MCP flakes are not part of these two suites and
were not run. No unrelated assertions or formatting were changed.

`npm run test:ux` completed with exit 0, including the new router test. The
initial changed-branch `npm run test:canvas` stopped at
`tests/inspector-parity.cjs:168:45` with exit 1:

```text
page.waitForSelector: Timeout 20000ms exceeded.
  - waiting for locator('[data-sonner-toast]') to be detached
```

The original baseline suite passed that test. An isolated rerun from the clean
staging archive also passed (exit 0), ending with:

```text
PASS layout section: flex matrix, distribution, reverse, wrap, gaps, padding axes/sides, limits, Grid settings tracks (fr weights, auto rows) + Automatic positioning + cell alignment, grid child spans, margin auto, block spacing
```

Browser checks were active during the initial changed-branch suite. The timeout
may be related to focus/visibility pausing toast expiry, but that cause is not
proven. No implementation or assertion was changed in response; the full canvas
suite was rerun with browser checks finished.

The unchanged full `npm run test:canvas` rerun completed with exit 0. Its final
output was:

```text
PASS typography: Wonder layout, line height Auto, vertical alignment, Type settings fields render + clear, in-canvas editing with range styling, light theme
```

Thus the final canvas and UX suite runs pass. The initial toast timeout and the
repository-wide formatting failure remain explicitly recorded above.
