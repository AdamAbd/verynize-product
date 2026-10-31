// Model API runtime HTTP endpoints (/api/ai/*; contract in docs/ai-runtime.md). The cloud backend
// owns these paths on every target (Cloudflare, Node, Vercel). A run is one chat turn executed by
// cloud/ai-executor.js with TanStack AI against OpenRouter and the hosted design tools of one room
// (cloud/design-backend.js); its state lives in the database (cloud/ai-store.js).
//
//   GET  /api/ai/config                       {enabled, provider, models, defaultModel, limits}
//   POST /api/ai/runs                         start (or replay, by idempotencyKey) → SSE
//   GET  /api/ai/runs/:id/events?after=<seq>  stored events after seq, then live → SSE
//   POST /api/ai/runs/:id/cancel              {ok: true}
//   POST /api/ai/runs/:id/approvals           {requestId, allow} → {ok: true} | 404 | 403 | 409
//
// Every endpoint needs a signed-in account (the router's accountOf); the account never comes from
// the request body or the model.
import { corsHeaders, readJson, json, fail } from "./http.js";
import { createRoomBackend, ROOM_ID } from "./design-backend.js";
import {
  activeRuns,
  claimExpired,
  createRun,
  decideApproval,
  eventsAfter,
  getApproval,
  getRun,
  lastSeq,
  appendEvent,
  requestCancel,
  runByKey,
} from "./ai-store.js";
import { DESIGN_STYLE, createEventLog, executeRun } from "./ai-executor.js";

export const AI_PREFIX = "/api/ai/";
const RUN_ROUTE = /^\/api\/ai\/runs\/([0-9a-f-]{36})\/(events|cancel|approvals)$/;
const ACCESS = ["ask", "edit", "auto", "full"];
const DEFAULT_MODELS = "openrouter/auto=Auto (OpenRouter)";
const DEFAULT_LIMITS = { maxTurns: 12, maxToolCalls: 40 };
const MAX_BODY = 1024 * 1024;
const MAX_PROMPT = 50_000;
const MAX_HISTORY = 50;
const MAX_HISTORY_TEXT = 20_000;
const MAX_ACTIVE_RUNS = 3;
const POLL_MS = 400;
const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

/** The runtime configuration from the bindings: `VERYNIZE_AI_MODELS` is "id[=Label],…". */
export function aiConfig(env) {
  const models = String(env.VERYNIZE_AI_MODELS || DEFAULT_MODELS)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...label] = entry.split("=");
      return { id: id.trim(), label: label.join("=").trim() || id.trim() };
    })
    .filter((model) => /^[\w.:/-]{1,120}$/.test(model.id));
  return {
    enabled: !!env.OPENROUTER_API_KEY && models.length > 0,
    provider: "openrouter",
    models,
    defaultModel: models[0]?.id || null,
    limits: {
      maxTurns: positive(env.VERYNIZE_AI_MAX_TURNS, DEFAULT_LIMITS.maxTurns),
      maxToolCalls: positive(env.VERYNIZE_AI_MAX_TOOL_CALLS, DEFAULT_LIMITS.maxToolCalls),
    },
  };
}

const sseHeaders = {
  ...corsHeaders,
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
};
const frame = (event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
const heartbeat = encoder.encode(": keep-alive\n\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The SSE stream of a run that this request executes: events arrive from the executor in order
 * (after they are stored). A client that goes away does not stop the run; it reconnects with
 * GET /events?after=.
 */
function liveStream() {
  let controller;
  let open = true;
  let timer;
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    try {
      controller.close();
    } catch {}
  };
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      timer = setInterval(() => {
        try {
          if (open) controller.enqueue(heartbeat);
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      open = false;
      clearInterval(timer);
    },
  });
  return {
    stream,
    send(event) {
      if (!open) return;
      try {
        controller.enqueue(frame(event));
      } catch {
        open = false;
        clearInterval(timer);
      }
      if (event.type === "done") close();
    },
    close,
  };
}

/**
 * Finish a run whose executing instance stopped renewing its lease: it is marked done and gets
 * `error` + `done {code: "error"}` events, once, by whichever reader claims it first.
 */
async function closeExpired(env, run) {
  if (!(await claimExpired(env, run.id))) return;
  let seq = await lastSeq(env, run.id);
  const base = { id: run.id, chatId: run.chatId };
  await appendEvent(env, run.id, {
    ...base,
    seq: ++seq,
    type: "error",
    message: "The run stopped: the server running it went away.",
  });
  await appendEvent(env, run.id, {
    ...base,
    seq: ++seq,
    type: "done",
    code: "error",
    stopped: false,
    sessionId: run.id,
  });
}

/**
 * The SSE stream of a stored run: events after `after`, then new ones as they are stored (polled
 * from the database, so the run may execute on another instance) until `done`.
 */
function followStream(env, runId, after) {
  let open = true;
  return new ReadableStream({
    async start(controller) {
      let last = after;
      let quietSince = Date.now();
      try {
        while (open) {
          const events = await eventsAfter(env, runId, last);
          for (const event of events) {
            controller.enqueue(frame(event));
            last = event.seq;
            if (event.type === "done") {
              open = false;
              break;
            }
          }
          if (!open) break;
          if (events.length) {
            quietSince = Date.now();
            continue;
          }
          const run = await getRun(env, runId);
          if (!run) break;
          if (run.status === "running" && run.leaseUntil < Date.now()) await closeExpired(env, run);
          else if (run.status === "done" && !(await eventsAfter(env, runId, last, 1)).length) break;
          if (Date.now() - quietSince >= HEARTBEAT_MS) {
            controller.enqueue(heartbeat);
            quietSince = Date.now();
          }
          await sleep(POLL_MS);
        }
        controller.close();
      } catch {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      open = false;
    },
  });
}

function validRunRequest(body, config) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Body must be an object");
  const { chatId, roomId, prompt, model, access, history, designStyle, idempotencyKey } = body;
  if (typeof chatId !== "string" || !/^[\w.:-]{1,128}$/.test(chatId))
    fail(400, "chatId must be 1-128 letters, digits, _ . : or -");
  if (typeof roomId !== "string" || !ROOM_ID.test(roomId)) fail(400, "roomId must be a room id");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT)
    fail(400, `prompt must be text of at most ${MAX_PROMPT} characters`);
  if (typeof idempotencyKey !== "string" || !/^[\w.:-]{8,128}$/.test(idempotencyKey))
    fail(400, "idempotencyKey must be 8-128 letters, digits, _ . : or -");
  const chosen = model === undefined || model === null ? config.defaultModel : model;
  if (!config.models.some((entry) => entry.id === chosen))
    fail(400, `model must be one of: ${config.models.map((entry) => entry.id).join(", ")}`);
  if (access !== undefined && !ACCESS.includes(access))
    fail(400, `access must be one of: ${ACCESS.join(", ")}`);
  if (designStyle !== undefined && designStyle !== null && !DESIGN_STYLE.test(String(designStyle)))
    fail(400, "designStyle must be a style slug");
  if (history !== undefined && !Array.isArray(history)) fail(400, "history must be an array");
  const turns = (history || []).slice(-MAX_HISTORY).map((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.text !== "string")
      fail(400, 'history items are {role: "user"|"assistant", text}');
    return { role: item.role, text: item.text.slice(0, MAX_HISTORY_TEXT) };
  });
  return {
    chatId,
    roomId,
    prompt,
    model: chosen,
    access: access || "ask",
    history: turns.filter((item) => item.text.trim()),
    designStyle: designStyle || undefined,
    idempotencyKey,
  };
}

async function ownedRun(env, runId, account) {
  const run = await getRun(env, runId);
  if (!run) fail(404, "Run not found");
  if (run.accountId !== account.id) fail(403, "This run belongs to another account");
  return run;
}

const sse = (stream) => new Response(stream, { status: 200, headers: sseHeaders });

/**
 * /api/ai/*. `accountOf(env, request, url)` and `limited(binding, key)` come from the router
 * (cloud/worker.js); `ctx.waitUntil`, when the platform offers it, keeps a run going after its
 * client disconnects.
 */
export async function handleAi(request, env, url, { accountOf, limited, ctx }) {
  const path = url.pathname;
  const config = aiConfig(env);
  // Browsers send Origin: only the server's own pages may call it from a browser.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) fail(403, "Cross-origin requests are not allowed");
  const account = await accountOf(env, request, url).catch(() => null);
  if (!account) fail(401, "Sign in first");

  if (path === "/api/ai/config") {
    if (request.method !== "GET") fail(405, "Use GET");
    return json(config);
  }

  if (path === "/api/ai/runs") {
    if (request.method !== "POST") fail(405, "Use POST");
    if (!config.enabled) fail(503, "The model API runtime is not configured on this server");
    if (await limited(env.AI_LIMIT, `account:${account.id}`))
      return new Response(JSON.stringify({ error: "Too many requests. Try again in a minute." }), {
        status: 429,
        headers: { ...corsHeaders, "content-type": "application/json", "retry-after": "60" },
      });
    const input = validRunRequest(await readJson(request, MAX_BODY), config);
    // A retried request: replay the existing run's events, then follow it.
    const existing = await runByKey(env, account.id, input.idempotencyKey);
    if (existing) return sse(followStream(env, existing.id, 0));

    const backend = createRoomBackend(env, request, url, account, { roomId: input.roomId });
    const { role, title } = await backend.role(input.roomId);
    if (!role) fail(403, "You have no access to this room");
    const active = await activeRuns(env, account.id);
    if (active.some((run) => run.chatId === input.chatId))
      fail(409, "This chat already has a running turn; cancel it or wait for it to finish");
    if (active.length >= MAX_ACTIVE_RUNS) fail(429, "Too many running turns for this account");

    const { run, created } = await createRun(env, {
      accountId: account.id,
      roomId: input.roomId,
      chatId: input.chatId,
      model: input.model,
      access: input.access,
      idempotencyKey: input.idempotencyKey,
    });
    if (!created) return sse(followStream(env, run.id, 0));

    const live = liveStream();
    const execution = executeRun({
      env,
      run,
      backend,
      room: { id: input.roomId, title },
      role,
      prompt: input.prompt,
      history: input.history,
      designStyle: input.designStyle,
      limits: config.limits,
      provider: {
        apiKey: env.OPENROUTER_API_KEY,
        baseUrl: env.OPENROUTER_BASE_URL || undefined,
        origin: url.origin,
      },
      log: createEventLog(env, run, { onEvent: live.send }),
    })
      .catch((error) => console.error("ai run failed", run.id, error?.message))
      .finally(() => live.close());
    ctx?.waitUntil?.(execution);
    return sse(live.stream);
  }

  const match = path.match(RUN_ROUTE);
  if (!match) fail(404, "Not found");
  const [, runId, action] = match;
  if (action === "events") {
    if (request.method !== "GET") fail(405, "Use GET");
    await ownedRun(env, runId, account);
    const after = Number(url.searchParams.get("after") ?? 0);
    if (!Number.isInteger(after) || after < 0) fail(400, "after must be a sequence number");
    return sse(followStream(env, runId, after));
  }
  if (request.method !== "POST") fail(405, "Use POST");
  const run = await ownedRun(env, runId, account);
  if (action === "cancel") {
    if (run.status === "running") await requestCancel(env, runId);
    return json({ ok: true });
  }
  // approvals
  const body = await readJson(request, 16 * 1024);
  if (typeof body?.requestId !== "string" || typeof body.allow !== "boolean")
    fail(400, "Body must be {requestId, allow}");
  const approval = await getApproval(env, runId, body.requestId);
  if (!approval) fail(404, "Approval request not found");
  if (approval.decision) fail(409, "This request was already decided");
  if (!(await decideApproval(env, runId, body.requestId, body.allow, "user")))
    fail(409, "This request was already decided");
  return json({ ok: true });
}
