# Installed Wonder evidence

Observed 2026-10-28: `/Applications/Wonder.app`, bundle ID `so.wonder.desktop`, version **0.2.183**, build `2610272r7j3zbrr`.

ASAR SHA-256: `db46efb3dceeacbe650f33f9491cf8a48911d2b8ad891bc27e5a5d27e37c8f96`.
REA parent evidence: `ev_80160b2f9d20c1c42d14b5d30f98a58b51bd89689b19ab5add9d227698b84197`. Full retained export: `wonder-evidence.json` (large local artifact, gitignored).

The REA analysis selected only package.json; all other code relationships remain unexamined by that analysis. Two unpacked native members (pty.node and spawn-helper) contradict ASAR integrity declarations. Analysis explicitly used record-and-continue; these members remain observed-untrusted. Post-signing modification is a possible explanation, not established.

Separate inert ASAR reads recovered manifest and selected desktop files to `/tmp/wonder-inspect`; no proprietary source is included in this reconstruction. The manifest declares Claude Agent SDK, Aquila capture-kit/node-kit, CodeMirror, PixiJS, Yjs, Hocuspocus and xterm dependencies. These declarations do not prove runtime use.

Literal desktop configuration names app.wonder.so and api.wonder.so/api/v1. IPC channel strings include worktree creation and Codex account operations. These are static candidates, not successful runtime observations. The public repositories do not expose the full editor.

No Wonder launch, login, generation request, collaboration session, local agent execution, or source-edit round trip was observed. Full parity remains unresolved. The independently authored local canvas is an implementation foundation, not a complete Wonder clone.

Context7 resolved `/electron/electron` and queried secure BrowserWindow / contextBridge / IPC documentation. The desktop foundation isolates the renderer with sandbox and context isolation and exposes no Node bridge.
