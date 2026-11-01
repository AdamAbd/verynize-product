// Codex sign-in gate (desktop/agent-runtime.cjs requireAuth/codexAuth): a signed-out account gets one `auth-required`
// event instead of a turn, a 401 mid-turn becomes the same single event, and account email/plan come from
// `account/read`. Fake Codex: tests/fixtures/fake-codex.cjs ($CODEX_HOME/fake-account.json is its account/read answer).
// The last test uses the real installed `codex` with an isolated, empty CODEX_HOME (signed out): it never touches
// ~/.codex, never logs in or out and never starts a model turn. Skipped when Codex is not installed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { AgentRuntime, codexAuthFromAccount } = require("../desktop/agent-runtime.cjs");
const {
  createCodexMapper,
  createCodexExecMapper,
  isAuthError,
  CODEX_SIGNED_OUT,
} = require("../desktop/agent-runtime-events.cjs");
const agentAuth = require("../desktop/agent-auth.cjs");
const tools = require("../desktop/agent-tools.cjs");

const CHAT = "11111111-2222-3333-4444-555555555555";
const SIGNED_OUT = { account: null, requiresOpenaiAuth: true };
const SIGNED_IN = {
  account: {
    type: "chatgpt",
    email: "fixture@example.com",
    planType: "plus",
    workspaceName: "Studio",
  },
  requiresOpenaiAuth: true,
};
const read = async (file) =>
  (await fs.readFile(file, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);

/** Runtime against the fake Codex; `account` (or null for none) is written as the account/read answer of CODEX_HOME. */
async function setup(t, { account, appServer = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-sign-in-"));
  const bin = path.join(root, "bin"),
    home = path.join(root, "codex-home"),
    log = path.join(root, "codex.log");
  await fs.mkdir(bin);
  await fs.mkdir(home);
  const codex = path.join(bin, "codex");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), codex);
  await fs.chmod(codex, 0o755);
  if (account !== undefined)
    await fs.writeFile(path.join(home, "fake-account.json"), JSON.stringify(account));
  const saved = {
    log: process.env.FAKE_CODEX_LOG,
    home: process.env.CODEX_HOME,
    noServer: process.env.FAKE_CODEX_NO_APP_SERVER,
  };
  process.env.FAKE_CODEX_LOG = log;
  process.env.CODEX_HOME = home;
  if (!appServer) process.env.FAKE_CODEX_NO_APP_SERVER = "1";
  const events = [];
  const runtime = new AgentRuntime({
    userData: path.join(root, "userData"),
    home: path.join(root, "home"),
    discover: async () => [{ id: "codex", available: true, path: codex }],
    getBridge: async () => null,
    loadPreferences: async () => [],
    emit: (event) => events.push(event),
  });
  t.after(async () => {
    runtime.close();
    for (const [key, name] of [
      ["log", "FAKE_CODEX_LOG"],
      ["home", "CODEX_HOME"],
      ["noServer", "FAKE_CODEX_NO_APP_SERVER"],
    ])
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    await fs.rm(root, { recursive: true, force: true });
  });
  const until = (predicate, label = "event", timeout = 8000) =>
    new Promise((resolve, reject) => {
      const end = Date.now() + timeout;
      const poll = () => {
        const hit = events.find(predicate);
        if (hit) return resolve(hit);
        if (Date.now() > end)
          return reject(
            Error(
              "Timed out waiting for " + label + ": " + JSON.stringify(events.map((e) => e.type)),
            ),
          );
        setTimeout(poll, 5);
      };
      poll();
    });
  return { root, home, runtime, events, until, log };
}

test("account/read results: signed out only without an account while OpenAI auth is required", () => {
  assert.deepEqual(codexAuthFromAccount(SIGNED_OUT), { ok: false });
  assert.deepEqual(codexAuthFromAccount(SIGNED_IN), {
    ok: true,
    method: "chatgpt",
    email: "fixture@example.com",
    plan: "plus",
    workspace: "Studio",
  });
  assert.deepEqual(
    codexAuthFromAccount({ account: { type: "apiKey" }, requiresOpenaiAuth: true }),
    { ok: true, method: "apiKey" },
  );
  assert.deepEqual(
    codexAuthFromAccount({ account: null, requiresOpenaiAuth: false }),
    { ok: true, method: "none" },
    "a provider without OpenAI auth (local models) is not signed out",
  );
  assert.deepEqual(codexAuthFromAccount(null), { ok: false });
  // Display account (Settings › Agents, named accounts): account/read instead of decoding auth.json.
  assert.deepEqual(tools.codexAccountFromRead(SIGNED_IN), {
    email: "fixture@example.com",
    organization: "Studio",
    plan: "ChatGPT Plus",
    method: "ChatGPT",
  });
  assert.deepEqual(tools.codexAccountFromRead({ account: { type: "apiKey" } }), {
    email: "",
    organization: "",
    plan: "API key",
    method: "API key",
  });
  assert.equal(tools.codexAccountFromRead(SIGNED_OUT), null);
});

test("mapper: 401 retries become one auth-required event; later retries, errors and the failed turn are dropped", () => {
  const map = createCodexMapper();
  const info = { responseStreamDisconnected: { httpStatusCode: 401 } };
  const out = [];
  for (let i = 1; i <= 5; i++)
    out.push(
      ...map({
        method: "error",
        params: {
          threadId: "t",
          willRetry: true,
          error: { message: `Reconnecting... ${i}/5`, codexErrorInfo: info },
        },
      }),
    );
  out.push(
    ...map({
      method: "error",
      params: {
        threadId: "t",
        willRetry: false,
        error: { message: "unexpected status 401 Unauthorized", codexErrorInfo: info },
      },
    }),
  );
  out.push(
    ...map({
      method: "turn/completed",
      params: {
        threadId: "t",
        turn: {
          id: "x",
          status: "failed",
          error: { message: "unexpected status 401 Unauthorized", codexErrorInfo: info },
        },
      },
    }),
  );
  assert.deepEqual(
    out.map((e) => e.type),
    ["status", "auth-required", "turn-complete"],
  );
  assert.equal(out[1].text, CODEX_SIGNED_OUT);
  // A final 401 without retries, and the `unauthorized` error info, map the same way.
  assert.deepEqual(
    createCodexMapper()({
      method: "error",
      params: { willRetry: false, error: { message: "nope", codexErrorInfo: "unauthorized" } },
    }).map((e) => e.type),
    ["auth-required"],
  );
  assert.deepEqual(
    createCodexMapper()({
      method: "turn/completed",
      params: {
        turn: {
          status: "failed",
          error: {
            message:
              "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
          },
        },
      },
    }).map((e) => e.type),
    ["auth-required", "turn-complete"],
  );
  // Other errors keep their text, and 5xx retries stay plain status lines.
  assert.deepEqual(
    createCodexMapper()({
      method: "error",
      params: {
        willRetry: true,
        error: {
          message: "Reconnecting... 1/5",
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
        },
      },
    }),
    [{ type: "status", text: "Retrying: Reconnecting... 1/5" }],
  );
  assert.deepEqual(
    createCodexMapper()({
      method: "error",
      params: {
        willRetry: false,
        error: { message: "Model not found", codexErrorInfo: "modelNotFound" },
      },
    }),
    [{ type: "error", text: "Model not found" }],
  );
  assert.equal(
    isAuthError({ message: "usage limit reached", codexErrorInfo: "usageLimitExceeded" }),
    false,
  );
  assert.equal(
    isAuthError({
      message: "Forbidden",
      codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 403 } },
    }),
    false,
  );
  // exec --json: the first 401 text becomes auth-required, the rest is dropped.
  const exec = createCodexExecMapper();
  const execOut = [
    ...exec({ type: "error", message: "Reconnecting... 1/5 (unexpected status 401 Unauthorized)" }),
    ...exec({ type: "error", message: "Reconnecting... 2/5 (unexpected status 401 Unauthorized)" }),
    ...exec({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized" } }),
  ];
  assert.deepEqual(
    execOut.map((e) => e.type),
    ["auth-required"],
  );
});

test("signed-out account: no thread or turn starts, one auth-required event with the account, no error", async (t) => {
  const { runtime, events, until, log } = await setup(t, { account: SIGNED_OUT });
  const started = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "Make a poster",
    access: "edit",
  });
  assert.equal(started.runtime, "codex-app-server");
  const done = await until((e) => e.type === "done");
  assert.equal(done.code, 1);
  assert.equal(done.stopped, false);
  const auth = events.filter((e) => e.type === "auth-required");
  assert.equal(auth.length, 1);
  assert.deepEqual(
    [auth[0].agent, auth[0].account.id, auth[0].account.system, auth[0].text],
    ["codex", "system", true, CODEX_SIGNED_OUT],
  );
  assert.equal(
    events.filter((e) => e.type === "error").length,
    0,
    "no raw error next to the sign-in card",
  );
  const calls = await read(log);
  assert.ok(
    calls.some((c) => c.rpc === "account/read"),
    "the gate asks the account app-server",
  );
  assert.equal(
    calls.filter(
      (c) => c.rpc === "thread/start" || c.rpc === "thread/resume" || c.rpc === "turn/start",
    ).length,
    0,
    "no thread or turn was started",
  );
  // A negative answer is not cached: the next turn asks again.
  events.length = 0;
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "Again", access: "edit" });
  await until((e) => e.type === "done");
  assert.equal((await read(log)).filter((c) => c.rpc === "account/read").length, 2);
  // Helpers (ask_agent, second opinion) refuse with the same message instead of retrying.
  await assert.rejects(
    () => runtime.ask({ task: "Check this", agent: "codex" }),
    /Codex is signed out/,
  );
});

test("signed-in account: account/read is cached per account, then re-read after a sign-in change", async (t) => {
  const { runtime, events, until, log } = await setup(t, { account: SIGNED_IN });
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "First", access: "edit" });
  assert.equal((await until((e) => e.type === "done")).code, 0);
  events.length = 0;
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "Second", access: "edit" });
  assert.equal((await until((e) => e.type === "done")).code, 0);
  let calls = await read(log);
  assert.equal(
    calls.filter((c) => c.rpc === "account/read").length,
    1,
    "a positive answer is reused within the TTL",
  );
  assert.equal(calls.filter((c) => c.rpc === "turn/start").length, 2);
  // Sign-in/out from Settings or the chat card (desktop/agent-auth.cjs) forgets it and retires the idle app-server.
  agentAuth.accountChanged("codex", "system");
  events.length = 0;
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "Third", access: "edit" });
  assert.equal((await until((e) => e.type === "done")).code, 0);
  calls = await read(log);
  assert.equal(calls.filter((c) => c.rpc === "account/read").length, 2);
  assert.equal(
    calls.filter((c) => c.args && c.args[0] === "app-server" && !c.args.includes("--help")).length,
    2,
    "a fresh app-server reads the new credentials",
  );
  assert.equal(events.filter((e) => e.type === "auth-required").length, 0);
});

test("401 mid-turn: one auth-required card, the turn is interrupted, no retry noise or duplicate error", async (t) => {
  const { runtime, events, until, log } = await setup(t, { account: SIGNED_IN });
  const started = Date.now();
  await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "unauthorized please",
    access: "edit",
  });
  const done = await until((e) => e.type === "done");
  assert.ok(
    Date.now() - started < 2500,
    "the runtime stops the turn instead of waiting out the retries",
  );
  assert.deepEqual([done.code, done.stopped], [1, false]);
  assert.equal(events.filter((e) => e.type === "auth-required").length, 1);
  assert.equal(events.filter((e) => e.type === "error").length, 0);
  assert.equal(
    events.filter((e) => e.type === "status" && /Retrying|Reconnecting/.test(e.text)).length,
    0,
  );
  assert.ok((await read(log)).some((c) => c.rpc === "turn/interrupt"));
  // The cached sign-in is forgotten, so the next turn checks again.
  events.length = 0;
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "hello", access: "edit" });
  await until((e) => e.type === "done");
  assert.equal((await read(log)).filter((c) => c.rpc === "account/read").length, 2);
});

test("exec fallback: `codex login status` gates the turn; a 401 in the stream becomes one auth-required", async (t) => {
  const { runtime, events, until, log, home } = await setup(t, {
    account: SIGNED_OUT,
    appServer: false,
  });
  const started = await runtime.run({
    agent: "codex",
    chatId: CHAT,
    prompt: "Quick question",
    access: "edit",
  });
  assert.equal(started.runtime, "codex-exec");
  const done = await until((e) => e.type === "done");
  assert.equal(done.code, 1);
  assert.equal(events.filter((e) => e.type === "auth-required").length, 1);
  assert.equal(events.filter((e) => e.type === "error").length, 0);
  let calls = await read(log);
  assert.ok(calls.some((c) => c.args?.join(" ") === "login status"));
  assert.equal(calls.filter((c) => c.args?.[0] === "exec").length, 0, "exec never ran");
  // Signed in, but the request is rejected mid-stream.
  await fs.writeFile(path.join(home, "fake-account.json"), JSON.stringify(SIGNED_IN));
  events.length = 0;
  await runtime.run({ agent: "codex", chatId: CHAT, prompt: "unauthorized now", access: "edit" });
  const second = await until((e) => e.type === "done");
  assert.deepEqual([second.code, second.stopped], [1, false]);
  assert.equal(events.filter((e) => e.type === "auth-required").length, 1);
  assert.equal(events.filter((e) => e.type === "error").length, 0);
  calls = await read(log);
  assert.equal(calls.filter((c) => c.args?.[0] === "exec").length, 1);
});

test("display account: account/read first, auth.json only as a fallback", async (t) => {
  const { home, root } = await setup(t, { account: SIGNED_IN });
  const codex = path.join(root, "bin", "codex");
  assert.deepEqual(await tools.codexAccount({ executable: codex, codexHome: home }), {
    email: "fixture@example.com",
    organization: "Studio",
    plan: "ChatGPT Plus",
    method: "ChatGPT",
  });
  // A CLI without account/read (fake without fake-account.json) falls back to the id_token claims.
  await fs.rm(path.join(home, "fake-account.json"));
  const claims = Buffer.from(
    JSON.stringify({
      email: "claims@example.com",
      "https://api.openai.com/auth": { chatgpt_plan_type: "pro" },
    }),
  ).toString("base64url");
  await fs.writeFile(
    path.join(home, "auth.json"),
    JSON.stringify({ tokens: { id_token: `x.${claims}.y` } }),
  );
  assert.deepEqual(await tools.codexAccount({ executable: codex, codexHome: home }), {
    email: "claims@example.com",
    organization: "",
    plan: "ChatGPT Pro",
    method: "ChatGPT",
  });
});

let realCodex = null;
try {
  realCodex =
    execFileSync("/bin/sh", ["-c", "command -v codex"], { encoding: "utf8" }).trim() || null;
} catch {}
test(
  "real Codex with an empty CODEX_HOME: account/read reports signed out and no turn starts",
  { skip: !realCodex && "codex is not installed" },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-signed-out-"));
    const home = path.join(root, "codex-home");
    await fs.mkdir(home);
    const saved = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    const events = [];
    const runtime = new AgentRuntime({
      userData: path.join(root, "userData"),
      home: path.join(root, "home"),
      discover: async () => [{ id: "codex", available: true, path: realCodex }],
      getBridge: async () => null,
      loadPreferences: async () => [],
      emit: (e) => events.push(e),
    });
    t.after(async () => {
      runtime.close();
      if (saved === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = saved;
      await fs.rm(root, { recursive: true, force: true });
    });
    const started = Date.now();
    await runtime.run({ agent: "codex", chatId: CHAT, prompt: "hi", access: "ask" });
    const end = Date.now() + 20000;
    while (!events.some((e) => e.type === "done") && Date.now() < end)
      await new Promise((r) => setTimeout(r, 20));
    const done = events.find((e) => e.type === "done");
    assert.ok(done, "the run ended: " + JSON.stringify(events.map((e) => e.type)));
    assert.equal(done.code, 1);
    assert.ok(Date.now() - started < 15000, "answered by account/read, not after ~17 s of retries");
    assert.deepEqual(
      events.filter((e) => e.type !== "done").map((e) => e.type),
      ["auth-required"],
    );
    assert.equal(
      events.some((e) => e.type === "session"),
      false,
      "no Codex thread was opened",
    );
    await assert.rejects(() => fs.access(path.join(home, "auth.json")), "nothing signed in");
  },
);
