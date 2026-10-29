# Local agent workspace

The chat panel (docked transcript, model picker, access levels, attachments and quick chats) runs the agents installed on this Mac with their existing accounts. The behavior follows `docs/wonder-ai-mcp-spec.md` §2; the code and all prompt text are our own.

## Runtime

`desktop/agent-runtime.cjs` owns chat turns. `desktop/main.cjs` registers it with `registerAgentRuntime(handle, win, {userData, getProject})`.

- **Claude** uses `@anthropic-ai/claude-agent-sdk` `query()`. `pathToClaudeCodeExecutable` points at the discovered `claude`, so the user's Claude Code install and login are used; if Claude Code is missing, the SDK's bundled runtime is used. Options:
  - `systemPrompt: {type:'preset', preset:'claude_code', append: <Verynize persona>}`
  - `includePartialMessages: true`, which streams text, thinking and tool-argument deltas
  - `resume: <sessionId>` to continue a conversation
  - `permissionMode` from the access level
  - `mcpServers` (described below)
  - `canUseTool`, which routes approval prompts to the chat
  
  The prompt is a streaming-input iterable that stays open until the turn's `result` arrives, so `Query.interrupt()` works for **Stop**. Pasted images go inline as base64 image blocks, and their saved paths are also listed in the context block. If the SDK cannot be loaded, the runtime falls back to `claude --print --output-format stream-json --include-partial-messages` with `--resume`, `--append-system-prompt` and `--mcp-config`.
- **Codex** uses `codex app-server` JSON-RPC when `codex app-server --help` succeeds. Verified against codex-cli 0.165 using `codex app-server generate-ts`. The protocol flow:
  1. `initialize`, then `initialized`
  2. `thread/start`, or `thread/resume` when the chat has a thread id (a failed resume starts a fresh thread)
  3. `turn/start` with text plus `localImage` inputs and `model`/`effort`
  4. `turn/interrupt` for **Stop**
  
  One app-server process per window serves every chat thread. Approval server-requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, MCP elicitations) become approval cards. If app-server is unavailable, the one-shot `codex exec --json` runner in `desktop/agents.cjs` is used instead.
- **Quick chats** are chats with no project open. They run in a per-chat scratch directory, `userData/agent-workdirs/<chatId>`. Project chats run in the project root. Project memory (`VERYNIZE.md`) and the user's personal instructions are appended to the persona: Claude's `append`, or Codex's `developerInstructions`.
- At most three turns run per window, and only one per chat.

## Access levels

| Level | Claude `permissionMode` | Codex `approvalPolicy` / `sandbox` |
|---|---|---|
| Ask | `default` (each tool prompt becomes an approval card) | `untrusted` / `read-only` |
| Edit | `acceptEdits` | `on-request` / `workspace-write` |
| Auto | `auto` | `on-request` / `workspace-write`, `approvalsReviewer: auto_review` |
| Full | `bypassPermissions` (+ `allowDangerouslySkipPermissions`) | `never` / `danger-full-access` |

Older saved defaults map forward: `read-only` becomes Ask and `workspace-write` becomes Edit. An unanswered approval card is denied after 10 minutes, and when the turn ends.

## Per-turn context

Each prompt is prefixed with a `<verynize-context>` block. When **Send canvas context** is on, it holds:
- the open document's name, its library id and its saved path
- the active page name and `pageId`
- the selected element **ids only**
- the paths of attached images

Image paths are accepted only under `userData/agent-attachments/<chatId>/`. Pasted or picked images are saved there by `saveAgentImage`, after their magic bytes are checked against PNG, JPEG, GIF and WebP. The persona tells the agent to fetch content through the `verynize` MCP tools and to pass the given `pageId`.

## MCP bridge

`desktop/mcp-bridge.cjs` exposes `getBridgeInfo() -> {url, token}` for the loopback Streamable HTTP server. The runtime loads it lazily with `require` inside `try`, so chat keeps working without it.
- **Claude** gets `mcpServers['verynize'] = {type:'http', url, headers:{Authorization:'Bearer …'}}` and `allowedTools: ['mcp__verynize__*']`.
- **Codex** gets `-c mcp_servers.verynize.url="…"` and `-c mcp_servers.verynize.bearer_token_env_var="VERYNIZE_MCP_TOKEN"`. The token goes in the child environment, never in argv.

Only loopback URLs are wired.

## Events and UI

Main sends typed events on `desktop:agent-event`. Each one has `{id, chatId, seq, type}`. The types are:
- `session`, `status`
- `assistant-text-delta`, `assistant-text`, `thinking-delta`
- `tool-call`, `tool-input-delta`, `tool-result`
- `permission-request`, `permission-resolved`
- `usage`, `error`
- `done {code, stopped, sessionId}`

Translators live in `desktop/agent-runtime-events.cjs`, one each for SDK messages, app-server notifications and `exec --json` lines. The renderer (`web/desktop-panel.js`) handles them as follows:
- It streams text and re-renders only the active reply, at most once per frame.
- Thinking shows in a collapsible block. Tool calls show as collapsible cards with input (partial JSON while streaming) and result. Permission requests show as Allow/Deny cards.
- **Stop** interrupts the turn.
- Each conversation stores the provider `sessionId`. A follow-up with the same agent in the same project passes `sessionId` to resume the native session, and the saved transcript is not re-sent. Switching agents, or **Continue from here** (a transcript branch), starts a new session seeded with the last eight messages. Files are never reverted.
- The model field is free text, with suggestions from Claude `supportedModels()` or Codex `model/list`.

Transcripts, including tool and permission parts, persist per project in `localStorage`. Runs that were in progress when the app closed are shown as interrupted when reloaded.

Usage counters are local task counts, not subscription limits or billing.

## Verification

- `node --test tests/agent-options.cjs` checks:
  - the access-level mapping
  - the fallback argv, including resume, MCP config and the token kept out of argv
  - the fallback runner's typed events, using a real temporary executable
- `node --test tests/agent-runtime.cjs` checks:
  - the context block and the persona
  - the SDK options
  - the Claude runtime against a scripted fake `query()`: streaming, tool cards, the Ask-mode permission round-trip, MCP headers, inline images, resume and interrupt
  - the Codex runtime against `tests/fixtures/fake-codex.cjs`: app-server JSON-RPC, approvals, MCP `-c` flags and env token, resume, a missing thread, interrupt and `model/list`
  - the exec fallback
  
  It also has a real Claude smoke test, which runs only with `VERYNIZE_REAL_AGENT_SMOKE=1`.
- `node tests/agent-chat.cjs` drives Electron against the fake Codex app-server. It covers:
  - a quick chat in a scratch folder
  - streaming and tool cards
  - the context block
  - a project chat that resumes its session
  - the approval card
  - Stop
  - branching, docking and persistence

No test calls a real model unless the smoke flag is set.

## Documentation

- Claude Agent SDK, checked through Context7 (`/websites/code_claude_en_agent-sdk`): `Options`, `PermissionMode`, `mcpServers` HTTP headers, `includePartialMessages`, `resume`. Also checked against the installed `sdk.d.ts` (0.3.312): `pathToClaudeCodeExecutable`, `canUseTool`, `interrupt()`, `supportedModels()`, `close()`.
- Codex app-server: `codex app-server generate-ts`, for `ThreadStartParams`, `TurnStartParams`, `TurnInterruptParams`, `ServerNotification` and `ServerRequest`.
