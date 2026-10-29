# Implementation acceptance status

Updated 2026-10-28. This records actual implementation and tests, not a claim that every Wonder feature is equivalent. The original vendor checklist remains in wonder-roadmap.md.

## Implemented and exercised

- Shell/library: Wonder-reference dark chrome, floating tools, docked chat, local Inter typography and Lucide-based icons, responsive 1440/1000px layouts, persistent local files/folders, grid/list/search, rename/duplicate/archive/restore and publication-aware Public/Private filters. File switches detach previous native-save and cloud-room state; native opens and shared-room joins have separate library records. Delayed native Save completion is canceled after a document switch; responses from superseded cloud operations are discarded.
- Settings: local profile, light/dark/system theme, reduced motion, selection mode/nudge distances, task notification preferences, model/access defaults, personal instructions and local activity counts.
- Templates/views: three original editable document templates; named page/zoom/position views stored in documents and shared rooms.
- Canvas: text, rectangles, nested frames, images, four authored SVG icons, pages, layer search, multi-select, snapping, alignment, scaling, z-index, zoom/pan and keyboard nudges.
- Layout/style: free/flex/grid/block/inline layout, typography, mixed text ranges, gradients, gradient masks, color variables and CSS color token import. Authored Aurora/Waves/Noise/Ribbon/Mesh/Swirl WebGL shader presets expose color/speed/intensity, with rendered GPU pixels and exported shader runtime tested. Separate animated CSS gradients remain available.
- Precision/export: rotation, opacity, frame clipping, borders/shadows, color picker/hex input and selected-artwork PNG/JPG/SVG export. SVG uses foreignObject rather than pure vector paths.
- Documents: undo/redo, local persistence, JSON round-trip, inline HTML import/export, responsive sandboxed preview, native PDF export. Native file open/save/watch shares the document format with MCP and rejects stale writes.
- Projects: select a folder, inspect/edit text files, project memory, real Git worktree creation. New project and GitHub clone actions are implemented; public-network clone behavior has not been end-to-end tested.
- Agents: installed Claude/Codex discovery, explicit task execution, output streaming, queue/stop controls, file/canvas prompt context, review prompt. Both actual installed CLIs returned BETTER_DESIGN_OK and exited 0 in isolated temporary projects without reading or modifying files. General code-editing success remains task/provider dependent. Provider/model/effort/access controls, persistent quick-chat task history and canvas attachments are implemented. CLI account status and explicit sign-in/cancel/sign-out adapters have deterministic subprocess tests; real account mutation/browser completion was not exercised.
- Preview/capture: embedded responsive localhost app pane and separate native window. Embedded capture reads the actual named iframe without a reload, preserving current DOM/input state and excluding passwords. Bounded capture preserves supported hierarchy, text/style, borders/shadows and eligible same-origin bitmap images. API region clipping, foreign-resource blocking, script exclusion and generated PDF bytes have Electron tests; the UI captures the viewport.
- Headless automation and live MCP: 24 shared tools (Wonder-style design context, Tailwind-JSX element code, create_artboard, update_elements directive scripts, tokens, documents/pages, screenshots) served by a loopback, bearer-authenticated HTTP bridge inside the desktop app that edits the open canvas live with undo, and by the stdio server, which proxies to the bridge or falls back to on-disk documents. See wonder-ai-mcp-spec.md and tests/mcp-live.cjs.
- Canvas interactions: infinite cursor-anchored camera, tool modes with draw-to-create and frame presets, marquee/drill-in/keyboard navigation, smart guides with equal-gap snapping and distance lines, clipboard and style paste, frame/unframe, auto layout, z-order, lock/hide, Fixed/Hug/Fill sizing and a context menu. See wonder-canvas-spec.md and tests/canvas-interactions.cjs.
- Chat runtime: Claude Agent SDK sessions (streaming, resume, interrupt, permission cards) and Codex app-server threads, four access levels, quick-chat scratch folders, per-turn selection context and automatic wiring to the live MCP bridge. No real model turn has been run through the new runtime yet.
- Collaboration: private capability rooms, persisted SQLite snapshots, WebSocket updates, names/cursors, reconnect, explicit conflict choice. Two real Electron clients exercised these against local workerd.
- Publishing: frozen read-only snapshots, access checks, unpublish/revocation. Tested locally, not deployed.
- Cloudflare: cf build/deployment dry run passes with Durable Object and rate-limit bindings. No production deployment occurred.

- Figma REST adapter: supported file/selection hierarchy, text, layout, paints and bitmap fills; conversion/request tests pass. Live authenticated import remains unverified.
- Illustration generation: actual Codex produced a valid SVG through the app generation service. SVG sanitization and PNG/raster tracing are tested in Electron. Raster tracing emits real quantized vector paths, not embedded images.

## Remaining gaps against Wonder's shipped product

- Native Figma clipboard conversion, OAuth account connection and full Figma fidelity; native .fig/.pen compatibility. PAT-based supported REST import is implemented but awaits a live account test.
- Arbitrary remote webpage capture with full assets/custom fonts, interactive region selection, source mapping, and interactive behavior recovery. Local API region capture is implemented.
- Photographic image model providers and smooth/high-fidelity curve tracing; implemented generation is agent-authored vector illustration with optional PNG rendering.
- Exact Wonder shader library and parameter compatibility; the implemented WebGL presets are independently authored.
- Full CSS/Tailwind import/export fidelity; external stylesheet resolution; general source round trips.
- Provider-hosted multi-account management, conversation rewind/resumption, account-specific billing/usage, tool/plugin configuration, comprehensive agent autonomy UI. Local CLI sign-in/switch and model defaults exist; successful provider browser login remains unverified.
- Accounts, public creator profiles, identity-based permissions, token recovery/rotation, full real-time semantic merging.
- Published running applications with build/deployment automation; current public publishing is a design snapshot.
- Global source-code search across projects, complete template/library ecosystem and history-preserving workspace moves. Local file/page/layer search, original templates and document-persisted shared views are implemented.

## Evidence boundaries

Installed Wonder and Pen were inspected statically; their hosted/account-dependent workflows were not runtime verified. The local app is independently authored. FigCraft supplies an architectural reference for a shared editor/CLI/MCP document model, not copied implementation. Tests prove the listed bounded behaviors on this machine; they do not establish full parity with any proprietary product.

## Packaged application

Version 0.3.0 of `dist/Better Design.app` was rebuilt from the current source, locally ad-hoc signed, launched, and tested for canvas edits and native document saves. `codesign --verify --deep --strict` passes. The build is not notarized for external distribution. `npm run test:package` reproduces the packaged-app smoke test after `npm run package:mac`.

## Reproduce

`npm run check`, `npm test`, and `npm run deploy:check`.

Relevant suites: tests/wonder-shell.cjs, tests/settings.cjs, tests/views-templates.cjs, tests/agent-auth.cjs, tests/capture-fidelity.cjs, tests/capture-live-state.cjs, tests/canvas*.cjs, tests/desktop*.cjs, integrations/*.test.mjs, tests/cloud-rooms.mjs, tests/cloud-desktop.mjs. Reference UI screenshots and intentional visual differences are recorded in ../design-qa.md. Final validation passed: canvas (including four-corner resizing and raster pixels), desktop/auth/live capture, MCP/CLI integrations, UX/lifecycle/cloud async isolation, cloud rooms/two-client integration, packaged launch/save, code signature verification, and Vite+/cf deployment dry run. No production deployment was performed.
