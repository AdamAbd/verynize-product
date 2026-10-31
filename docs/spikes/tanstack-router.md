# Renderer router spike

This spike adds `@tanstack/react-router` 1.170.46, using code-based routes and a
null-rendering React island. `/` selects the existing Files home and `/editor`
selects the existing editor. The canvas, document, other islands, settings and
code-mode implementations remain legacy-owned. Settings is not a route.

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
history back/forward methods work. Legacy-originated navigation on browser
history explicitly carries the current fragment and search forward. Router
scroll restoration and fragment scrolling are disabled.

The router never loads a document or connects a room. Existing cloud code still
reads invite/public fragments and owns their network/dialog behavior. Unknown
paths render no router content and leave the shell as-is; a full 404 experience,
trailing-slash deep links, settings routes, and per-document URLs are outside this
spike.

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
