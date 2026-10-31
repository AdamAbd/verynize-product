# Model API runtime (TanStack AI)

Status: server side implemented for the read-only vertical (audit steps 1 and 3, `feat/ai-backend`) and for write tools with approvals (step 4, `feat/ai-approvals`); the clients (step 5) are not done yet. See [Implementation status](#implementation-status). Source audit: `docs/audits/2026-10-31-tanstack-start-ai.md`.

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

Optional: `OPENROUTER_BASE_URL` (tests point it at a local fake), `VERYNIZE_AI_MODELS` (comma-separated allowlist `id[=Label]`, first is the default; default `openrouter/auto`), `VERYNIZE_AI_MAX_TURNS` (default 12), `VERYNIZE_AI_MAX_TOOL_CALLS` (default 40), `VERYNIZE_AI_APPROVAL_TIMEOUT_MS` (default 600000, 10 minutes). On Cloudflare the key is a Worker secret (`cf secret put OPENROUTER_API_KEY`) that `cloudflare.config.ts` does not declare, so a deployment without it stays valid.

## HTTP API

All endpoints need a signed-in account (same `accountOf` as the rest of the API: Better Auth cookie/bearer or `X-Verynize-Session`). The account id always comes from the session, never from the request body or the model.

- `GET /api/ai/config` → `{enabled, provider: "openrouter", models: [{id, label}], defaultModel, limits: {maxTurns, maxToolCalls}}`.
- `POST /api/ai/runs` body `{chatId, roomId, prompt, model?, access?: "ask"|"edit"|"auto"|"full", plan?: boolean, helper?: boolean, history?: [{role: "user"|"assistant", text}], designStyle?, idempotencyKey}` → `text/event-stream`. The caller must have at least `viewer` on the room to read and `editor` to write. A repeated `idempotencyKey` for the same account returns the existing run: its stored events are replayed, then the stream follows the run if it is still active (the body of the repeat is ignored; nothing is executed again).
- `GET /api/ai/runs/:runId/events?after=<seq>` → `text/event-stream`: stored events after `seq`, then live events until `done`. Used to reconnect.
- `POST /api/ai/runs/:runId/cancel` → `{ok: true}`. Sets the run's cancel flag; the executor stops before the next model call or tool call and emits `done {stopped: true}`.
- `POST /api/ai/runs/:runId/approvals` body `{requestId, allow, argsHash}` → `{ok: true}`. `argsHash` is the one of the `permission-request`; it is required to approve (optional to deny) and must match the pending call. 400 for a bad body or an approval without `argsHash`, 404 for an unknown run or request, 403 when the run or request belongs to another account, 409 when the request was already decided (replay), the run has ended (or its lease expired), or `argsHash` does not match.

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
| `permission-request`   | `requestId`, `toolCallId`, `name`, `input`, `title`, `argsHash`               |
| `permission-resolved`  | `requestId`, `allow`, `reason?` (`"user"`, `"timeout"`, `"cancelled"`)        |
| `usage`                | `inputTokens`, `outputTokens`, `model`                                        |
| `error`                | `message`                                                                     |
| `done`                 | `code` (`"ok"`, `"error"`, `"cancelled"`, `"budget"`), `stopped`, `sessionId` |

## Policy (enforced in the executor, not the prompt)

- Tools come from `toolTable(backend, context)` in `integrations/design-tools.mjs` through the shared cloud backend (`cloud/design-backend.js`, also used by `cloud/mcp.js`): the same definitions and the same `callHostedTool` path as `/api/mcp`, so a write through a run and through hosted MCP produce the same document. Hosted-unavailable tools (`take_screenshot`, `ask_agent`, `import_html`, `export_document`, design preferences, shell tools) are not offered. `create_document` is not offered either: it creates a room outside the run's one room (a scoped backend refuses it anyway). Every other tool is scoped to the run's room (other room ids are refused).
- Read tools (MCP `readOnlyHint`) run freely. Write tools (every other offered tool) need `editor` on the room, checked before the call and again immediately before it runs, after any approval (a member downgraded below editor gets a refusal as the tool result and the run continues; a member removed from the room gets the refusal and the run ends with `error` + `done {code: "error"}`). The room checks the role a third time when it applies the ops.
- `access: "ask"` (the default): every write tool call, once its arguments pass the schema check, raises `permission-request` (with `argsHash`) and `status: "awaiting-approval"`, and waits. The approval is a row in `ai_approval` bound to the account, the run, the tool-call id and `argsHash` (SHA-256 of the tool name and the canonical JSON of the checked arguments, keys sorted). The executor polls the database for the decision, so the approval may reach any instance. It is decided once: approved → the executor re-checks that the approved hash is the hash of the call it is about to run, then the role, then runs it; denied → the model gets the tool result "The user denied this tool call (denied by user); it was not run."; unanswered after `VERYNIZE_AI_APPROVAL_TIMEOUT_MS` (10 minutes) → denied with `reason: "timeout"` (the model gets a timeout denial); run cancelled or ended → denied with `reason: "cancelled"` (cancel ends the run). Each outcome emits `permission-resolved {requestId, allow, reason}`. `edit`/`auto`/`full`: writes run without a prompt (the role checks still apply).
- The approval state never comes from the client's history: the run, its tool calls and approvals are server state. TanStack AI's approval interrupts (`needsApproval`) are not used: they are ephemeral (decisions come back in client-provided history with no replay protection); the executor waits inside TanStack's `onGuardToolCall` middleware hook instead, which sees the checked arguments.
- A write tool call is applied at most once per `(runId, toolCallId)`: it claims its row in `ai_tool_result` before it runs and stores its output after. A repeat (the model reuses a tool-call id, or a request replays a run) gets the recorded result; a claim whose output was never stored (the instance died mid-call) is reported as interrupted and never run again. A repeated `idempotencyKey` and `events?after=` replay stored events and never execute anything.
- `plan: true` (plan first, like the desktop "plan before edits" setting): write tools are offered but every write call is refused with "Plan first: this run only plans…" (no approval is asked, nothing is applied, whatever `access` says), and the system prompt asks for a numbered plan. The user approves the plan by starting a new run without `plan`.
- `helper: true` (like the desktop's read-only helper runs): no write tool is offered and a write call is refused; no approvals.
- Budgets: at most `maxTurns` model turns (TanStack AI `maxIterations`) and `maxToolCalls` tool calls per run (counted by the executor; one turn can call several tools). Exceeding either ends the run with `done {code: "budget"}`.
- Rate limit per account (`AI_LIMIT` binding, same limiter as `MCP_LIMIT`).
- Run, event and approval state lives in the backend database (D1 / SQLite / libSQL), not in process memory, so cancel, approval and reconnect work across instances. A run whose host process dies is not continued; a later request for its events sees it marked `done {code: "error"}` once its lease expires.

## Clients

- `AgentService` (renderer): `run`, `cancel`, `respondPermission`, `subscribe`, `models`. Desktop implements it over IPC (`window.desktop.runAgent` …), web over the HTTP API above (`web/src/lib/agent-service.ts`).
- The web build gets the `agents` capability from the web transport when `GET /api/ai/config` is enabled and the user is signed in. Claude/Codex stay desktop-only.

## Implementation status

Server modules:

- `cloud/design-backend.js`: `createRoomBackend(env, request, url, account, {roomId?})` (the design-tools backend over rooms; `roomId` scopes it to one room and adds nothing else), `callHostedTool(backend, name, args)`, `hostedToolDefinitions()`, `isReadOnlyTool(definition)`, `accountRooms`, `UNAVAILABLE`, `OVERRIDES`, `HOSTED_INSTRUCTIONS`, `ROOM_ID`. `cloud/mcp.js` uses the same module.
- `cloud/ai.js`: `handleAi(request, env, url, {accountOf, limited, ctx})`, routed from `cloud/worker.js` for `/api/ai/*` (lazy import); `aiConfig(env)`, `approvalTimeout(env)`.
- `cloud/ai-executor.js`: `executeRun(options)`, `createEventLog(env, run, {startSeq, onEvent})`, `createRunPolicy({env, backend, run, emit, setStatus, isCancelled, plan, helper, approvalTimeoutMs})` (`offers`, `authorize`, `recorded`, `approve`, `execute`, `denyPending`), `argsHash(name, args)`, `canonicalJson(value)`, `toolTitle(name, args)`, `ROOM_ESCAPING`, `buildSystemPrompt(...)`, `toolOutputText(result)`.
- `cloud/ai-store.js` + migrations `0005_ai_runs.sql` and `0006_ai_approval_account.sql` (adds `ai_approval.accountId`): tables `ai_run`, `ai_run_event`, `ai_approval`, `ai_tool_result` (applied by `db:migrate` on D1 and at start-up on Node and Vercel).

Verified (tests, the provider faked by a local OpenAI-compatible server that can script read and write tool calls): `tests/cloud-ai.mjs` on workerd, Node and Vercel (`npm run test:cloud`, `test:cloud:node`, `test:cloud:vercel`) and `tests/ai-routing.mjs` (`npm run test:web`). Covered for writes: ask → approve → applied (document valid), ask → deny (not applied; the model's next request carries the denial), approval timeout, cancel while waiting, an orphaned run's pending approval, the endpoint's 400/403/404/409 cases (another account, unknown, `argsHash` mismatch, replay, ended run), at most once on idempotent re-POST, reconnect and a repeated tool-call id, `plan` and `helper` runs, a member downgraded to viewer (refused, run continues) and removed (refused, run ends) while waiting, `edit` access without prompt with a live room socket receiving the ops, and `create_artboard` through `/api/mcp` and through a run on two identical rooms giving equal documents (ids and short ids, random per write, normalized). `@tanstack/ai-openrouter` and `@openrouter/sdk` run unchanged in workerd (the Cloudflare bundle), so no OpenAI-compatible fallback adapter is needed. No request has been made to the real OpenRouter API.

Where the implementation is narrower or more specific than the sections above:

- **Approval waits and host lifetime.** A run waits for an approval inside the request that started it (see Host lifetime below). While the client keeps the stream open that works on every target, but Vercel ends a function after `maxDuration` (300 s), so an approval left longer than about five minutes on Vercel ends the run (closed as `done {code: "error"}` by the next reader; its pending approval is denied with `reason: "cancelled"`). The same applies on Cloudflare about 30 s after the client disconnects. The 10-minute timeout is reached only on Node, or on a host that keeps the request. Resuming a run on another instance after an approval is not implemented.
- **At most once, not exactly once.** A write whose instance dies after it claimed `(runId, toolCallId)` but before its result was stored is reported as interrupted and never retried; whether the room got the edit is not known to the run.
- **Re-POST with another body.** A repeated `idempotencyKey` follows the stored run; a different prompt, `access`, `plan` or `helper` in the repeat is ignored. `plan` and `helper` are not stored with the run.
- **One room per run.** The backend of a run is scoped to its `roomId`: tools refuse other room ids, `list_documents` shows only that room and `create_document` is not offered. Remote images in `create_artboard`/`import_jsx` are fetched by the server (bounded, as in hosted MCP); that is the only network access of write tools.
- **Extra refusals.** 400 for invalid input (`idempotencyKey` is required), 403 for browser requests from another origin and for runs on a room the caller cannot read, 409 when the chat already has a running turn, 429 when more than three turns of the account are running or `AI_LIMIT` (20 new runs per minute per account) is exceeded.
- **Events.** `usage` is sent once per run with the totals, before `done`. A text block is reported (`assistant-text`) before the tool calls that follow it. `done {code: "budget"}` has no extra `error` event; `stopped` is true only for `cancelled`. Images in tool results are replaced by a text note (only `finish_artboard`, a write tool, returns one among hosted tools).
- **Cancel** is polled from the database once a second and before every tool call; the model stream is aborted with the run's `AbortController`.
- **Host lifetime.** The run executes inside the request that started it. Node keeps it running after the client disconnects; Vercel and Cloudflare keep it with `waitUntil` (Vercel `maxDuration` 300 s; Cloudflare allows about 30 s after the response ends). A run cut off this way is closed as `done {code: "error"}` by the next reader once its 30 s lease expires.
- **Auth** is the router's `accountOf`: `Authorization: Bearer` or `X-Verynize-Session`. The Better Auth cookie is not read by `accountOf` today, for these endpoints or the rest of the API.
