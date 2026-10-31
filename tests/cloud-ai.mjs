// Model API runtime (/api/ai/*, cloud/ai.js, docs/ai-runtime.md) on the real backend: config
// enabled and disabled, authentication, room access, streamed text, a read tool call against a
// real room, room scoping, cancel, reconnect with events?after=, idempotent replay, budgets, an
// expired lease and the per-account rate limit; write tools: ask → approve/deny, approval endpoint
// checks (owner, argsHash, replay, ended run), cancel and timeout while waiting, at most once per
// tool call (re-POST, reconnect, repeated id), plan and helper runs, revocation mid-run, edit
// access with a live room socket, and the same write through hosted MCP and the runtime giving
// the same document. The LLM provider is the only fake: a local OpenAI-compatible server
// (tests/helpers/fake-openrouter.mjs) set as OPENROUTER_BASE_URL.
// Runs on workerd (default), Node and Vercel (CLOUD_RUNTIME, tests/cloud-harness.mjs).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser, RUNTIME } from "./cloud-harness.mjs";
import { startFakeOpenRouter, toolMessages, userText } from "./helpers/fake-openrouter.mjs";
import { validateDocument } from "../integrations/document-core.mjs";

const ORIGIN = "http://local";
let otherRoomId = null;
const card = (label) =>
  `<div data-node-label="${label}" className="w-[320px] bg-white p-6 flex flex-col gap-2"><p className="text-base text-slate-900">${label}</p></div>`;
const labelOf = (body) => /\[label:([\w -]+)\]/.exec(userText(body))?.[1] || "AI card";
const fake = await startFakeOpenRouter({
  // One write (create_artboard of a card named by [label:…]), then a closing text.
  write: (body) =>
    toolMessages(body).length
      ? [{ text: "Done." }]
      : [
          { text: "Adding a card." },
          { tool: "create_artboard", args: { code: card(labelOf(body)) } },
        ],
  // The same write with the same tool call id in two turns.
  dup: (body) =>
    toolMessages(body).length >= 2
      ? [{ text: "Done." }]
      : [{ tool: "create_artboard", args: { code: card(labelOf(body)) }, id: "dup_call" }],
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
const blank = (name) => ({
  version: 2,
  name,
  pages: [{ id: "page-1", name: "Page 1", nodes: [] }],
  tokens: {},
});
const roomDoc = async (id, token) =>
  (await data(await request(`/api/rooms/${id}`, { token }), 200)).document;
/** Names of the top-level nodes (artboards) of a document, in order. */
const labels = (doc) =>
  doc.pages.flatMap((page) => page.nodes.filter((n) => !n.parentId)).map((n) => n.name);
/**
 * A document with its page and node ids and node short ids (random per write) replaced by their
 * order of appearance; everything else is compared as is.
 */
function canonicalIds(doc) {
  const ids = new Map();
  const id = (value) => {
    if (!ids.has(value)) ids.set(value, `id-${ids.size + 1}`);
    return ids.get(value);
  };
  const out = structuredClone(doc);
  for (const page of out.pages) {
    page.id = id(page.id);
    for (const node of page.nodes) {
      node.id = id(node.id);
      if (node.shortId) node.shortId = id(`short:${node.shortId}`);
    }
  }
  for (const page of out.pages)
    for (const node of page.nodes) if (node.parentId) node.parentId = id(node.parentId);
  return out;
}
/** A live room socket (like an open editor); next(predicate) waits for a message. */
async function connectRoom(roomId, session) {
  const upgrade = await mf.dispatchFetch(
    `${ORIGIN}/api/rooms/${roomId}/socket?session=${encodeURIComponent(session)}&client=editor1`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101, "socket upgrade");
  const socket = upgrade.webSocket;
  const seen = [];
  socket.addEventListener("message", (event) => seen.push(JSON.parse(event.data)));
  socket.accept();
  return {
    socket,
    async next(predicate, timeout = 8000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const found = seen.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error("Timed out waiting for a socket message");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}

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
  // Read and write tools of the shared hosted table; nothing unavailable or outside the room.
  const offered = sent.body.tools.map((t) => t.function.name);
  for (const name of [
    "get_design_context",
    "get_element_tree",
    "get_element_code",
    "list_documents",
    "create_artboard",
    "update_elements",
    "delete_elements",
    "apply_operations",
  ])
    assert.ok(offered.includes(name), `${name} is offered`);
  for (const name of [
    "take_screenshot",
    "ask_agent",
    "import_html",
    "export_document",
    "run_terminal_command",
    "save_design_preference",
    "create_document",
  ])
    assert.ok(!offered.includes(name), `${name} is not offered`);
  assert.match(systemOf(sent.body), /Each write call waits for the user's approval/);
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

  // ---------------------------------------------------------------------------------------------
  // Write tools and approvals (Policy in docs/ai-runtime.md). Eva has her own room so these runs
  // stay clear of Ana's per-account rate limit.
  let db = await mf.getD1Database("DB");
  const eva = await passwordUser(ORIGIN, "eva@example.test", "Eva", local, "192.0.2.3");
  const evaMe = await data(await request("/api/me", { token: eva }), 200);
  const evaRoom = await data(
    await request("/api/rooms", { method: "POST", token: eva, body: { document: blank("Board") } }),
    201,
  );
  const approve = (token, id, body) =>
    request(`/api/ai/runs/${id}/approvals`, { method: "POST", token, body });
  const approvalRow = async (id, requestId) => ({
    ...(await db
      .prepare(
        'SELECT "accountId","toolCallId","toolName","argsHash","decision","reason" FROM ai_approval WHERE "runId"=? AND "requestId"=?',
      )
      .bind(id, requestId)
      .first()),
  });
  const statuses = (events) => events.filter((e) => e.type === "status").map((e) => e.status);
  const modelRequestsFor = (marker) =>
    fake.requests.filter((r) => userText(r.body).includes(marker)).map((r) => r.body);

  // Ask (the default) → approve → applied. Nothing changes before the decision.
  const askBody = {
    chatId: "chat-ask",
    roomId: evaRoom.id,
    prompt: "[scenario:write] [label:Approved card]",
    idempotencyKey: `ask-${Date.now()}`,
  };
  const ask = sseReader(
    await request("/api/ai/runs", { method: "POST", token: eva, body: askBody }),
  );
  const permission = await ask.next((e) => e.type === "permission-request");
  const askRunId = ask.events[0].id;
  const askCall = ask.events.find((e) => e.type === "tool-call");
  assert.equal(permission.name, "create_artboard");
  assert.equal(permission.toolCallId, askCall.toolCallId);
  assert.equal(permission.input.code, card("Approved card"));
  assert.equal(permission.title, 'Canvas · create_artboard "Approved card"');
  assert.match(permission.argsHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(await approvalRow(askRunId, permission.requestId), {
    accountId: evaMe.account.id,
    toolCallId: askCall.toolCallId,
    toolName: "create_artboard",
    argsHash: permission.argsHash,
    decision: null,
    reason: null,
  });
  assert.deepEqual(labels(await roomDoc(evaRoom.id, eva)), [], "nothing applied before approval");
  // An idempotent re-POST while the run waits follows the same run: same request, no new model call.
  const modelCalls = fake.requests.length;
  const askAgain = sseReader(
    await request("/api/ai/runs", { method: "POST", token: eva, body: askBody }),
  );
  assert.equal(
    (await askAgain.next((e) => e.type === "permission-request")).requestId,
    permission.requestId,
  );
  // The endpoint: owner only, known request, the argsHash of the pending call, decided once.
  const decision = { requestId: permission.requestId, allow: true, argsHash: permission.argsHash };
  assert.equal((await approve(dodi, askRunId, decision)).status, 403, "another account");
  assert.equal(
    (await approve(eva, askRunId, { ...decision, requestId: crypto.randomUUID() })).status,
    404,
  );
  assert.equal((await approve(eva, crypto.randomUUID(), decision)).status, 404);
  assert.equal(
    (await approve(eva, askRunId, { requestId: permission.requestId })).status,
    400,
    "allow is required",
  );
  assert.equal(
    (await approve(eva, askRunId, { requestId: permission.requestId, allow: true })).status,
    400,
    "approving needs the argsHash",
  );
  const mismatch = await approve(eva, askRunId, { ...decision, argsHash: "0".repeat(64) });
  assert.equal(mismatch.status, 409, "the hash of other arguments is refused");
  assert.match(await mismatch.text(), /do not match/);
  assert.deepEqual(await data(await approve(eva, askRunId, decision), 200), { ok: true });
  assert.equal((await approve(eva, askRunId, decision)).status, 409, "a replay is refused");
  assert.equal(
    (await approve(eva, askRunId, { ...decision, allow: false })).status,
    409,
    "decided once",
  );
  const askEvents = await ask.all();
  assertSequence(askEvents, askRunId, "chat-ask");
  assert.deepEqual(await askAgain.all(), askEvents, "both streams carry the same events");
  const askResolved = askEvents.find((e) => e.type === "permission-resolved");
  assert.deepEqual(
    { requestId: askResolved.requestId, allow: askResolved.allow, reason: askResolved.reason },
    { requestId: permission.requestId, allow: true, reason: "user" },
  );
  const askResult = askEvents.find((e) => e.type === "tool-result");
  assert.equal(askResult.isError, false, askResult.output);
  assert.ok(askResult.seq > askResolved.seq);
  assert.deepEqual(statuses(askEvents), ["running", "awaiting-approval", "tool", "running"]);
  assert.equal(askEvents.at(-1).code, "ok");
  assert.equal(fake.requests.length, modelCalls + 1, "one more model call, after the tool result");
  const approvedDoc = await roomDoc(evaRoom.id, eva);
  validateDocument(structuredClone(approvedDoc));
  assert.deepEqual(labels(approvedDoc), ["Approved card"]);
  assert.equal((await approvalRow(askRunId, permission.requestId)).decision, "allow");
  // At most once: re-POST and reconnect after the run replay the log; nothing is applied again.
  assert.deepEqual(
    await sseReader(
      await request("/api/ai/runs", { method: "POST", token: eva, body: askBody }),
    ).all(),
    askEvents,
  );
  assert.deepEqual(
    await sseReader(
      await request(`/api/ai/runs/${askRunId}/events?after=${permission.seq}`, { token: eva }),
    ).all(),
    askEvents.filter((e) => e.seq > permission.seq),
  );
  assert.equal(fake.requests.length, modelCalls + 1, "replays call no model");
  assert.deepEqual(labels(await roomDoc(evaRoom.id, eva)), ["Approved card"]);
  const recordedRows = await db
    .prepare('SELECT "toolCallId","isError" FROM ai_tool_result WHERE "runId"=?')
    .bind(askRunId)
    .all();
  assert.deepEqual(
    recordedRows.results.map((row) => ({ ...row })),
    [{ toolCallId: askCall.toolCallId, isError: 0 }],
  );
  // An undecided request of a run that has ended cannot be decided any more.
  await db
    .prepare(
      'INSERT INTO ai_approval ("runId","requestId","accountId","toolCallId","toolName","argsHash","createdAt") VALUES (?,?,?,?,?,?,?)',
    )
    .bind(askRunId, "late-request", evaMe.account.id, "late-call", "update_elements", "h", 1)
    .run();
  const ended = await approve(eva, askRunId, { requestId: "late-request", allow: false });
  assert.equal(ended.status, 409);
  assert.match(await ended.text(), /run has ended/);

  // Ask → deny: not applied, and the model gets the denial as the tool result.
  const deny = sseReader(
    await startRun(eva, {
      chatId: "chat-deny",
      roomId: evaRoom.id,
      prompt: "[scenario:write] [label:Denied card]",
    }),
  );
  const denyRequest = await deny.next((e) => e.type === "permission-request");
  const denyRunId = deny.events[0].id;
  assert.deepEqual(
    await data(
      await approve(eva, denyRunId, { requestId: denyRequest.requestId, allow: false }),
      200,
    ),
    { ok: true },
  );
  const denyEvents = await deny.all();
  const denyResolved = denyEvents.find((e) => e.type === "permission-resolved");
  assert.deepEqual([denyResolved.allow, denyResolved.reason], [false, "user"]);
  const denyResult = denyEvents.find((e) => e.type === "tool-result");
  assert.equal(denyResult.isError, true);
  assert.match(denyResult.output, /denied by user/);
  assert.equal(denyEvents.at(-1).code, "ok");
  const sawDenial = modelRequestsFor("[label:Denied card]").at(-1);
  assert.match(toolMessages(sawDenial)[0].content, /denied by user/);
  assert.deepEqual(labels(await roomDoc(evaRoom.id, eva)), ["Approved card"]);
  assert.deepEqual(
    (({ decision, reason }) => ({ decision, reason }))(
      await approvalRow(denyRunId, denyRequest.requestId),
    ),
    { decision: "deny", reason: "user" },
  );

  // Cancel while a write waits: the request is denied ("cancelled") and the run stops.
  const waiting = sseReader(
    await startRun(eva, {
      chatId: "chat-cancel-ask",
      roomId: evaRoom.id,
      prompt: "[scenario:write] [label:Cancelled card]",
    }),
  );
  const waitingRequest = await waiting.next((e) => e.type === "permission-request");
  const waitingRunId = waiting.events[0].id;
  await data(
    await request(`/api/ai/runs/${waitingRunId}/cancel`, { method: "POST", token: eva }),
    200,
  );
  const waitingEvents = await waiting.all();
  const waitingResolved = waitingEvents.find((e) => e.type === "permission-resolved");
  assert.deepEqual(
    [waitingResolved.requestId, waitingResolved.allow, waitingResolved.reason],
    [waitingRequest.requestId, false, "cancelled"],
  );
  assert.deepEqual(
    [waitingEvents.at(-1).type, waitingEvents.at(-1).code, waitingEvents.at(-1).stopped],
    ["done", "cancelled", true],
  );
  assertSequence(waitingEvents, waitingRunId, "chat-cancel-ask");
  assert.equal((await approvalRow(waitingRunId, waitingRequest.requestId)).reason, "cancelled");
  assert.equal(
    (
      await approve(eva, waitingRunId, {
        requestId: waitingRequest.requestId,
        allow: true,
        argsHash: waitingRequest.argsHash,
      })
    ).status,
    409,
  );
  assert.deepEqual(labels(await roomDoc(evaRoom.id, eva)), ["Approved card"]);

  // A repeated tool call id within a run is applied once; the repeat gets the recorded result.
  const twice = await sseReader(
    await startRun(eva, {
      chatId: "chat-dup",
      roomId: evaRoom.id,
      prompt: "[scenario:dup] [label:Once card]",
      access: "edit",
    }),
  ).all();
  const twiceResults = twice.filter((e) => e.type === "tool-result");
  assert.equal(twiceResults.length, 2);
  assert.ok(twiceResults.every((e) => e.toolCallId === "dup_call" && !e.isError));
  assert.equal(twiceResults[1].output, twiceResults[0].output);
  assert.ok(!twice.some((e) => e.type === "permission-request"));
  assert.deepEqual(labels(await roomDoc(evaRoom.id, eva)), ["Approved card", "Once card"]);

  // Plan first: write tools are offered but refused; nothing is applied, even with edit access.
  const planned = await sseReader(
    await startRun(eva, {
      chatId: "chat-plan",
      roomId: evaRoom.id,
      prompt: "[scenario:write] [label:Planned card]",
      access: "edit",
      plan: true,
    }),
  ).all();
  const planResult = planned.find((e) => e.type === "tool-result");
  assert.equal(planResult.isError, true);
  assert.match(planResult.output, /^Plan first: this run only plans/);
  assert.ok(!planned.some((e) => e.type === "permission-request"));
  assert.equal(planned.at(-1).code, "ok");
  const planRequest = modelRequestsFor("[label:Planned card]")[0];
  assert.match(systemOf(planRequest), /Plan before editing/);
  assert.ok(planRequest.tools.some((t) => t.function.name === "create_artboard"));
  assert.deepEqual(labels(await roomDoc(evaRoom.id, eva)), ["Approved card", "Once card"]);
  assert.equal(
    (await startRun(eva, { chatId: "c-p", roomId: evaRoom.id, prompt: "x", plan: "yes" })).status,
    400,
  );
  // A helper run is read-only: no write tool is offered.
  const helper = await sseReader(
    await startRun(eva, {
      chatId: "chat-helper",
      roomId: evaRoom.id,
      prompt: "[scenario:hello] [label:helper]",
      helper: true,
    }),
  ).all();
  assert.equal(helper.at(-1).code, "ok");
  const helperTools = modelRequestsFor("[label:helper]")[0].tools.map((t) => t.function.name);
  assert.ok(helperTools.includes("get_element_tree"));
  assert.ok(!helperTools.includes("create_artboard") && !helperTools.includes("update_elements"));

  // Revocation: Dodi (editor) is downgraded to viewer while his write waits; the approved call is
  // refused immediately before it runs and the run carries on.
  await data(
    await request(`/api/rooms/${room.id}/members`, {
      method: "POST",
      token: ana,
      body: { email: "dodi@example.test", role: "editor" },
    }),
    200,
  );
  const revoked = sseReader(
    await startRun(dodi, {
      chatId: "chat-revoke",
      roomId: room.id,
      prompt: "[scenario:write] [label:Revoked card]",
    }),
  );
  const revokedRequest = await revoked.next((e) => e.type === "permission-request");
  await data(
    await request(`/api/rooms/${room.id}/members`, {
      method: "POST",
      token: ana,
      body: { email: "dodi@example.test", role: "viewer" },
    }),
    200,
  );
  await data(
    await approve(dodi, revoked.events[0].id, {
      requestId: revokedRequest.requestId,
      allow: true,
      argsHash: revokedRequest.argsHash,
    }),
    200,
  );
  const revokedEvents = await revoked.all();
  const revokedResult = revokedEvents.find((e) => e.type === "tool-result");
  assert.equal(revokedResult.isError, true);
  assert.match(revokedResult.output, /\(viewer\) cannot edit/);
  assert.equal(revokedEvents.at(-1).code, "ok", "the run continues after the refusal");
  // Removed from the room while waiting: refused, and the run ends with an error.
  const dodiMe = await data(await request("/api/me", { token: dodi }), 200);
  await data(
    await request(`/api/rooms/${room.id}/members`, {
      method: "POST",
      token: ana,
      body: { email: "dodi@example.test", role: "editor" },
    }),
    200,
  );
  const removed = sseReader(
    await startRun(dodi, {
      chatId: "chat-removed",
      roomId: room.id,
      prompt: "[scenario:write] [label:Removed card]",
    }),
  );
  const removedRequest = await removed.next((e) => e.type === "permission-request");
  await data(
    await request(`/api/rooms/${room.id}/members/${dodiMe.account.id}`, {
      method: "DELETE",
      token: ana,
    }),
    200,
  );
  await data(
    await approve(dodi, removed.events[0].id, {
      requestId: removedRequest.requestId,
      allow: true,
      argsHash: removedRequest.argsHash,
    }),
    200,
  );
  const removedEvents = await removed.all();
  const removedResult = removedEvents.find((e) => e.type === "tool-result");
  assert.equal(removedResult.isError, true);
  assert.match(removedResult.output, /no longer have access/);
  assert.deepEqual(
    removedEvents.slice(-2).map((e) => [e.type, e.code ?? e.message]),
    [
      ["error", "You no longer have access to this room."],
      ["done", "error"],
    ],
  );
  const afterRevocation = labels(await roomDoc(room.id, ana));
  assert.ok(!afterRevocation.includes("Revoked card") && !afterRevocation.includes("Removed card"));

  // Edit access: no prompt; an open room socket receives the ops and the document stays valid.
  const editor = await connectRoom(room.id, ana);
  const live = await sseReader(
    await startRun(ana, {
      chatId: "chat-edit",
      roomId: room.id,
      prompt: "[scenario:write] [label:Live card]",
      access: "edit",
    }),
  ).all();
  assert.ok(!live.some((e) => e.type.startsWith("permission-")));
  assert.equal(live.find((e) => e.type === "tool-result").isError, false);
  assert.deepEqual(statuses(live), ["running", "tool", "running"]);
  const ops = await editor.next(
    (m) => m.type === "ops" && JSON.stringify(m.ops).includes("Live card"),
  );
  assert.match(ops.client, /^mcp-/);
  editor.socket.close();
  const liveDoc = await roomDoc(room.id, ana);
  validateDocument(structuredClone(liveDoc));
  assert.deepEqual(labels(liveDoc), ["Hero", "Live card"]);

  // The same write through hosted MCP and through the AI runtime gives the same document.
  const twinA = await data(
    await request("/api/rooms", { method: "POST", token: ana, body: { document: blank("Twin") } }),
    201,
  );
  const twinB = await data(
    await request("/api/rooms", { method: "POST", token: ana, body: { document: blank("Twin") } }),
    201,
  );
  const viaMcp = await data(
    await request("/api/mcp", {
      method: "POST",
      token: ana,
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create_artboard",
          arguments: { document: twinA.id, code: card("Twin card") },
        },
      },
    }),
    200,
  );
  assert.ok(!viaMcp.result.isError, JSON.stringify(viaMcp.result));
  const viaAi = await sseReader(
    await startRun(ana, {
      chatId: "chat-twin",
      roomId: twinB.id,
      prompt: "[scenario:write] [label:Twin card]",
      access: "full",
    }),
  ).all();
  assert.equal(viaAi.find((e) => e.type === "tool-result").isError, false);
  const docA = await roomDoc(twinA.id, ana);
  const docB = await roomDoc(twinB.id, ana);
  validateDocument(structuredClone(docB));
  assert.deepEqual(labels(docB), ["Twin card"]);
  assert.deepEqual(canonicalIds(docB), canonicalIds(docA), "MCP and AI writes are identical");

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
  // An orphan that was waiting for an approval: the request is denied and announced first.
  const waitingOrphan = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO ai_run ("id","accountId","roomId","chatId","model","access","status","idempotencyKey","leaseUntil","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      waitingOrphan,
      me.account.id,
      room.id,
      "chat-orphan-2",
      "fake/model-a",
      "ask",
      "running",
      "orphan-key-2",
      past,
      past,
      past,
    )
    .run();
  await db
    .prepare(
      'INSERT INTO ai_approval ("runId","requestId","accountId","toolCallId","toolName","argsHash","createdAt") VALUES (?,?,?,?,?,?,?)',
    )
    .bind(
      waitingOrphan,
      "orphan-request",
      me.account.id,
      "orphan-call",
      "create_artboard",
      "h",
      past,
    )
    .run();
  const closedWaiting = await sseReader(
    await request(`/api/ai/runs/${waitingOrphan}/events`, { token: ana }),
  ).all();
  assert.deepEqual(types(closedWaiting), ["permission-resolved", "error", "done"]);
  assert.deepEqual(
    [closedWaiting[0].requestId, closedWaiting[0].allow, closedWaiting[0].reason],
    ["orphan-request", false, "cancelled"],
  );
  assert.equal((await approvalRow(waitingOrphan, "orphan-request")).reason, "cancelled");

  // An unanswered approval is denied after VERYNIZE_AI_APPROVAL_TIMEOUT_MS (10 minutes by default).
  config.env = {
    ...config.env,
    VERYNIZE_AI_APPROVAL_TIMEOUT_MS: { type: "text", value: "1500" },
  };
  await mf.setOptions(options);
  db = await mf.getD1Database("DB"); // stubs from before setOptions are stale
  const late = sseReader(
    await startRun(eva, {
      chatId: "chat-timeout",
      roomId: evaRoom.id,
      prompt: "[scenario:write] [label:Late card]",
    }),
  );
  const lateRequest = await late.next((e) => e.type === "permission-request");
  const lateEvents = await late.all();
  const lateResolved = lateEvents.find((e) => e.type === "permission-resolved");
  assert.deepEqual(
    [lateResolved.requestId, lateResolved.allow, lateResolved.reason],
    [lateRequest.requestId, false, "timeout"],
  );
  const lateResult = lateEvents.find((e) => e.type === "tool-result");
  assert.equal(lateResult.isError, true);
  assert.match(lateResult.output, /timed out after 2 s; the call was not run/);
  assert.equal(lateEvents.at(-1).code, "ok");
  assert.deepEqual(
    (({ decision, reason }) => ({ decision, reason }))(
      await approvalRow(lateEvents[0].id, lateRequest.requestId),
    ),
    { decision: "deny", reason: "timeout" },
  );
  assert.ok(!labels(await roomDoc(evaRoom.id, eva)).includes("Late card"));

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
