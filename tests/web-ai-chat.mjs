// Browser test of the web chat on the model API runtime (docs/ai-runtime.md "Clients"): the Node build of the web app
// (web-start/node/server.mjs, vite.node.config.ts) in front of the real backend (cloud/worker.js on the Node runtime,
// tests/helpers/node-cloud.mjs), opened in Chromium. The LLM provider is the only fake
// (tests/helpers/fake-openrouter.mjs); the account, room, database, tools and the web transport
// (web/src/lib/agent-service.ts) are real.
//
// Checks: signed out → "Sign in to use chat"; signed in without a room → "Open or share a cloud room…"; joined through
// the editor's #room= invite → a sent message streams assistant text into the transcript, a read tool call renders
// with its result from the room, the next turn carries the earlier ones as history, a dropped connection resumes
// through GET /api/ai/runs/:id/events?after=, Stop cancels a running turn, the model picker lists the server's
// models and never Claude/Codex; a server without OPENROUTER_API_KEY → "Model API not configured on this server".
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./helpers/web-app.mjs";
import { startFakeOpenRouter } from "./helpers/fake-openrouter.mjs";

// cloudOptions on the Node runtime: no workerd bundle build; the Node server runs cloud/worker.js itself.
process.env.CLOUD_RUNTIME = "node";
const { cloudOptions, passwordUser } = await import("./cloud-harness.mjs");
const { NodeCloud } = await import("./helpers/node-cloud.mjs");
const { createWebServer } = await import("../web-start/node/server.mjs");

const root = fileURLToPath(new URL("../", import.meta.url));
if (!fs.existsSync(path.join(root, "web/dist/ui.js")))
  execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
execFileSync(
  process.execPath,
  ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
  {
    cwd: root,
    stdio: "pipe",
  },
);

const fake = await startFakeOpenRouter({
  tree: [
    [{ text: "Let me look at the room." }, { tool: "get_element_tree", args: {} }],
    [{ text: "The room has a Hero artboard." }],
  ],
  stream: [[{ text: "First part arrives " }, { delay: 1500 }, { text: "and then the rest." }]],
  drop: [[{ text: "Before the drop " }, { delay: 2500 }, { text: "after the reconnect." }]],
  slow: [[{ text: "Working on it" }, { hang: true }]],
  default: [[{ text: "ok" }]],
});
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "verynize-web-ai-chat-"));
const options = await cloudOptions(path.join(temp, "state"));
const baseEnv = { ...options.workers[0].config.env };
const aiEnv = {
  OPENROUTER_API_KEY: { type: "text", value: "web-chat-test-key" },
  OPENROUTER_BASE_URL: { type: "text", value: fake.baseUrl },
  VERYNIZE_AI_MODELS: { type: "text", value: "fake/alpha=Fake Alpha,fake/beta=Fake Beta" },
};
options.workers[0].config.env = { ...baseEnv, ...aiEnv };
const backend = new NodeCloud(options);
const backendOrigin = (await backend.ready).origin;
const web = await createWebServer({
  dist: path.join(root, "dist/web-node"),
  backend: backendOrigin,
});
await new Promise((resolve) => web.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${web.address().port}`;

let browser;
try {
  // A real account and a room with one artboard, through the web server (the browser's origin).
  const token = await passwordUser(origin, "chat@example.test", "Chat");
  const api = (route, init = {}) =>
    fetch(origin + route, {
      ...init,
      headers: { "content-type": "application/json", "x-verynize-session": token, ...init.headers },
    });
  const me = await (await api("/api/me")).json();
  const created = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      document: {
        version: 2,
        name: "Chat room",
        pages: [
          {
            id: "p1",
            name: "Page 1",
            nodes: [{ id: "hero", type: "rectangle", name: "Hero", x: 0, y: 0, w: 400, h: 300 }],
          },
        ],
        tokens: {},
      },
    }),
  });
  assert.ok(created.ok, await created.clone().text());
  const room = await created.json();

  browser = await launchBrowser();
  const errors = [];
  const watch = (page) =>
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
  const ready = async (page) => {
    await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 30000,
    });
    await page.evaluate(() => window.agentWorkspace.openChat());
  };
  const gate = (page) => page.locator("#chat-web-gate");

  // ---- signed out ----
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 870 } });
    watch(page);
    await page.goto(origin + "/editor");
    await ready(page);
    await gate(page).waitFor();
    assert.equal(await gate(page).getAttribute("data-state"), "signed-out");
    assert.match(await gate(page).innerText(), /^Sign in to use chat/);
    assert.match(
      await gate(page).innerText(),
      /Claude Code and Codex sign-ins work in the desktop app only/,
    );
    assert.equal(
      await page.locator("#project-prompt").isVisible(),
      false,
      "no composer while signed out",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        kind: window.verynizePlatform.kind,
        capabilities: Object.values(window.verynizePlatform.capabilities).some(Boolean),
        service: window.verynizePlatform.agents.service()?.kind,
        ready: window.verynizePlatform.agents.ready(),
        agents: [...document.getElementById("project-agent").options].map((o) => o.value),
      })),
      { kind: "web", capabilities: false, service: "web", ready: false, agents: ["openrouter"] },
    );
    await page.close();
  }

  // ---- signed in (same session store as cloud-panel.js) ----
  const signedInContext = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 870 } });
    const session = JSON.stringify({
      server: origin,
      session: token,
      account: me.account,
      personalOrganizationId: me.personalOrganizationId || null,
    });
    // Top document only: sandboxed preview frames have no storage.
    await context.addInitScript(
      ([value]) => {
        if (window === window.top) localStorage.setItem("verynize.cloud.account", value);
      },
      [session],
    );
    return context;
  };
  const context = await signedInContext();
  const page = await context.newPage();
  watch(page);
  const requests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/editor");
  await ready(page);
  await page.waitForFunction(
    () => document.getElementById("chat-web-gate")?.dataset.state === "no-room",
  );
  assert.match(
    await gate(page).innerText(),
    /^Open or share a cloud room to chat with the model API/,
  );
  assert.ok(
    requests.includes("GET /api/ai/config"),
    "the config is fetched through the query layer: " + requests.join(", "),
  );
  assert.ok(
    await page.evaluate(() =>
      window.__bdQueryCache().some((entry) => entry.key.at(-1) === "ai-config" && entry.data),
    ),
    "the ai-config query is cached under the account scope",
  );

  // Join the room the way an invite link does (#room=, Share dialog › Join invite).
  await page.goto(origin + `/editor#room=${room.id}`);
  await page.reload(); // a fragment-only navigation does not load the page again
  await ready(page);
  await page.locator("#cloud-connect").click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, room.id);
  await page.evaluate(() => document.getElementById("cloud-dialog").close());
  await page.locator("#project-prompt").waitFor({ state: "visible" });
  assert.equal(await gate(page).count(), 0, "no gate once signed in with a room");

  const send = async (text) => {
    await page.locator("#project-prompt").fill(text);
    await page.locator("#project-prompt").press("Enter");
  };
  const lastReply = () =>
    page.evaluate(() => {
      const messages = window.agentWorkspace.getState().messages;
      return messages.findLast((m) => m.role === "assistant") || null;
    });
  const idle = () =>
    page.waitForFunction(() => !window.agentWorkspace.getState().busy, null, { timeout: 20000 });

  // Model picker: the server's models, no Claude/Codex.
  await page.locator(".agent-config summary").click();
  const menu = page.getByRole("menu");
  await menu.getByText("Fake Beta").waitFor();
  const menuText = await menu.innerText();
  assert.match(menuText, /Model API/);
  assert.match(menuText, /OpenRouter default/);
  assert.match(menuText, /Fake Alpha/);
  assert.doesNotMatch(menuText, /Claude|Codex|Effort/);
  await menu.getByText("Fake Beta").click();
  assert.equal(await page.locator("#bd-agent-model-label").innerText(), "Fake Beta");

  // Streamed text: the first part is in the transcript before the rest arrives.
  await send("[scenario:stream] Say something");
  const transcript = page.locator(".chat-message.assistant").last();
  await transcript.getByText("First part arrives").waitFor({ timeout: 15000 });
  assert.doesNotMatch(
    await transcript.innerText(),
    /and then the rest/,
    "text streams before the turn ends",
  );
  await transcript.getByText("and then the rest.").waitFor({ timeout: 15000 });
  await idle();
  let reply = await lastReply();
  assert.equal(reply.state, "complete");
  assert.equal(reply.agent, "openrouter");
  assert.equal(fake.requests.at(-1).body.model, "fake/beta", "the picked model is sent");

  // A read tool call against the room renders as a tool card with the room's content in its result.
  await send("[scenario:tree] What is in this room?");
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("The room has a Hero artboard.")
    .waitFor({ timeout: 20000 });
  await idle();
  reply = await lastReply();
  const tool = reply.parts.find((part) => part.kind === "tool");
  assert.equal(tool?.name, "get_element_tree");
  assert.equal(tool.state, "done");
  assert.match(tool.result, /Hero/);
  const card = page.locator(".chat-message.assistant").last().locator(".chat-tool");
  assert.ok((await card.count()) >= 1, "the tool call is rendered");
  // A finished turn folds its tool calls into the turn's details; the card is still rendered there.
  assert.match(await card.first().textContent(), /element.tree/i);
  // The model API keeps no session: the earlier turns travel as history.
  const sent = fake.requests.findLast((request) =>
    request.body.messages.some(
      (m) => m.role === "user" && /scenario:tree/.test(JSON.stringify(m.content)),
    ),
  );
  assert.ok(
    sent.body.messages.some(
      (m) => m.role === "user" && /scenario:stream/.test(JSON.stringify(m.content)),
    ),
    "the previous user turn is in the history",
  );

  // A dropped connection resumes from the last event through GET /events?after=.
  await send("[scenario:drop] Keep talking");
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("Before the drop")
    .waitFor({ timeout: 15000 });
  web.closeAllConnections();
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("after the reconnect.")
    .waitFor({ timeout: 20000 });
  await idle();
  reply = await lastReply();
  assert.equal(reply.state, "complete");
  assert.ok(
    requests.some((line) =>
      /^GET \/api\/ai\/runs\/[0-9a-f-]{36}\/events\?after=[1-9]\d*$/.test(line),
    ),
    "reconnected with events?after=: " +
      requests.filter((line) => line.includes("/api/ai/")).join(", "),
  );
  const text = reply.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)
    .join("");
  assert.equal(
    (text.match(/Before the drop/g) || []).length,
    1,
    "no event is applied twice: " + text,
  );

  // Stop cancels the running turn on the server.
  await send("[scenario:slow] Work for a while");
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("Working on it")
    .waitFor({ timeout: 15000 });
  await page.locator("#project-cancel").click();
  await idle();
  reply = await lastReply();
  assert.equal(reply.state, "stopped");
  const runId = requests
    .filter((line) => /^POST \/api\/ai\/runs\/[0-9a-f-]{36}\/cancel$/.test(line))
    .at(-1)
    ?.split("/")[4];
  assert.ok(runId, "the cancel request was sent");
  const events = await api(`/api/ai/runs/${runId}/events?after=0`);
  const body = await events.text();
  assert.match(body, /"type":"done","code":"cancelled"/);
  await page.close();
  await context.close();

  // ---- a server without an OpenRouter key ----
  const worker = options.workers[0];
  await backend.setOptions({
    ...options,
    workers: [{ ...worker, config: { ...worker.config, env: baseEnv } }],
  });
  {
    const context2 = await signedInContext();
    const off = await context2.newPage();
    watch(off);
    await off.goto(origin + "/editor");
    await ready(off);
    await off.waitForFunction(
      () => document.getElementById("chat-web-gate")?.dataset.state === "not-configured",
    );
    assert.match(await gate(off).innerText(), /^Model API not configured on this server/);
    assert.equal(await off.locator("#project-prompt").isVisible(), false);
    await context2.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log(
    "PASS web chat (model API): signed-out and not-configured states, room gate, streamed text, read tool call, history, reconnect with events?after=, cancel, model picker",
  );
} finally {
  await browser?.close();
  web.closeAllConnections?.();
  await new Promise((resolve) => web.close(resolve));
  await backend.dispose();
  await fake.close();
  await fsp.rm(temp, { recursive: true, force: true });
}
