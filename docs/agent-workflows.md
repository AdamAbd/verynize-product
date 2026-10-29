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
- **Quick chats** are chats with no repository. They run in a per-chat scratch directory, `userData/agent-workdirs/<chatId>`. **Repository chats** (Code workspace) each run in their own git worktree, `<Verynize folder>/workspaces/<repo>/<name>` (default `~/Verynize`) on branch `<prefix>/<name>` (the Settings › Agents branch prefix, else the GitHub username, else `verynize`; see `desktop/repositories.cjs`); the renderer passes the chat's folder as `runAgent({root})` and main validates it against the repository registry. Folders without a commit, and chats saved before worktrees existed, run in the repository root. Project memory (`VERYNIZE.md`) and the user's personal instructions are appended to the persona: Claude's `append`, or Codex's `developerInstructions`.
- At most three turns run per window, and only one per chat.

## Access levels

| Level | Claude `permissionMode` | Codex `approvalPolicy` / `sandbox` |
|---|---|---|
| Ask | `default` (each tool prompt becomes an approval card) | `untrusted` / `read-only` |
| Edit | `acceptEdits` | `on-request` / `workspace-write` |
| Auto | `auto` | `on-request` / `workspace-write`, `approvalsReviewer: auto_review` |
| Full | `bypassPermissions` (+ `allowDangerouslySkipPermissions`) | `never` / `danger-full-access` |

Older saved defaults map forward: `read-only` becomes Ask and `workspace-write` becomes Edit. An unanswered approval card is denied after 10 minutes, and when the turn ends.

## Access switches (Settings › Agents › Access)

`desktop/agent-access.cjs` stores eight switches in `userData/agent-access.json`. The runtime reads them at the start of every turn, so changes apply when a chat's agent next starts.

| Switch (default) | Effect |
|---|---|
| Create files, folders and pages (on) | Persona tells the agent to create what it needs. Off: the persona says to ask first, and Claude gets a `PreToolUse` hook that raises an approval card for `Write`/`NotebookEdit` on a new path, `mkdir`/`touch`, and `create_page`/`create_document` (except at Full access). Codex gets the persona instruction only. |
| Share memory (on) | The other agent's files are appended to the persona: for Claude, `~/.codex/AGENTS.md`, the project `AGENTS.md` and `~/.codex/memories/*.md`; for Codex, `~/.claude/CLAUDE.md`, the project `CLAUDE.md` and Claude's auto memory `~/.claude/projects/<slug>/memory/MEMORY.md`. Bounded to 12,000 characters. |
| Ask other agents (off) | Gates the `ask_agent` canvas tool: `primaryRuntime.askTool()` refuses while off, Claude gets `disallowedTools: mcp__verynize__ask_agent`, Codex gets `-c mcp_servers.verynize.disabled_tools=["ask_agent"]`. The user's own **Second opinion** action is not affected. |
| Claude connectors (on) | Off: `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the Claude child environment. |
| Claude artifacts (on) | Off: `CLAUDE_CODE_DISABLE_ARTIFACT=1` and `disallowedTools` `Artifact`, `ArtifactComments`, `ArtifactData`, `ArtifactCheck`. |
| Chrome in Claude chats (off) | SDK `extraArgs` `--chrome` / `--no-chrome` (CLI fallback gets the same flag). |
| ChatGPT apps in Codex (on) | `codex app-server --enable apps` / `--disable apps`. |
| Computer Use in Codex (off) | `--enable computer_use` / `--disable computer_use`. Turning it off cancels running Codex chats that started with it. |

The Codex app-server is keyed by its launch flags, so a changed switch starts a fresh server once no Codex chat is running on the old one. Flag names were checked against Claude Code 2.1.308 (`claude --help`, binary strings) and codex-cli 0.165 (`codex features list`, `codex app-server --print-startup-config`).

## Settings › Agents behaviour

`desktop/agent-behavior.cjs` stores the lower half of Settings › Agents (`userData/agent-behavior.json`) and the runtime reads it per run:
- **Follow-up messages** (Steer | Queue, default Queue): while a turn runs, Send goes the default way and ⌘↵ the other way (`web/desktop-panel.js`). A steer the runtime cannot take falls back to the queue.
- **Expand agent work by default**: turn headers, tool groups and tool calls render unfolded (`web/src/islands/chat/transcript.tsx`).
- **Claude response style**: "Use my Claude Code setting" sends nothing; a chosen style is SDK `settings.outputStyle`. **Codex personality** None sends `personality:"none"` on `thread/start` (new chats only).
- **Credit the agent** off sends Claude `settings.attribution = {commit:'', pr:''}` (and `includeCoAuthoredBy:false`). Codex follows its own (ChatGPT) setting.
- **Mode for new chats**: the Default row is the chat defaults' access (the same value as Default Models › Access); a repository's own pick is stored per repository id and applied as `chat.access` when a new chat starts there. The composer's mode picker then changes that chat only.
- **Allowed without asking** lists and removes Verynize, Claude Code and Codex rules (see `desktop/README.md`).

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

### Shell tools and access levels

The bridge also serves bridge-only shell tools: `get_dev_server`, `start_dev_server`, `stop_dev_server`, `configure_dev_server`, `preview_open`, `preview_snapshot`, `preview_screenshot`, `preview_click`, `preview_type`, `preview_scroll`, `preview_console`, `capture_preview_to_canvas`, `run_terminal_command`, `read_terminal` and `execute_action`. They are described in `desktop/README.md`. The stdio server without the app answers them with a "needs the desktop app" error.

Exec tools (start/configure dev server, terminal commands) follow the chat's access level when the request carries `x-verynize-access`:
- `auto` and `full` run them without asking.
- `ask` and `edit` show a native approval dialog.
- `readonly` (helper agents) refuses every tool that changes the app or runs something.

Requests without the header are treated like Ask. The runtime does not send this header yet, so every in-app chat currently gets the approval dialog for exec tools. Two follow-ups for `desktop/agent-runtime.cjs` / `agent-settings.cjs`:
- add the header to `claudeMcpServer()` headers and to the Codex MCP config, set per access level
- add the shell tools to `HELPER_BLOCKED_DESIGN_TOOLS` or send `readonly` for `ask_agent` helpers

Until then, the read-only helper is protected only by the approval dialog. `VERYNIZE_SHELL_EXEC=0` or `setBridgeOptions({shellExec:false})` turns exec tools off entirely.

## Events and UI

Main sends typed events on `desktop:agent-event`. Each one has `{id, chatId, seq, type}`. The types are:
- `session`, `status`
- `assistant-text-delta`, `assistant-text`, `thinking-delta`
- `tool-call`, `tool-input-delta`, `tool-result`
- `permission-request`, `permission-resolved`
- `usage`, `error`
- `done {code, stopped, sessionId, resumeAt?}`. `resumeAt` is the fork point of the finished turn: Claude's last main-chain transcript entry uuid, or the Codex turn id.

Translators live in `desktop/agent-runtime-events.cjs`, one each for SDK messages, app-server notifications and `exec --json` lines. The renderer (`web/desktop-panel.js`) handles them as follows:
- It streams text and re-renders only the active reply, at most once per frame.
- Thinking shows in a collapsible block. Tool calls show as collapsible cards with input (partial JSON while streaming) and result. Permission requests show as Allow/Deny cards.
- **Stop** interrupts the turn.
- Each conversation stores the provider `sessionId`. A follow-up with the same agent in the same project passes `sessionId` to resume the native session, and the saved transcript is not re-sent. Switching agents, or **Continue from here** (a transcript branch), starts a new session seeded with the last eight messages. Files are never reverted.
- **Rewind** (Restore / Rewind to here, Retry, Edit) truncates the chat before a user message. Each reply stores `resumePoint {sessionId, at}` from its `done` event, so the next turn passes `fork: {sessionId, at}` for the last kept reply. Claude resumes a forked copy of the session cut there (`resume` + `resumeSessionAt` + `forkSession`), after checking with `getSessionMessages` that the entry exists. Codex calls `thread/fork` with `lastTurnId`. If the fork point is missing or refused, the transcript `seed` sent with it is used instead. The canvas is restored only when a canvas checkpoint exists. Files are not reverted.
- **Second opinion** (a reply action) sends the reply, the user request before it, and the project's `git status --short` and `git diff HEAD` to the other provider through `reviewAgent`. It runs as the read-only helper used by `ask_agent`: Claude gets only Read/Glob/Grep, and Codex gets a `read-only` sandbox, `never` approvals and canvas edit tools disabled. If the other provider is not installed, the installed one answers. The review is added to the chat as a separate assistant message.
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

`BD_LIVE_AGENTS=1 node --test tests/agent-runtime-live.cjs` runs one real turn per installed provider through the runtime module. Each turn uses Ask access, a small model, low effort and a temporary quick-chat folder. The test checks the event shape, streamed text, usage and `resumeAt`. It also starts a throwaway loopback MCP server and checks that the provider connected with the bearer token and listed its tool. Fork points are checked without a model call. Set `BD_LIVE_AGENTS_REWIND=1` to also run one forked turn per provider, or set `BD_LIVE_AGENTS_ONLY=claude|codex` to test only one provider.

## Documentation

- Claude Agent SDK, checked through Context7 (`/websites/code_claude_en_agent-sdk`): `Options`, `PermissionMode`, `mcpServers` HTTP headers, `includePartialMessages`, `resume`. Also checked against the installed `sdk.d.ts` (0.3.312): `pathToClaudeCodeExecutable`, `canUseTool`, `interrupt()`, `supportedModels()`, `close()`.
- Codex app-server: `codex app-server generate-ts`, for `ThreadStartParams`, `TurnStartParams`, `TurnInterruptParams`, `ServerNotification` and `ServerRequest`.
