# Model API runtime (TanStack AI)

Status: server side of the read-only vertical (audit steps 1 and 3) implemented on `feat/ai-backend`; the web chat client (step 5) on `feat/ai-web-chat`, see [Clients](#clients); write tools and approvals on the server (step 4) are not done yet. See [Implementation status](#implementation-status). Source audit: `docs/audits/2026-10-31-tanstack-start-ai.md`.

Verynize chat has two kinds of runtime:

| Runtime                 | Where it runs                                      | Agents                                               | Tools                                                       |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| Local coding agents     | Desktop main process (`desktop/agent-runtime.cjs`) | `claude`, `codex`                                    | Local MCP bridge, shell tools, the agent's own coding tools |
| Model API (`api-model`) | Cloud backend (`cloud/ai.js`, `/api/ai/*`)         | `openrouter` (TanStack AI `@tanstack/ai-openrouter`) | Verynize design tools against a cloud room                  |

The model API runtime does not replace Claude/Codex. It gives the web build (and any signed-in client) a chat that edits shared rooms through the same tool table as the hosted MCP server.

## Ownership of `/api/ai/*`

The cloud backend (`cloud/worker.js`) owns `/api/ai/*` on every target, like the rest of `/api/*`. Start never serves `/api/ai/*`. Reasons: the backend already has the session, room membership, rate limits and per-platform storage on Cloudflare, Node and Vercel, and Start is not deployed on Vercel. No change to `web-start/worker-paths.mjs`, `runWorkerFirst`, or `vercel.json` is needed. `tests/ai-routing.mjs` asserts that `/api/ai/*` reaches the backend on all three targets.

## Credentials

`OPENROUTER_API_KEY` is a server secret (Worker secret / environment variable). It never reaches the browser bundle. Without it, `GET /api/ai/config` reports `enabled: false` and run requests answer 503. Being signed in to Claude Code or Codex says nothing about OpenRouter, and vice versa. The UI shows the two separately.

Optional: `OPENROUTER_BASE_URL` (tests point it at a local fake), `VERYNIZE_AI_MODELS` (comma-separated allowlist `id[=Label]`, first is the default; default `openrouter/auto`), `VERYNIZE_AI_MAX_TURNS` (default 12), `VERYNIZE_AI_MAX_TOOL_CALLS` (default 40). On Cloudflare the key is a Worker secret (`cf secret put OPENROUTER_API_KEY`) that `cloudflare.config.ts` does not declare, so a deployment without it stays valid.

## HTTP API

All endpoints need a signed-in account (same `accountOf` as the rest of the API: Better Auth cookie/bearer or `X-Verynize-Session`). The account id always comes from the session, never from the request body or the model.

- `GET /api/ai/config` → `{enabled, provider: "openrouter", models: [{id, label}], defaultModel, limits: {maxTurns, maxToolCalls}}`.
- `POST /api/ai/runs` body `{chatId, roomId, prompt, model?, access?: "ask"|"edit"|"auto"|"full", history?: [{role: "user"|"assistant", text}], designStyle?, idempotencyKey}` → `text/event-stream`. The caller must have at least `viewer` on the room to read and `editor` to write. A repeated `idempotencyKey` for the same account returns the existing run: its stored events are replayed, then the stream follows the run if it is still active.
- `GET /api/ai/runs/:runId/events?after=<seq>` → `text/event-stream`: stored events after `seq`, then live events until `done`. Used to reconnect.
- `POST /api/ai/runs/:runId/cancel` → `{ok: true}`. Sets the run's cancel flag; the executor stops before the next model call or tool call and emits `done {stopped: true}`.
- `POST /api/ai/runs/:runId/approvals` body `{requestId, allow}` → `{ok: true}` or 409 if already decided, 404 if unknown, 403 if not the run's owner.

Each SSE message is `data: <json>\n\n` with one event. Idle streams also carry SSE comment lines (`: keep-alive`) every 15 s, which SSE clients ignore.

## Events

Events use the desktop runtime's vocabulary (`desktop/README.md`, `onAgentEvent`), so the chat UI renders both runtimes the same way. Every event is `{id: runId, chatId, seq, type, ...}`, `seq` starting at 1, strictly increasing per run, and stored before it is sent.

| type                   | fields                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| `session`              | `sessionId` (= runId), `agent: "openrouter"`, `model`                         |
| `status`               | `status: "running"\|"awaiting-approval"\|"tool"`                              |
| `assistant-text-delta` | `text`                                                                        |
| `assistant-text`       | `text` (the full text of one assistant message)                               |
| `thinking-delta`       | `text`                                                                        |
| `tool-call`            | `toolCallId`, `name`, `input`                                                 |
| `tool-input-delta`     | `toolCallId`, `delta`                                                         |
| `tool-result`          | `toolCallId`, `name`, `output` (text), `isError`                              |
| `permission-request`   | `requestId`, `toolCallId`, `name`, `input`, `title`                           |
| `permission-resolved`  | `requestId`, `allow`, `reason?` (`"user"`, `"timeout"`, `"cancelled"`)        |
| `usage`                | `inputTokens`, `outputTokens`, `model`                                        |
| `error`                | `message`                                                                     |
| `done`                 | `code` (`"ok"`, `"error"`, `"cancelled"`, `"budget"`), `stopped`, `sessionId` |

## Policy (enforced in the executor, not the prompt)

- Tools come from `toolTable(backend, context)` in `integrations/design-tools.mjs` through the shared cloud backend (`cloud/design-backend.js`, also used by `cloud/mcp.js`). Hosted-unavailable tools (`take_screenshot`, `ask_agent`, `import_html`, `export_document`, design preferences, shell tools) are not offered.
- Read tools run freely. Write tools need `editor` on the room, re-checked before every call (a revoked member is refused mid-run).
- `access: "ask"` (the default): every write tool call raises `permission-request` and waits. An approval is bound to account, run, tool-call id and a hash of the arguments; it can be decided once. Unanswered after 10 minutes, or when the run ends, it is denied. `edit`/`auto`/`full`: writes run without a prompt.
- A write tool call is applied at most once per `(runId, toolCallId)`: a recorded result is returned instead of reapplying.
- Budgets: at most `maxTurns` model turns (TanStack AI `maxIterations`) and `maxToolCalls` tool calls per run (counted by the executor; one turn can call several tools). Exceeding either ends the run with `done {code: "budget"}`.
- Rate limit per account (`AI_LIMIT` binding, same limiter as `MCP_LIMIT`).
- Run, event and approval state lives in the backend database (D1 / SQLite / libSQL), not in process memory, so cancel, approval and reconnect work across instances. A run whose host process dies is not continued; a later request for its events sees it marked `done {code: "error"}` once its lease expires.

## Clients

The chat (legacy runner `web/desktop-panel.js` + chat island `web/src/islands/chat`) runs every turn through one `AgentService` and renders both runtimes with the same transcript, tool cards and approval cards.

- **`AgentService`** (`web/src/lib/agent-service.ts`): `kind` (`desktop` | `web`), `ready()`, `run(options)` → `{id, …}` once the runtime accepted the turn, `cancel(runId)`, `respondPermission({requestId, allow})`, `subscribe(listener)`, `models({agent})`, `discover()`. Events are `{id: runId, chatId, seq, type, …}` in the desktop vocabulary.
  - Desktop: `createDesktopAgentService(window.desktop)` passes calls through to `runAgent`, `cancelAgent`, `respondAgentPermission`, `onAgentEvent`, `listAgentModels`, `discoverAgents` unchanged (`desktop/README.md`).
  - Web: `createWebAgentService(deps)` speaks the HTTP API above. `run` posts `/api/ai/runs` with a new `idempotencyKey` per turn, the open room's id and the chat's earlier turns as `history` (the model API keeps no provider session), and reads the response body as SSE with `fetch` (not `EventSource`: POST plus the session header). The first event names the run. When the stream ends without `done` (network drop, proxy restart), it reconnects with `GET /api/ai/runs/:id/events?after=<lastSeq>` (backoff 0.25–8 s, five tries; before the first event it repeats the POST with the same key, which the server replays) and drops events at or below `lastSeq`. Giving up ends the turn locally with `error` + `done {code: "error"}`. `cancel` posts `/cancel`; `respondPermission` posts `/approvals` for the run that raised the request (409, already decided, is not an error: the run's `permission-resolved` settles the card). Errors of a refused start (400/403/409/429/503) reject `run` with the server's message.
  - Web events gain the desktop field names the runner reads (`normalizeWebEvent`): `tool-call`/`permission-request` → `toolName`, `title`; `tool-input-delta` → `partial`; `tool-result` → `content`; `status`/`error` → `text`; `done.code: "ok"` → `0` and `stopped` for `cancelled`. The server reports each text block twice (deltas, then `assistant-text`); the client drops an `assistant-text` that followed deltas, because on the desktop `assistant-text` means a block that was not streamed.
- **Registration** (`web/src/lib/agent-transport.ts`, `installAgentTransport()` from `web/src/ui.tsx`): `window.verynizePlatform.agents` (`web/platform.js`) holds the service: `provide`, `service()`, `ready()`, `changed()`, `subscribe`. It is deliberately not one of the desktop capabilities (`platform.can("agents")` stays the IPC runtime; `tests/platform-contract.cjs` still checks those against the preload). The desktop registers the IPC service when `can("agents")`; the web always registers the web service, which is `ready()` when the cloud account is signed in on the page's own server and `GET /api/ai/config` (shared query cache, key `["cloud", server, accountId, "ai-config"]`) says `enabled`. Account changes refetch it and notify subscribers; the runner then rebinds its event subscription and re-runs `discover()`.
- **Agent picker**: the runner's `#project-agent` options are the runtime's agents: Claude/Codex on the desktop, only `openrouter` ("OpenRouter") on the web. The model menu shows the server's models (`/api/ai/config` `models`, labels as given) with "OpenRouter default" (the server's `defaultModel`); there is no free-text model id or effort on the web, since the server accepts only its allowlist.
- **Gate** (`web/src/islands/chat/web-gate.tsx`, `#chat-web-gate[data-state]`), shown on the web instead of the composer while a turn cannot start: `signed-out` "Sign in to use chat" (Sign in button), `not-configured` "Model API not configured on this server", `no-room` "Open or share a cloud room to chat with the model API" (Share button), plus `loading`/`error`. The texts keep the three credentials apart: the Verynize account, the server's OpenRouter key, and Claude Code/Codex sign-ins (desktop only). A running turn keeps the composer so Stop still works.
- **Room**: a web turn targets the room the editor has open (`window.cloudWorkspace.room()`, joined through `#room=` or Files), and only when that room lives on the page's server. `web/cloud-panel.js` fires `cloud-room-changed` when the editor joins or leaves a room, and `window.cloudAccount.fetch(path, init)` gives the transport authenticated raw responses (`X-Verynize-Session`).
- **Desktop-only chat features** stay behind their own capabilities and are hidden on the web: repositories/worktrees (header switcher, `git`), the "+" attach menu, slash commands, dropped/pasted images, MCP tools status, account usage ring, autonomy, design style catalog, second opinion. Steering a running turn falls back to the queue on the web.
- **OpenRouter on the desktop is not offered.** The backend refuses browser requests whose `Origin` differs from its own (`app://verynize` would get 403), so the desktop keeps Claude/Codex only. Offering it would need an explicit allowance for the desktop origin on the server.
- **Node web build** (`web-start/node/server.mjs`): the proxy now sends `X-Forwarded-Host`/`X-Forwarded-Proto` to the backend, so a backend that trusts it (`TRUST_PROXY`) sees the public origin and the model API's same-origin check passes for browser requests. Without `TRUST_PROXY` on the backend, browser chat through the Node web build gets 403.

Verified by `tests/web-ai-chat.mjs` (`npm run test:web`): the Node web build in front of the real backend, Chromium, the provider faked: signed-out and not-configured gates, the room gate, joining through `#room=`, streamed text, a read tool call with the room's content, history on the next turn, a dropped connection resumed with `events?after=`, Stop (server run ends `cancelled`) and the model picker. Approval cards on the web are wired (`respondPermission` → `/approvals`, the existing card UI) but not exercised end to end, because the server offers no write tools yet.

## Implementation status

Server modules:

- `cloud/design-backend.js`: `createRoomBackend(env, request, url, account, {roomId?})` (the design-tools backend over rooms; `roomId` scopes it to one room and adds nothing else), `callHostedTool(backend, name, args)`, `hostedToolDefinitions()`, `isReadOnlyTool(definition)`, `accountRooms`, `UNAVAILABLE`, `OVERRIDES`, `HOSTED_INSTRUCTIONS`, `ROOM_ID`. `cloud/mcp.js` uses the same module.
- `cloud/ai.js`: `handleAi(request, env, url, {accountOf, limited, ctx})`, routed from `cloud/worker.js` for `/api/ai/*` (lazy import); `aiConfig(env)`.
- `cloud/ai-executor.js`: `executeRun(options)`, `createEventLog(env, run, {startSeq, onEvent})`, `createRunPolicy({backend})`, `buildSystemPrompt(...)`, `toolOutputText(result)`.
- `cloud/ai-store.js` + migration `0005_ai_runs.sql`: tables `ai_run`, `ai_run_event`, `ai_approval`, `ai_tool_result` (applied by `db:migrate` on D1 and at start-up on Node and Vercel).

Verified (tests, the provider faked by a local OpenAI-compatible server): `tests/cloud-ai.mjs` on workerd, Node and Vercel (`npm run test:cloud`, `test:cloud:node`, `test:cloud:vercel`) and `tests/ai-routing.mjs` (`npm run test:web`). `@tanstack/ai-openrouter` and `@openrouter/sdk` run unchanged in workerd (the Cloudflare bundle), so no OpenAI-compatible fallback adapter is needed. No request has been made to the real OpenRouter API.

Where the implementation is narrower or more specific than the sections above:

- **Read-only tools only.** Write tools are not offered yet, so no permission requests are raised; `access` is validated and stored but has no effect. The approvals endpoint is implemented against `ai_approval` (404/403/409, decided once). Step 4 plugs in through `createRunPolicy`: `offers(definition)` (add write tools), `authorize(call)` (already re-checks the room role and refuses writes below `editor`; an `ask` approval waits here: insert the `ai_approval` row, emit `permission-request`, poll the decision, `denyPending` when the run ends) and `execute(call, run)` (check `getToolResult` first and `recordToolResult` after a write).
- **One room per run.** The backend of a run is scoped to its `roomId`: tools refuse other room ids, `list_documents` shows only that room and `create_document` is not offered.
- **Extra refusals.** 400 for invalid input (`idempotencyKey` is required), 403 for browser requests from another origin and for runs on a room the caller cannot read, 409 when the chat already has a running turn, 429 when more than three turns of the account are running or `AI_LIMIT` (20 new runs per minute per account) is exceeded.
- **Events.** `usage` is sent once per run with the totals, before `done`. A text block is reported (`assistant-text`) before the tool calls that follow it. `done {code: "budget"}` has no extra `error` event; `stopped` is true only for `cancelled`. Images in tool results are replaced by a text note (only `finish_artboard`, a write tool, returns one among hosted tools).
- **Cancel** is polled from the database once a second and before every tool call; the model stream is aborted with the run's `AbortController`.
- **Host lifetime.** The run executes inside the request that started it. Node keeps it running after the client disconnects; Vercel and Cloudflare keep it with `waitUntil` (Vercel `maxDuration` 300 s; Cloudflare allows about 30 s after the response ends). A run cut off this way is closed as `done {code: "error"}` by the next reader once its 30 s lease expires.
- **Auth** is the router's `accountOf`: `Authorization: Bearer` or `X-Verynize-Session`. The Better Auth cookie is not read by `accountOf` today, for these endpoints or the rest of the API.
