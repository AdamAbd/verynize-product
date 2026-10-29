# Desktop workflow contract

`window.desktop` is exposed by the sandboxed preload. Every main handler checks the window, main-frame identity, and exact local entry URL. No raw IPC or Node objects reach the renderer.

- `openProject()` uses the native folder picker and returns `{root,name}` or null.
- `listFiles()` returns up to 2,000 `{path,size}` entries, depth at most eight; excludes symlinks, .git, node_modules, and common build output.
- `readFile(path)`, `writeFile(path,text)` accept relative, existing-parent paths within the chosen project. .git, traversal, absolute paths, symlinks, binary reads, and files over 2 MB are rejected. File writes are explicit user actions; external concurrent filesystem changes are not locked.
- `gitStatus()` returns git short branch/status output. `createWorktree('design/name')` creates a new branch and sibling directory; requires a committed Git repository, never overwrites an existing directory or branch. Return `{path,branch}`. Select that directory separately to edit it.
- `readMemory()`, `writeMemory(text)` use project `BETTER_DESIGN.md`. This file is not automatically injected into agent prompts.
- `discoverAgents()` detects Codex and Claude executables without executing models. Existing CLI authentication is reused only on execution.
- `runAgent({agent,prompt,chatId,model?,effort?,access?,sessionId?,instructions?,context?})` starts one chat turn (see `desktop/agent-runtime.cjs` and `docs/agent-workflows.md`). Claude runs through the Claude Agent SDK on the installed Claude Code; Codex through `codex app-server` JSON-RPC, falling back to `codex exec`. `access` is `ask|edit|auto|full`. Without a project the turn runs in `userData/agent-workdirs/<chatId>`. At most three turns run per window. `respondAgentPermission({requestId,allow})`, `listAgentModels({agent})` and `saveAgentImage({chatId,name,data})` support approval cards, the model picker and pasted images.
- `onAgentEvent(callback)` returns an unsubscribe function. Events carry `{id, chatId, seq, type}` with types `session`, `status`, `assistant-text-delta`, `assistant-text`, `thinking-delta`, `tool-call`, `tool-input-delta`, `tool-result`, `permission-request`, `permission-resolved`, `usage`, `error` and a final `done {code, stopped, sessionId}`. `cancelAgent(id)` interrupts the turn (SDK `interrupt()` / Codex `turn/interrupt`, process kill for the fallback). Closing the window cancels its turns.

Validated with Context7 `/electron/electron` IPC/security documentation and installed `codex exec --help` / `claude --help`. Tests cover real temporary Git operations and file containment, plus Electron preload, discovery and renderer isolation. No authenticated model request was run during implementation.

## Figma import adapter

`registerFigma(handle, parent)` registers `importFigma({url,token})`, returning `{document,warnings,source:{fileKey,nodeId}}`. The token is a Figma personal access token with `file_content:read` scope, supplied transiently through the app password input. It is never stored or logged by the adapter. The adapter makes requests only when invoked; no authenticated remote request was made during development.

Supported URLs: `https://www.figma.com/design/<key>/...` and `/file/<key>/...`, optionally `?node-id=1-2` or `1%3A2`. A selected node uses `GET /v1/files/:key/nodes?ids=...`; full files use `GET /v1/files/:key`. Referenced bitmaps use `/v1/files/:key/images`. The PAT is sent exclusively to `api.figma.com`; asset fetches carry no authorization. Redirects are rejected and asset hosts are limited to Figma CDN/known Figma S3 host patterns.

Conversion retains pages, parent hierarchy, relative bounds, basic frame auto-layout, rectangles, text, mixed text runs, solid paints, basic gradients and downloaded bitmap fills. Figma component instances become independent layers. Asymmetric-padding/absolute-child auto-layout stays positioned; fixed dimensions are preserved. Unsupported effects, strokes, masks, transforms, vector geometry, image crops and advanced layout receive warnings. Import is not pixel-perfect. Ellipses become rounded bounds; unknown shapes become bounding rectangles. Fonts must exist locally for faithful text rendering.

Bounds: 20 MB document/API response, 5,000 converted layers, 100 pages, 80 hierarchy levels, 20 downloaded images, 5 MB per bitmap and 15 MB combined. Requests time out after 30 seconds. Expired/insufficient tokens, missing nodes and rate limits produce explicit errors; missing image fills produce warnings.

`node --test tests/figma-import.cjs` covers representative conversion fixtures, strict URL parsing, token routing, missing-node/authorization failures, mixed text, hierarchy and fill conversion using injected responses. No user credential is needed to run it.

Sources: Context7 `/figma/rest-api-spec` endpoint, node and paint documentation; official [Figma file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/).
