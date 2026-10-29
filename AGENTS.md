# AI AGENTS Guidance Document

This file provides guidance to coding agents (Claude Code, Codex, …) working in this repository.

Verynize is a macOS Electron design editor (canvas + inspector + local Claude/Codex agent chat), with a headless CLI/MCP server for agents editing the same document format, and a Cloudflare Worker for room-based collaboration. The visual target is the Wonder app, captured in `design/wonder/*.png` (2880×1740 = 1440×870 CSS px at 2×).

## Project structure

- `desktop/`: Electron main process, sandboxed preload, project access, agent execution (`.cjs`).
- `web/`: legacy canvas logic, HTML, CSS, static assets in `web/assets/`. React/TypeScript islands in `web/src/islands/`; shared components, bridge and tokens in `web/src/components/ui/`, `web/src/lib/`, `web/src/styles/`.
- `integrations/`: CLI/MCP servers, document codecs, colocated tests (`.mjs`).
- `cloud/`: collaboration Worker. `tests/`: desktop, canvas, UX and cloud tests.
- `eval/`: visual fidelity fixtures and evaluation tools. `design/wonder/`: reference screenshots. `docs/`: architecture and acceptance notes.

## Commands

Toolchain is Vite+ (`vp`), installed locally and pinned in `package.json`. No global CLI is needed. Node `^22.18 || ^24.11 || >=26`.

```sh
npm install
npm start                 # build UI bundle, then launch Electron
npm run build:ui          # web/src → web/dist/ui.{js,css} (the app loads this; rebuild after editing web/src)
node scripts/build-ui.cjs <island>   # build one island alone → web/dist/<island>.{js,css}
npm run check             # node --check on all .cjs/.mjs/.js + verifies web/index.html asset refs (build UI first)
npm run lint              # vp lint (oxlint + @shadcn/lint rules on web/src)
npm run lint:ui && npm run typecheck:ui   # required to be clean for web/src changes
npm run format / format:check
npm test                  # full suite: build:ui + canvas, desktop, integrations, ux, cloud suites
npm run test:canvas | test:desktop | test:integrations | test:ux | test:cloud
npm run dev / build       # Cloudflare web dev server / Worker build (vite.config.ts)
npm run deploy:check      # build + `cf deploy --prebuilt --dry-run` (never run `deploy` unprompted)
npm run cli -- --root /abs/dir list   # headless document CLI
npm run mcp -- --root /abs/dir        # stdio MCP server
npm run package:mac       # dist/Verynize.app (ad-hoc signed)
```

Run a single test directly. Tests are plain scripts, not a vitest suite:

- Electron/Playwright UI tests: `node tests/canvas.cjs`. Each launches a real Electron window with a temp `--user-data-dir`. Run `npm run build:ui` first if `web/src` changed.
- `node --test` style: `node --test tests/views-store.cjs`, `node --test integrations/design-edit.test.mjs`.
- Cloud: `node tests/cloud-rooms.mjs` (Miniflare/workerd), `node tests/cloud-desktop.mjs` (two Electron clients).
- Codec fidelity gate: `node eval/run-fidelity.mjs [--verbose]`. Fixtures in `eval/fidelity/fixtures`. Never loosen assertions to make them pass.

Tests use real Electron, real git repos and local workerd. Nothing is mocked. No coverage threshold; add regression coverage for behavior changes. Name integration tests `integrations/*.test.mjs` and use feature-based names in `tests/`. When adding a test file, add it to the matching `test:*` script in `package.json`.

## Versioning

The app version is `"version"` in `package.json`; that is the source of truth. `package-lock.json` copies it in two places (top-level `"version"` and `packages[""].version`) and must stay in sync. Bump with `npm version <patch|minor|major|x.y.z> --no-git-tag-version`, which updates `package.json` and the lockfile together. If you edit `package.json` by hand, run `npm install --package-lock-only` to resync the lockfile. `SERVER_VERSION` in `integrations/design-tools.mjs` is the MCP server's own version and is not tied to the app version.

## Architecture

**Desktop main process** (`desktop/*.cjs`, CommonJS). `main.cjs` creates the sandboxed window (contextIsolation, no nodeIntegration). Its `handle(name, fn)` wraps every IPC handler and rejects any sender that isn't the main frame at the exact `web/index.html` file URL. Each feature module exports `registerX(handle, win, ...)`: projects (file containment, git and worktrees), design-files (native `*.verynize.json` save/watch), agent-runtime, figma, generate, render (offscreen PNG/PDF), preview, agent-auth. `preload.cjs` exposes `window.desktop`; its contract is in `desktop/README.md`. `mcp-bridge.cjs` starts a loopback HTTP MCP bridge with a per-launch bearer token, written to `~/Library/Application Support/Verynize/mcp.json`.

**Agent runtime** (`desktop/agent-runtime.cjs`, documented in `docs/agent-workflows.md`). Claude runs through `@anthropic-ai/claude-agent-sdk` `query()` against the user's installed `claude` binary, with a CLI fallback. Codex runs through `codex app-server` JSON-RPC, with a `codex exec` fallback. Events stream to the renderer as `{id, chatId, seq, type}`. Access levels (ask/edit/auto/full) map to permission modes and sandboxes. Limits are three turns per window and one per chat.

**Renderer: two layers in one page** (`web/index.html` script order matters):

1. Legacy vanilla scripts `web/*.js` (minified-style, very long single lines). `app.js` owns the document model (`design`, a version-2 document: `pages[].nodes[]` flat list with `parentId`; node types are rectangle/text/frame/image/shader), the validation, undo stacks, `render()` (which rebuilds the canvas DOM imperatively) and localStorage persistence. Other scripts add features and expose APIs on `window` (`window.design`, `window.agentWorkspace`, `window.fileLibrary`, `window.appSettings`, `window.askText`, …).
2. React 19 + Tailwind v4 + shadcn/Radix "islands" in `web/src/islands/<area>.tsx` + `<area>/`, all bundled by `web/src/ui.tsx` into one IIFE (`vite.renderer.config.ts`, `ISLAND=ui`) and loaded last. **Read `web/src/islands/README.md` before touching UI.** It defines area ownership (chrome, sidebar, inspector, home, chat, settings), the bridge (`web/src/lib/bridge.ts`: `useDesign`, `window.design.updateNodes`, `takeOver`/`legacyClick`/`hideLegacy`), cross-island contracts (body classes like `left-collapsed`, the `bd:open-app-menu` event) and the element ids and `[name=…]` selectors that tests depend on.
   - The canvas stays imperative. Never render layers in React or subscribe React to pointer-move.
   - The lint config (`vite.config.ts`) forbids raw colors, arbitrary values, unknown classes and dynamic class strings in `web/src` outside `components/ui`. Add tokens to `web/src/styles/globals.css` instead (values measured from `design/wonder`). The light theme switches on `html[data-ui-theme=light]`.
   - Keep Portals inside `portalContainer()`. Icon-only buttons need `aria-label`.
   - Edit source files, never the generated `web/dist/` bundles.

**Headless document engine** (`integrations/*.mjs`, ESM). `design-store.mjs` reads and writes `NAME.verynize.json` with revision checks. It has its own `validateDocument`, which mirrors `validate()` in `web/app.js`; keep the two consistent when changing the schema. `design-tools.mjs` is the single MCP tool definition shared by the stdio server (`mcp-server.mjs`) and the desktop bridge. Tools talk to a backend interface (`list/read/transact/create/open/focus/screenshot`). The stdio server proxies to the live bridge when the app runs and edits files under `--root` otherwise. `jsx-codec.mjs`, `codec-*.mjs` and `tailwind-*.mjs` convert between nodes and a safe, non-evaluated Tailwind JSX subset (classes resolved by the real Tailwind v4 engine). `design-edit.mjs` holds the pure transforms (short ids, `update_elements` directives, flow layout). `export-html.mjs` handles export, and `design-knowledge/` holds the agent design persona and playbooks.

**Cloud** (`cloud/worker.js`). One SQLite Durable Object per room. It does revision-checked whole-document snapshots (stale write → 409 + current snapshot; no CRDT), WebSocket presence and frozen public snapshots. Capability tokens are stored hashed. The API is in `cloud/README.md`, and the renderer side is `web/cloud-panel.js`.

## Coding style

Two-space indentation in new code; otherwise preserve surrounding conventions. PascalCase for React components, camelCase for functions/hooks, descriptive kebab-case module names. Keep CommonJS in `.cjs` and ES modules in `.mjs`. Format with `npm run format`.

## Commits and pull requests

Concise, imperative commit messages, optionally prefixed with `feat:`, `fix:` or `docs:`. PRs explain behavior changes, link applicable issues, record validation results, and include screenshots for UI changes.

## Documentation lookup

For library/API documentation, use Context7: resolve the library ID first, then query each relevant concept separately. General refactoring and business-logic work do not require documentation lookup.

## Docs worth knowing

- `docs/implementation-status.md`: feature acceptance and known gaps. Don't claim parity it doesn't record.
- `docs/wonder-canvas-spec.md`, `docs/wonder-ai-mcp-spec.md`: behavioural specs being implemented. Code and prompt text must be original.
- `eval/README.md` (in Indonesian): three-tier quality evaluation (codec fidelity, LLM judge, blind pairwise) and the acceptance gates.
- `design-qa.md`: measured Wonder tokens and the history of UI parity passes.
