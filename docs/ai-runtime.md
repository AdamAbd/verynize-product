# Model API runtime (TanStack AI)

Status: in progress on `feat/ai-runtime`. Source audit: `docs/audits/2026-10-31-tanstack-start-ai.md`.

Verynize chat has two kinds of runtime:

| Runtime | Where it runs | Agents | Tools |
|---|---|---|---|
| Local coding agents | Desktop main process (`desktop/agent-runtime.cjs`) | `claude`, `codex` | Local MCP bridge, shell tools, the agent's own coding tools |
| Model API (`api-model`) | Cloud backend (`cloud/ai.js`, `/api/ai/*`) | `openrouter` (TanStack AI `@tanstack/ai-openrouter`) | Verynize design tools against a cloud room |

The model API runtime does not replace Claude/Codex. It gives the web build (and any signed-in client) a chat that edits shared rooms through the same tool table as the hosted MCP server.

## Ownership of `/api/ai/*`

The cloud backend (`cloud/worker.js`) owns `/api/ai/*` on every target, like the rest of `/api/*`. Start never serves `/api/ai/*`. Reasons: the backend already has the session, room membership, rate limits and per-platform storage on Cloudflare, Node and Vercel, and Start is not deployed on Vercel. No change to `web-start/worker-paths.mjs`, `runWorkerFirst`, or `vercel.json` is needed. `tests/ai-routing.mjs` asserts that `/api/ai/*` reaches the backend on all three targets.

## Credentials

`OPENROUTER_API_KEY` is a server secret (Worker secret / environment variable). It never reaches the browser bundle. Without it, `GET /api/ai/config` reports `enabled: false` and run requests answer 503. Being signed in to Claude Code or Codex says nothing about OpenRouter, and vice versa. The UI shows the two separately.

Optional: `OPENROUTER_BASE_URL` (tests point it at a local fake), `VERYNIZE_AI_MODELS` (comma-separated allowlist, first is the default).

## HTTP API

All endpoints need a signed-in account (same `accountOf` as the rest of the API: Better Auth cookie/bearer or `X-Verynize-Session`). The account id always comes from the session, never from the request body or the model.

- `GET /api/ai/config` → `{enabled, provider: "openrouter", models: [{id, label}], defaultModel, limits: {maxTurns, maxToolCalls}}`.
- `POST /api/ai/runs` body `{chatId, roomId, prompt, model?, access?: "ask"|"edit"|"auto"|"full", history?: [{role: "user"|"assistant", text}], designStyle?, idempotencyKey}` → `text/event-stream`. The caller must have at least `viewer` on the room to read and `editor` to write. A repeated `idempotencyKey` for the same account returns the existing run: its stored events are replayed, then the stream follows the run if it is still active.
- `GET /api/ai/runs/:runId/events?after=<seq>` → `text/event-stream`: stored events after `seq`, then live events until `done`. Used to reconnect.
- `POST /api/ai/runs/:runId/cancel` → `{ok: true}`. Sets the run's cancel flag; the executor stops before the next model call or tool call and emits `done {stopped: true}`.
- `POST /api/ai/runs/:runId/approvals` body `{requestId, allow}` → `{ok: true}` or 409 if already decided, 404 if unknown, 403 if not the run's owner.

Each SSE message is `data: <json>\n\n` with one event.

## Events

Events use the desktop runtime's vocabulary (`desktop/README.md`, `onAgentEvent`), so the chat UI renders both runtimes the same way. Every event is `{id: runId, chatId, seq, type, ...}`, `seq` starting at 1, strictly increasing per run, and stored before it is sent.

| type | fields |
|---|---|
| `session` | `sessionId` (= runId), `agent: "openrouter"`, `model` |
| `status` | `status: "running"\|"awaiting-approval"\|"tool"` |
| `assistant-text-delta` | `text` |
| `assistant-text` | `text` (the full text of one assistant message) |
| `thinking-delta` | `text` |
| `tool-call` | `toolCallId`, `name`, `input` |
| `tool-input-delta` | `toolCallId`, `delta` |
| `tool-result` | `toolCallId`, `name`, `output` (text), `isError` |
| `permission-request` | `requestId`, `toolCallId`, `name`, `input`, `title` |
| `permission-resolved` | `requestId`, `allow`, `reason?` (`"user"`, `"timeout"`, `"cancelled"`) |
| `usage` | `inputTokens`, `outputTokens`, `model` |
| `error` | `message` |
| `done` | `code` (`"ok"`, `"error"`, `"cancelled"`, `"budget"`), `stopped`, `sessionId` |

## Policy (enforced in the executor, not the prompt)

- Tools come from `toolTable(backend, context)` in `integrations/design-tools.mjs` through the shared cloud backend (`cloud/design-backend.js`, also used by `cloud/mcp.js`). Hosted-unavailable tools (`take_screenshot`, `ask_agent`, `import_html`, `export_document`, design preferences, shell tools) are not offered.
- Read tools run freely. Write tools need `editor` on the room, re-checked before every call (a revoked member is refused mid-run).
- `access: "ask"` (the default): every write tool call raises `permission-request` and waits. An approval is bound to account, run, tool-call id and a hash of the arguments; it can be decided once. Unanswered after 10 minutes, or when the run ends, it is denied. `edit`/`auto`/`full`: writes run without a prompt.
- A write tool call is applied at most once per `(runId, toolCallId)`: a recorded result is returned instead of reapplying.
- Budgets: at most `maxTurns` model turns (TanStack AI `maxIterations`) and `maxToolCalls` tool calls per run (counted by the executor; one turn can call several tools). Exceeding either ends the run with `done {code: "budget"}`.
- Rate limit per account (`AI_LIMIT` binding, same limiter as `MCP_LIMIT`).
- Run, event and approval state lives in the backend database (D1 / SQLite / libSQL), not in process memory, so cancel, approval and reconnect work across instances. A run whose host process dies is not continued; a later request for its events sees it marked `done {code: "error"}` once its lease expires.

## Clients

- `AgentService` (renderer): `run`, `cancel`, `respondPermission`, `subscribe`, `models`. Desktop implements it over IPC (`window.desktop.runAgent` …), web over the HTTP API above (`web/src/lib/agent-service.ts`).
- The web build gets the `agents` capability from the web transport when `GET /api/ai/config` is enabled and the user is signed in. Claude/Codex stay desktop-only.
