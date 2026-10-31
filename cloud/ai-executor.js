// The model API runtime's executor (docs/ai-runtime.md): one run = one TanStack AI chat() loop
// against OpenRouter with the hosted Verynize design tools of one cloud room. Policy is enforced
// here, not in the prompt: the tool set, the room role before every tool call, the turn and tool
// call budgets and cancellation. Events use the desktop runtime's vocabulary and are stored before
// they are sent.
//
// Write tools and approvals (step 4 of the audit) plug in through `policy` (createRunPolicy):
// `offers(definition)` chooses the tools the model sees, `authorize(call)` runs before every tool
// call (role re-check; where an `ask` approval would wait) and `execute(call, run)` runs one call
// (where a recorded result would be returned instead of reapplying a write).
import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { z } from "zod";
import { persona as designPersona } from "../integrations/design-knowledge/persona.mjs";
import { atLeast } from "./http.js";
import {
  HOSTED_INSTRUCTIONS,
  callHostedTool,
  hostedToolDefinitions,
  isReadOnlyTool,
} from "./design-backend.js";
import { appendEvent, finishRun, renewLease, cancelRequested } from "./ai-store.js";

export const DESIGN_STYLE = /^[a-z0-9-]{1,40}$/;
const TICK_MS = 1000;
const RENEW_MS = 5000;
const MAX_OUTPUT = 200_000;

/** Text of an MCP tool result for the model; images cannot be passed on in this runtime. */
export function toolOutputText(result) {
  const parts = (result?.content || []).map((part) =>
    part.type === "text"
      ? part.text
      : `[${part.type}${part.mimeType ? ` ${part.mimeType}` : ""} omitted: this runtime passes text only]`,
  );
  const text = parts.join("\n");
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n[output truncated at ${MAX_OUTPUT} characters]`
    : text;
}

/**
 * Serialized event log of one run: each event gets the next seq, is stored, then handed to
 * `onEvent` (the live SSE stream of the request that started the run, if still connected).
 */
export function createEventLog(env, run, { startSeq = 0, onEvent = () => {} } = {}) {
  let seq = startSeq;
  let chain = Promise.resolve();
  return {
    emit(type, fields = {}) {
      const event = { id: run.id, chatId: run.chatId, seq: ++seq, type, ...fields };
      chain = chain.then(async () => {
        await appendEvent(env, run.id, event);
        onEvent(event);
      });
      return chain;
    },
    flush: () => chain,
  };
}

/**
 * The run's tool policy. Phase 1 (this module): read-only tools only. Every call re-checks the
 * caller's role in the room: without access the run stops; write tools (when offered) need editor.
 */
export function createRunPolicy({ backend }) {
  return {
    offers: (definition) => isReadOnlyTool(definition),
    /** @returns {Promise<{allow: true} | {allow: false, message: string, stop?: boolean}>} */
    async authorize({ definition }) {
      const { role } = await backend.role();
      if (!role)
        return { allow: false, stop: true, message: "You no longer have access to this room." };
      if (!isReadOnlyTool(definition) && !atLeast(role, "editor"))
        return {
          allow: false,
          message: `Your role in this room (${role}) cannot edit; ask an owner for editor access.`,
        };
      return { allow: true };
    },
    /** @returns {Promise<{output: string, isError: boolean}>} */
    async execute({ name, args }) {
      const result = await callHostedTool(backend, name, args);
      if (!result) return { output: `Unknown tool: ${name}`, isError: true };
      return { output: toolOutputText(result), isError: !!result.isError };
    },
  };
}

/** The system prompt: design persona, runtime facts, room context, design style, tool guide. */
export function buildSystemPrompt({ room, role, designStyle, writes }) {
  const lines = [
    designPersona,
    `You are running in Verynize's model API chat. Canvas work goes through the Verynize design tools against one shared cloud room: "${room.title || "Untitled"}" (room id ${room.id}; your role: ${role}). Omit "document" in tool calls or pass that id; other rooms are not reachable from this chat. Collaborators with the room open see changes live.`,
    writes
      ? "Write tools change the room for every collaborator; each call may need the user's approval."
      : "This chat can read the room but not change it: only read tools are available. When the user asks for changes, explain what you would change and say that editing from this chat is not available yet. There is no screenshot tool; inspect elements with get_element_tree and get_element_code.",
  ];
  if (designStyle && DESIGN_STYLE.test(designStyle))
    lines.push(
      `Design style chosen by the user: ${designStyle}. Load it with get_design_guidelines {style: "${designStyle}"} before designing, and follow it unless the user asks otherwise.`,
    );
  lines.push(`Tool guide:\n${HOSTED_INSTRUCTIONS}`);
  return lines.join("\n\n");
}

/**
 * Run one chat turn to completion. Never throws: failures end the run with `error` + `done`.
 * @param {object} options
 * @param {object} options.env bindings (DB for state)
 * @param {object} options.run the ai_run row
 * @param {object} options.backend createRoomBackend(..., {roomId: run.roomId})
 * @param {{id: string, title: string|null}} options.room
 * @param {string} options.role the caller's role at the start
 * @param {string} options.prompt
 * @param {Array<{role: "user"|"assistant", text: string}>} [options.history]
 * @param {string} [options.designStyle]
 * @param {{maxTurns: number, maxToolCalls: number}} options.limits
 * @param {{apiKey: string, baseUrl?: string, origin?: string}} options.provider
 * @param {ReturnType<typeof createEventLog>} options.log
 * @param {ReturnType<typeof createRunPolicy>} [options.policy]
 */
export async function executeRun(options) {
  const {
    env,
    run,
    backend,
    room,
    role,
    prompt,
    history = [],
    designStyle,
    limits,
    provider,
    log,
  } = options;
  const policy = options.policy || createRunPolicy({ backend });
  const emit = log.emit;
  const abortController = new AbortController();
  const state = {
    cancelled: false,
    budget: false,
    error: null,
    toolCalls: 0,
    turnToolCalls: 0,
    lastTurnToolCalls: 0,
    status: null,
    inputTokens: 0,
    outputTokens: 0,
    names: new Map(),
    errors: new Map(),
    texts: new Map(),
  };
  const setStatus = (status) => {
    if (state.status === status) return;
    state.status = status;
    return emit("status", { status });
  };
  const cancel = () => {
    if (state.cancelled) return;
    state.cancelled = true;
    abortController.abort("cancelled");
  };

  // Cancel flag and lease, polled from the database so a cancel from any instance is seen.
  let lastRenew = Date.now();
  let ticking = false;
  const ticker = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const wanted =
        now - lastRenew >= RENEW_MS
          ? ((lastRenew = now), await renewLease(env, run.id, now))
          : await cancelRequested(env, run.id);
      if (wanted) cancel();
    } catch {
      // A transient database error: the next tick retries; the lease has slack.
    } finally {
      ticking = false;
    }
  }, TICK_MS);

  let code = "ok";
  try {
    await emit("session", { sessionId: run.id, agent: "openrouter", model: run.model });
    await setStatus("running");

    const definitions = Object.entries(hostedToolDefinitions()).filter(([, definition]) =>
      policy.offers(definition),
    );
    const tools = definitions.map(([name, definition]) =>
      toolDefinition({
        name,
        description: definition.description,
        inputSchema: z.object(definition.inputSchema).strict(),
      }).server(async (args, context) => {
        if (context?.abortSignal?.aborted) {
          state.errors.set(context.toolCallId, true);
          return "Cancelled.";
        }
        const { output, isError } = await policy.execute(
          { name, args, toolCallId: context?.toolCallId, definition },
          run,
        );
        if (isError) state.errors.set(context?.toolCallId, true);
        return output;
      }),
    );
    const byName = new Map(definitions);

    const middleware = {
      name: "verynize-policy",
      async onBeforeToolCall(_ctx, call) {
        if (state.cancelled || (await cancelRequested(env, run.id))) {
          cancel();
          return { type: "abort", reason: "cancelled" };
        }
        if (state.toolCalls >= limits.maxToolCalls) {
          state.budget = true;
          state.errors.set(call.toolCallId, true);
          return {
            type: "skip",
            result: `Tool call budget reached (${limits.maxToolCalls} per run); the run stops here.`,
          };
        }
        state.toolCalls++;
        const verdict = await policy.authorize({
          name: call.toolName,
          toolCallId: call.toolCallId,
          args: call.args,
          definition: byName.get(call.toolName),
        });
        if (!verdict.allow) {
          state.errors.set(call.toolCallId, true);
          if (verdict.stop) {
            state.error = verdict.message;
            return { type: "abort", reason: verdict.message };
          }
          return { type: "skip", result: verdict.message };
        }
        await setStatus("tool");
      },
      onAfterToolCall(_ctx, info) {
        if (!info.ok) state.errors.set(info.toolCallId, true);
      },
      onShouldContinue() {
        if (state.budget || state.cancelled || state.error) return false;
      },
      async onIteration(_ctx, info) {
        if (info.iteration > 0) await setStatus("running");
      },
    };

    const messages = [
      ...history.map((item) => ({ role: item.role, content: item.text })),
      { role: "user", content: prompt },
    ];
    const stream = chat({
      adapter: createOpenRouterText(run.model, provider.apiKey, {
        ...(provider.baseUrl ? { serverURL: provider.baseUrl } : {}),
        ...(provider.origin ? { httpReferer: provider.origin } : {}),
        appTitle: "Verynize",
      }),
      threadId: run.chatId,
      runId: run.id,
      systemPrompts: [buildSystemPrompt({ room, role, designStyle, writes: false })],
      messages,
      tools,
      toolExecution: "sequential",
      agentLoopStrategy: maxIterations(limits.maxTurns),
      abortController,
      middleware: [middleware],
      debug: false,
    });

    for await (const chunk of stream) {
      switch (chunk.type) {
        case "TEXT_MESSAGE_CONTENT":
          if (chunk.delta) {
            state.texts.set(
              chunk.messageId,
              (state.texts.get(chunk.messageId) || "") + chunk.delta,
            );
            await emit("assistant-text-delta", { text: chunk.delta });
          }
          break;
        case "TEXT_MESSAGE_END": {
          const text = state.texts.get(chunk.messageId);
          state.texts.delete(chunk.messageId);
          if (text) await emit("assistant-text", { text });
          break;
        }
        case "REASONING_MESSAGE_CONTENT":
          if (chunk.delta) await emit("thinking-delta", { text: chunk.delta });
          break;
        case "TOOL_CALL_START":
          // The text before a tool call is complete: report it before the call, as on desktop.
          for (const [messageId, text] of state.texts) {
            state.texts.delete(messageId);
            if (text) await emit("assistant-text", { text });
          }
          state.names.set(chunk.toolCallId, chunk.toolCallName);
          state.turnToolCalls++;
          break;
        case "TOOL_CALL_ARGS":
          if (chunk.delta)
            await emit("tool-input-delta", { toolCallId: chunk.toolCallId, delta: chunk.delta });
          break;
        case "TOOL_CALL_END":
          await emit("tool-call", {
            toolCallId: chunk.toolCallId,
            name: state.names.get(chunk.toolCallId) || chunk.toolCallName || "",
            input: chunk.input ?? {},
          });
          break;
        case "TOOL_CALL_RESULT": {
          const isError = state.errors.get(chunk.toolCallId) === true;
          let output =
            typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
          if (isError)
            try {
              const parsed = JSON.parse(output);
              if (typeof parsed?.error === "string") output = parsed.error;
            } catch {}
          await emit("tool-result", {
            toolCallId: chunk.toolCallId,
            name: state.names.get(chunk.toolCallId) || "",
            output,
            isError,
          });
          break;
        }
        case "RUN_FINISHED":
          state.inputTokens += chunk.usage?.promptTokens || 0;
          state.outputTokens += chunk.usage?.completionTokens || 0;
          state.lastTurnToolCalls = state.turnToolCalls;
          state.turnToolCalls = 0;
          break;
        case "RUN_ERROR":
          state.error ||= chunk.error?.message || chunk.message || "The model request failed";
          break;
      }
    }
    if (state.cancelled) code = "cancelled";
    else if (state.error) code = "error";
    // The loop ended while the model still wanted tools: a budget stopped it.
    else if (state.budget || state.lastTurnToolCalls > 0) code = "budget";
  } catch (error) {
    if (state.cancelled) code = "cancelled";
    else {
      code = "error";
      state.error ||= error?.message || String(error);
    }
  } finally {
    clearInterval(ticker);
  }

  try {
    await log.flush().catch(() => {});
    if (state.inputTokens || state.outputTokens)
      await emit("usage", {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        model: run.model,
      });
    if (code === "error") await emit("error", { message: state.error });
    await emit("done", { code, stopped: code === "cancelled", sessionId: run.id });
    await finishRun(env, run.id, code);
  } catch (error) {
    // The events could not be stored (the database is unreachable, or another reader finished
    // this run after its lease expired). The lease runs out and the next reader closes the run.
    console.error("ai run could not finish", run.id, error?.message);
  }
  return code;
}
