// Model API runtime (/api/ai/*, cloud/ai.js, docs/ai-runtime.md) on the real backend: config
// enabled and disabled, authentication, room access, streamed text, a read tool call against a
// real room, room scoping, cancel, reconnect with events?after=, idempotent replay, budgets,
// approvals, an expired lease and the per-account rate limit. The LLM provider is the only fake:
// a local OpenAI-compatible server (tests/helpers/fake-openrouter.mjs) set as OPENROUTER_BASE_URL.
// Runs on workerd (default), Node and Vercel (CLOUD_RUNTIME, tests/cloud-harness.mjs).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser, RUNTIME } from "./cloud-harness.mjs";
import { startFakeOpenRouter } from "./helpers/fake-openrouter.mjs";

const ORIGIN = "http://local";
let otherRoomId = null;
const fake = await startFakeOpenRouter({
  hello: [[{ text: "Hello from the model." }]],
  tree: [
    [{ text: "Let me look at the room." }, { tool: "get_element_tree", args: {} }],
    [{ text: "The room has a Hero artboard." }],
  ],
  // Ana's room id, asked for from Dodi's run (set below).
  other: (body) =>
    body.messages.some((m) => m.role === "tool")
      ? [{ text: "No." }]
      : [{ tool: "get_element_tree", args: { document: otherRoomId } }],
  slow: [[{ text: "Working on it" }, { hang: true }]],
  steps: [[{ text: "one " }, { delay: 700 }, { text: "two three" }]],
  loop: [[{ tool: "get_artboards", args: {} }]],
  burst: [
    [1, 2, 3, 4, 5].map((n) => ({ tool: "get_artboards", args: {}, id: `burst_${n}` })),
    [{ text: "unreachable" }],
  ],
  default: [[{ text: "default" }]],
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-ai-"));
const options = await cloudOptions(path.join(dir, "state"));
const config = options.workers[0].config;
const baseEnv = { ...config.env };
const mf = new Miniflare(options);
const local = (url, init) => mf.dispatchFetch(url, init);

const request = (route, { method = "GET", body, token, headers = {} } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};

/** Read an SSE response incrementally: next(predicate) waits for an event, all() for the end. */
function sseReader(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let ended = false;
  let index = 0;
  async function pump() {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return {
    events,
    async next(predicate, timeout = 15_000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        while (index < events.length) {
          const event = events[index++];
          if (predicate(event)) return event;
        }
        if (ended) throw new Error("Stream ended before the expected event");
        if (Date.now() > deadline) throw new Error("Timed out waiting for an event");
        await pump();
      }
    },
    async all(timeout = 20_000) {
      const deadline = Date.now() + timeout;
      while (!ended) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for the stream to end");
        await pump();
      }
      return events;
    },
    cancel: () => reader.cancel().catch(() => {}),
  };
}

let keys = 0;
const startRun = (token, fields) =>
  request("/api/ai/runs", {
    method: "POST",
    token,
    body: { idempotencyKey: `test-key-${++keys}-${Date.now()}`, ...fields },
  });
const types = (events) => events.map((event) => event.type);
function assertSequence(events, runId, chatId, from = 1) {
  events.forEach((event, i) => {
    assert.equal(event.seq, from + i, `seq of ${event.type}`);
    assert.equal(event.id, runId);
    assert.equal(event.chatId, chatId);
  });
}
const systemOf = (body) => body.messages.find((m) => m.role === "system")?.content || "";

try {
  // Disabled: no OPENROUTER_API_KEY.
  const ana = await passwordUser(ORIGIN, "ana@example.test", "Ana", local, "192.0.2.1");
  const dodi = await passwordUser(ORIGIN, "dodi@example.test", "Dodi", local, "192.0.2.2");
  assert.equal((await request("/api/ai/config")).status, 401, "config needs an account");
  assert.equal((await request("/api/ai/config", { token: "not-a-token" })).status, 401);
  const disabled = await data(await request("/api/ai/config", { token: ana }), 200);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.provider, "openrouter");
  const room = await data(
    await request("/api/rooms", {
      method: "POST",
      token: ana,
      body: {
        document: {
          version: 2,
          name: "Launch page",
          pages: [{ id: "page-1", name: "Page 1", nodes: [] }],
          tokens: {},
        },
      },
    }),
    201,
  );
  const off = await startRun(ana, { chatId: "chat-off", roomId: room.id, prompt: "hi" });
  assert.equal(off.status, 503, await off.text());

  // Enabled.
  config.env = {
    ...baseEnv,
    OPENROUTER_API_KEY: { type: "text", value: "test-openrouter-key" },
    OPENROUTER_BASE_URL: { type: "text", value: fake.baseUrl },
    VERYNIZE_AI_MODELS: { type: "text", value: "fake/model-a=Model A,fake/model-b" },
    VERYNIZE_AI_MAX_TURNS: { type: "text", value: "3" },
    VERYNIZE_AI_MAX_TOOL_CALLS: { type: "text", value: "4" },
  };
  await mf.setOptions(options);
  assert.deepEqual(await data(await request("/api/ai/config", { token: ana }), 200), {
    enabled: true,
    provider: "openrouter",
    models: [
      { id: "fake/model-a", label: "Model A" },
      { id: "fake/model-b", label: "fake/model-b" },
    ],
    defaultModel: "fake/model-a",
    limits: { maxTurns: 3, maxToolCalls: 4 },
  });

  // Content for the read tools, through the hosted MCP endpoint (cloud/design-backend.js).
  const created = await data(
    await request("/api/mcp", {
      method: "POST",
      token: ana,
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_artboard",
          arguments: {
            document: room.id,
            code: '<div data-node-label="Hero" className="w-[480px] bg-white p-8 flex flex-col gap-4"><h1 className="text-3xl font-bold text-slate-900">Ship faster</h1></div>',
          },
        },
      },
    }),
    200,
  );
  assert.ok(!created.result.isError, JSON.stringify(created.result));
  const dodiRoom = await data(
    await request("/api/rooms", {
      method: "POST",
      token: dodi,
      body: {
        document: {
          version: 2,
          name: "Dodi's",
          pages: [{ id: "p", name: "P", nodes: [] }],
          tokens: {},
        },
      },
    }),
    201,
  );

  // Request validation, authentication and room access.
  assert.equal(
    (
      await request("/api/ai/runs", {
        method: "POST",
        body: { chatId: "c", roomId: room.id, prompt: "x", idempotencyKey: "abcdefgh" },
      })
    ).status,
    401,
  );
  assert.equal((await startRun(ana, { chatId: "c1", roomId: room.id, prompt: "" })).status, 400);
  assert.equal(
    (await startRun(ana, { chatId: "c1", roomId: room.id, prompt: "x", model: "other/model" }))
      .status,
    400,
  );
  assert.equal(
    (await startRun(ana, { chatId: "c1", roomId: room.id, prompt: "x", access: "root" })).status,
    400,
  );
  assert.equal(
    (
      await request("/api/ai/runs", {
        method: "POST",
        token: ana,
        body: { chatId: "c1", roomId: room.id, prompt: "x" },
      })
    ).status,
    400,
    "idempotencyKey is required",
  );
  const foreign = await startRun(dodi, {
    chatId: "c-dodi",
    roomId: room.id,
    prompt: "[scenario:hello]",
  });
  assert.equal(foreign.status, 403, "a non-member cannot run against the room");
  const plain = await sseReader(
    await startRun(ana, { chatId: "c1", roomId: room.id, prompt: "x" }),
  ).all();
  assert.equal(plain.at(-1).code, "ok");
  const crossOrigin = await request("/api/ai/config", {
    token: ana,
    headers: { origin: "https://evil.example" },
  });
  assert.equal(crossOrigin.status, 403);

  // Streamed text: session, status, deltas, the full text, usage and done, stored in order.
  const requestsBefore = fake.requests.length;
  const helloKey = `hello-${Date.now()}`;
  const helloBody = {
    chatId: "chat-hello",
    roomId: room.id,
    prompt: "[scenario:hello] Say hello",
    history: [
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer" },
    ],
    idempotencyKey: helloKey,
  };
  const hello = sseReader(
    await request("/api/ai/runs", { method: "POST", token: ana, body: helloBody }),
  );
  const helloEvents = await hello.all();
  const runId = helloEvents[0].id;
  assertSequence(helloEvents, runId, "chat-hello");
  assert.deepEqual(helloEvents[0], {
    id: runId,
    chatId: "chat-hello",
    seq: 1,
    type: "session",
    sessionId: runId,
    agent: "openrouter",
    model: "fake/model-a",
  });
  assert.deepEqual(helloEvents[1], {
    id: runId,
    chatId: "chat-hello",
    seq: 2,
    type: "status",
    status: "running",
  });
  assert.equal(
    helloEvents
      .filter((e) => e.type === "assistant-text-delta")
      .map((e) => e.text)
      .join(""),
    "Hello from the model.",
  );
  assert.equal(helloEvents.find((e) => e.type === "assistant-text").text, "Hello from the model.");
  const usage = helloEvents.find((e) => e.type === "usage");
  assert.deepEqual([usage.inputTokens, usage.outputTokens, usage.model], [100, 10, "fake/model-a"]);
  assert.deepEqual(helloEvents.at(-1), {
    id: runId,
    chatId: "chat-hello",
    seq: helloEvents.length,
    type: "done",
    code: "ok",
    stopped: false,
    sessionId: runId,
  });
  // What the backend sent OpenRouter: key, model, persona + room context, history, read tools only.
  const sent = fake.requests.at(-1);
  assert.equal(fake.requests.length, requestsBefore + 1);
  assert.equal(sent.headers.authorization, "Bearer test-openrouter-key");
  assert.equal(sent.body.model, "fake/model-a");
  assert.equal(sent.body.stream, true);
  assert.match(systemOf(sent.body), /You are the designer inside Verynize/);
  assert.match(systemOf(sent.body), new RegExp(`room id ${room.id}; your role: owner`));
  assert.match(systemOf(sent.body), /"Launch page"/);
  assert.deepEqual(
    sent.body.messages.filter((m) => m.role !== "system").map((m) => [m.role, m.content]),
    [
      ["user", "Earlier question"],
      ["assistant", "Earlier answer"],
      ["user", "[scenario:hello] Say hello"],
    ],
  );
  const offered = sent.body.tools.map((t) => t.function.name);
  for (const name of [
    "get_design_context",
    "get_element_tree",
    "get_element_code",
    "list_documents",
  ])
    assert.ok(offered.includes(name), `${name} is offered`);
  for (const name of [
    "take_screenshot",
    "create_artboard",
    "update_elements",
    "delete_elements",
    "run_terminal_command",
    "save_design_preference",
    "create_document",
  ])
    assert.ok(!offered.includes(name), `${name} is not offered`);
  const treeSchema = sent.body.tools.find((t) => t.function.name === "get_element_tree").function
    .parameters;
  assert.equal(treeSchema.type, "object");
  assert.ok(treeSchema.properties.depth);

  // Idempotent replay: the same key returns the stored events and calls no model.
  const replay = sseReader(
    await request("/api/ai/runs", { method: "POST", token: ana, body: helloBody }),
  );
  assert.deepEqual(await replay.all(), helloEvents);
  assert.equal(fake.requests.length, requestsBefore + 1, "a replay does not call the model");
  // The full event log is readable afterwards; after=<seq> returns the rest.
  assert.deepEqual(
    await sseReader(await request(`/api/ai/runs/${runId}/events?after=0`, { token: ana })).all(),
    helloEvents,
  );
  assert.deepEqual(
    await sseReader(await request(`/api/ai/runs/${runId}/events?after=3`, { token: ana })).all(),
    helloEvents.slice(3),
  );
  assert.equal((await request(`/api/ai/runs/${runId}/events`, { token: dodi })).status, 403);
  assert.equal(
    (await request(`/api/ai/runs/${crypto.randomUUID()}/events`, { token: ana })).status,
    404,
  );
  assert.equal((await request(`/api/ai/runs/${runId}/events?after=x`, { token: ana })).status, 400);

  // A read tool against the real room, with the chosen design style.
  const tree = sseReader(
    await startRun(ana, {
      chatId: "chat-tree",
      roomId: room.id,
      prompt: "[scenario:tree] What is on the canvas?",
      model: "fake/model-b",
      designStyle: "swiss-minimalist",
    }),
  );
  const treeEvents = await tree.all();
  assertSequence(treeEvents, treeEvents[0].id, "chat-tree");
  assert.deepEqual(
    types(treeEvents).filter((t) => !t.endsWith("-delta")),
    [
      "session",
      "status",
      "assistant-text",
      "tool-call",
      "status",
      "tool-result",
      "status",
      "assistant-text",
      "usage",
      "done",
    ],
  );
  const call = treeEvents.find((e) => e.type === "tool-call");
  assert.equal(call.name, "get_element_tree");
  assert.deepEqual(call.input, {});
  assert.ok(
    treeEvents.some((e) => e.type === "tool-input-delta" && e.toolCallId === call.toolCallId),
  );
  assert.deepEqual(
    treeEvents.filter((e) => e.type === "status").map((e) => e.status),
    ["running", "tool", "running"],
  );
  const result = treeEvents.find((e) => e.type === "tool-result");
  assert.equal(result.toolCallId, call.toolCallId);
  assert.equal(result.name, "get_element_tree");
  assert.equal(result.isError, false);
  assert.match(result.output, /data-node-label="Hero"/);
  assert.equal(treeEvents.at(-1).code, "ok");
  const treeRequest = fake.requests.at(-1).body;
  assert.equal(treeRequest.model, "fake/model-b");
  assert.match(systemOf(treeRequest), /get_design_guidelines \{style: "swiss-minimalist"\}/);
  const toolMessage = treeRequest.messages.find((m) => m.role === "tool");
  assert.equal(toolMessage.tool_call_id, call.toolCallId);
  assert.match(toolMessage.content, /data-node-label="Hero"/);

  // Other rooms are not reachable from a run: Dodi's run asks for Ana's room.
  otherRoomId = room.id;
  const otherScenario = sseReader(
    await startRun(dodi, {
      chatId: "chat-other",
      roomId: dodiRoom.id,
      prompt: "[scenario:other]",
    }),
  );
  const otherEvents = await otherScenario.all();
  const refused = otherEvents.find((e) => e.type === "tool-result");
  assert.equal(refused.isError, true);
  assert.match(refused.output, new RegExp(`works on room ${dodiRoom.id} only`));
  assert.doesNotMatch(refused.output, /Hero/);

  // Cancel: the executor stops the model stream and ends with done {cancelled, stopped}.
  const slow = sseReader(
    await startRun(ana, { chatId: "chat-slow", roomId: room.id, prompt: "[scenario:slow]" }),
  );
  await slow.next((e) => e.type === "assistant-text-delta");
  const slowRunId = slow.events[0].id;
  // One running turn per chat.
  const second = await startRun(ana, { chatId: "chat-slow", roomId: room.id, prompt: "again" });
  assert.equal(second.status, 409, await second.text());
  assert.equal(
    (await request(`/api/ai/runs/${slowRunId}/cancel`, { method: "POST", token: dodi })).status,
    403,
  );
  assert.deepEqual(
    await data(
      await request(`/api/ai/runs/${slowRunId}/cancel`, { method: "POST", token: ana }),
      200,
    ),
    { ok: true },
  );
  const cancelled = await slow.next((e) => e.type === "done");
  assert.equal(cancelled.code, "cancelled");
  assert.equal(cancelled.stopped, true);
  await slow.all();
  assertSequence(slow.events, slowRunId, "chat-slow");

  // Reconnect: drop the stream after the first events, then follow with events?after=.
  const steps = sseReader(
    await startRun(ana, { chatId: "chat-steps", roomId: room.id, prompt: "[scenario:steps]" }),
  );
  await steps.next((e) => e.type === "assistant-text-delta");
  const stepsRunId = steps.events[0].id;
  const seen = steps.events.slice();
  await steps.cancel();
  const lastSeen = seen.at(-1).seq;
  const resumed = await sseReader(
    await request(`/api/ai/runs/${stepsRunId}/events?after=${lastSeen}`, { token: ana }),
  ).all();
  assert.ok(resumed.length > 0);
  assert.equal(resumed[0].seq, lastSeen + 1);
  const full = [...seen, ...resumed];
  assertSequence(full, stepsRunId, "chat-steps");
  assert.equal(full.find((e) => e.type === "assistant-text").text, "one two three");
  assert.equal(full.at(-1).type, "done");
  assert.equal(full.at(-1).code, "ok");

  // Budgets: three model turns that each want a tool, then four tool calls in one turn.
  const loop = await sseReader(
    await startRun(ana, { chatId: "chat-loop", roomId: room.id, prompt: "[scenario:loop]" }),
  ).all();
  assert.equal(loop.filter((e) => e.type === "tool-call").length, 3);
  assert.deepEqual(loop.at(-1).code, "budget");
  const burst = await sseReader(
    await startRun(ana, { chatId: "chat-burst", roomId: room.id, prompt: "[scenario:burst]" }),
  ).all();
  const burstResults = burst.filter((e) => e.type === "tool-result");
  assert.equal(burstResults.length, 5);
  assert.deepEqual(
    burstResults.map((e) => e.isError),
    [false, false, false, false, true],
  );
  assert.match(burstResults[4].output, /Tool call budget reached \(4 per run\)/);
  assert.equal(burst.at(-1).code, "budget");
  assert.ok(!burst.some((e) => e.type === "assistant-text" && /unreachable/.test(e.text)));

  // Approvals: bound to the run owner, decided once (rows written as the executor would).
  const db = await mf.getD1Database("DB");
  await db
    .prepare(
      'INSERT INTO ai_approval ("runId","requestId","toolCallId","toolName","argsHash","createdAt") VALUES (?,?,?,?,?,?)',
    )
    .bind(runId, "req-1", "call-1", "update_elements", "hash", Date.now())
    .run();
  const approve = (token, body, id = runId) =>
    request(`/api/ai/runs/${id}/approvals`, { method: "POST", token, body });
  assert.equal((await approve(dodi, { requestId: "req-1", allow: true })).status, 403);
  assert.equal((await approve(ana, { requestId: "req-2", allow: true })).status, 404);
  assert.equal((await approve(ana, { requestId: "req-1" })).status, 400);
  assert.equal(
    (await approve(ana, { requestId: "req-1", allow: true }, crypto.randomUUID())).status,
    404,
  );
  assert.deepEqual(await data(await approve(ana, { requestId: "req-1", allow: false }), 200), {
    ok: true,
  });
  assert.equal((await approve(ana, { requestId: "req-1", allow: true })).status, 409);
  const decided = await db
    .prepare('SELECT "decision", "reason" FROM ai_approval WHERE "runId"=? AND "requestId"=?')
    .bind(runId, "req-1")
    .first();
  assert.deepEqual({ ...decided }, { decision: "deny", reason: "user" });

  // A run whose instance stopped renewing its lease is closed as an error by the next reader.
  const me = await data(await request("/api/me", { token: ana }), 200);
  const orphan = crypto.randomUUID();
  const past = Date.now() - 60_000;
  await db
    .prepare(
      'INSERT INTO ai_run ("id","accountId","roomId","chatId","model","access","status","idempotencyKey","leaseUntil","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      orphan,
      me.account.id,
      room.id,
      "chat-orphan",
      "fake/model-a",
      "ask",
      "running",
      "orphan-key-1",
      past,
      past,
      past,
    )
    .run();
  await db
    .prepare('INSERT INTO ai_run_event ("runId","seq","event","createdAt") VALUES (?,?,?,?)')
    .bind(
      orphan,
      1,
      JSON.stringify({ id: orphan, chatId: "chat-orphan", seq: 1, type: "session" }),
      past,
    )
    .run();
  const closed = await sseReader(
    await request(`/api/ai/runs/${orphan}/events`, { token: ana }),
  ).all();
  assert.deepEqual(types(closed), ["session", "error", "done"]);
  assert.deepEqual(
    closed.map((e) => e.seq),
    [1, 2, 3],
  );
  assert.equal(closed[2].code, "error");
  const status = await db
    .prepare('SELECT "status", "code" FROM ai_run WHERE "id"=?')
    .bind(orphan)
    .first();
  assert.deepEqual({ ...status }, { status: "done", code: "error" });

  // Rate limit per account (AI_LIMIT, 30 run requests a minute in the test configuration).
  let limitedAt = 0;
  for (let i = 1; i <= 40 && !limitedAt; i++) {
    const response = await request("/api/ai/runs", { method: "POST", token: dodi, body: {} });
    if (response.status === 429) limitedAt = i;
    else assert.equal(response.status, 400);
    await response.body?.cancel();
  }
  assert.ok(limitedAt > 0, "AI_LIMIT answers 429");
  const anaStill = await startRun(ana, {
    chatId: "chat-after-limit",
    roomId: room.id,
    prompt: "x",
    model: "bad",
  });
  assert.equal(anaStill.status, 400, "the limit is per account");

  console.log(`cloud AI runtime OK (${RUNTIME})`);
} finally {
  await mf.dispose();
  await fake.close();
  await fs.rm(dir, { recursive: true, force: true });
}
