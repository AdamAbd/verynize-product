// Cloud files against local workerd: a room is a file that the desktop reopens after a restart,
// the Files home lists workspace rooms and rooms shared with you, and edits made while the server
// is down survive an app restart and reach the room exactly once (persistent outbox).
import { Miniflare } from "miniflare";
import { _electron as electron } from "@playwright/test";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-cloud-files-"));
const options = await cloudOptions(path.join(dir, "state"));
let mf = new Miniflare(options);
const apps = new Set();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.VERYNIZE_SKIP_ONBOARDING = "1";
const password = "a long enough password";

async function launch(profile) {
  const app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, profile)}`],
    timeout: 20000,
  });
  apps.add(app);
  const page = await app.firstWindow({ timeout: 20000 });
  await waitForUiReady(page);
  await page.waitForFunction(
    () =>
      !!window.design && !!window.cloudWorkspace && !!window.fileLibrary && !!window.cloudAccount,
  );
  page.on("dialog", (dialog) => dialog.accept());
  return { app, page };
}
async function quit(app) {
  apps.delete(app);
  await app.close();
}
const room = (page) => page.evaluate(() => window.cloudWorkspace.room());
const files = (page) =>
  page.evaluate(() =>
    window.fileLibrary.list().map((f) => ({ id: f.id, name: f.name, cloud: f.cloud || null })),
  );
const synced = (page) =>
  page.waitForFunction(
    () =>
      window.cloudWorkspace.isConnected() &&
      window.cloudWorkspace.pendingCount() === 0 &&
      /Connected|Saved|Synced/.test(document.getElementById("cloud-status").textContent),
    null,
    { timeout: 40000 },
  );

try {
  let server = (await mf.ready).origin;
  options.port = Number(new URL(server).port);
  const api = (route, session, body, method) =>
    fetch(server + route, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", "x-verynize-session": session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(async (response) => {
      const text = await response.text();
      assert.ok(response.ok, `${route}: ${response.status} ${text}`);
      return text ? JSON.parse(text) : null;
    });
  const ana = await passwordUser(server, "ana@example.test", "Ana", fetch, "192.0.2.20");
  const budi = await passwordUser(server, "budi@example.test", "Budi", fetch, "192.0.2.21");
  const signIn = (page) =>
    page.evaluate(
      ({ server, password }) =>
        window.cloudAccount.signIn({ server, email: "ana@example.test", password }),
      { server, password },
    );

  // 1. Create a room from the open file: that file becomes the room's file.
  let { app, page } = await launch("a");
  await signIn(page);
  const fileId = await page.evaluate(() => window.fileLibrary.currentId);
  const textId = await page.evaluate(() =>
    window.design.addNode("text", { name: "Headline", text: "Hello" }),
  );
  await page.locator("#cloud-toggle").click();
  await page.locator("#cloud-server").fill(server);
  await page.locator("#cloud-create").click();
  await page.waitForFunction(() =>
    document.getElementById("cloud-invite").value.includes("token="),
  );
  await page.locator("#cloud-close").click();
  const roomId = (await room(page)).id;
  const cloud = await page.evaluate((id) => window.fileLibrary.cloudOf(id), fileId);
  assert.equal(cloud.server, server);
  assert.equal(cloud.roomId, roomId);
  assert.ok(!cloud.detached);
  const fileCount = (await files(page)).length;
  await page.evaluate(() => window.design.addNode("rectangle", { name: "online-1" }));
  await synced(page);

  // 2. Restart the app: the file reopens connected to the same room, with no new copy.
  await page.waitForFunction(
    async ({ server, roomId }) =>
      (await window.cloudWorkspace.storedOutbox(server, roomId))?.pending.length === 0,
    { server, roomId },
  );
  await quit(app);
  ({ app, page } = await launch("a"));
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await synced(page);
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
  assert.equal((await files(page)).length, fileCount);
  // Opening another file detaches; reopening the cloud file reconnects, still without a copy.
  await page.evaluate(async () => {
    const doc = window.design.getDocument();
    doc.name = "Local only";
    await window.fileLibrary.createFromDocument(doc);
  });
  assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
  await page.evaluate((id) => window.fileLibrary.open(id), fileId);
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await synced(page);
  assert.equal((await files(page)).filter((f) => f.cloud?.roomId === roomId).length, 1);
  const localCount = (await files(page)).length;

  // 3. Files home lists workspace rooms and rooms shared with you; opening one joins it once.
  const me = await api("/api/me", ana);
  const plan = await api("/api/rooms", ana, {
    document: {
      version: 2,
      name: "Workspace plan",
      activePage: "p1",
      pages: [{ id: "p1", name: "Page 1", nodes: [] }],
      tokens: {},
    },
    organizationId: me.personalOrganizationId,
  });
  const shared = await api("/api/rooms", budi, {
    document: {
      version: 2,
      name: "Budi brief",
      activePage: "p1",
      pages: [{ id: "p1", name: "Page 1", nodes: [] }],
      tokens: {},
    },
  });
  await api(`/api/rooms/${shared.id}/members`, budi, {
    email: "ana@example.test",
    role: "viewer",
  });
  // Budi's room lives in his personal workspace, so for Ana it is a direct share.
  await page.evaluate(() => window.fileLibrary.showHome());
  const card = (id) => page.locator(`#file-home [data-room-id="${id}"]`);
  await card(plan.id).waitFor();
  await card(shared.id).waitFor();
  assert.match(await card(shared.id).textContent(), /Shared with you/);
  assert.match(await card(shared.id).textContent(), /Viewer/);
  assert.match(await card(roomId).textContent(), /Owner/);
  assert.equal(await card(roomId).count(), 1, "the local cloud file and its room are one card");
  await card(plan.id).locator(".file-open").click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, plan.id);
  assert.equal(await page.evaluate(() => window.design.getDocument().name), "Workspace plan");
  assert.equal((await files(page)).length, localCount + 1);
  const planFile = (await files(page)).find((f) => f.cloud?.roomId === plan.id);
  assert.ok(planFile);
  await page.evaluate(() => window.fileLibrary.showHome());
  await card(plan.id).waitFor();
  assert.equal(await card(plan.id).count(), 1);
  assert.equal(await card(plan.id).getAttribute("data-file-id"), planFile.id);
  await card(plan.id).locator(".file-open").click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, plan.id);
  assert.equal((await files(page)).length, localCount + 1, "reopening does not copy");

  // 4. Offline edits: stop the server, edit, restart the app while offline, edit again, then
  // bring the server back. The room receives every edit exactly once.
  await page.evaluate((id) => window.fileLibrary.open(id), fileId);
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await synced(page);
  const before = await page.evaluate(
    ({ server, roomId }) => window.cloudWorkspace.storedOutbox(server, roomId),
    { server, roomId },
  );
  await mf.dispose();
  await page.evaluate((id) => {
    window.design.addNode("rectangle", { name: "offline-1" });
    window.design.updateNodes([id], (n) => ({ text: n.text + " offline" }));
  }, textId);
  await page.waitForFunction(
    async ({ server, roomId }) =>
      (await window.cloudWorkspace.storedOutbox(server, roomId))?.pending.length > 0,
    { server, roomId },
  );
  await quit(app);
  ({ app, page } = await launch("a"));
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await page.waitForFunction(() =>
    /Offline|interrupted|unavailable/.test(document.getElementById("cloud-status").textContent),
  );
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
  assert.equal(await page.evaluate(() => window.cloudWorkspace.pendingCount() > 0), true);
  await page.evaluate(() => window.design.addNode("rectangle", { name: "offline-2" }));
  await page.waitForFunction(
    async ({ server, roomId }) => {
      const stored = await window.cloudWorkspace.storedOutbox(server, roomId);
      return stored?.pending.some((b) => b.ops.some((op) => op.value?.name === "offline-2"));
    },
    { server, roomId },
  );
  const after = await page.evaluate(
    ({ server, roomId }) => window.cloudWorkspace.storedOutbox(server, roomId),
    { server, roomId },
  );
  assert.equal(after.clientId, before.clientId, "the same client id survives the restart");
  mf = new Miniflare(options);
  server = (await mf.ready).origin;
  await synced(page);
  const remote = await api(`/api/rooms/${roomId}`, ana);
  const named = (name) => remote.document.pages[0].nodes.filter((n) => n.name === name).length;
  assert.equal(named("online-1"), 1);
  assert.equal(named("offline-1"), 1);
  assert.equal(named("offline-2"), 1);
  assert.equal(
    remote.document.pages[0].nodes.find((n) => n.id === textId).text,
    "Hello offline",
    "the offline text edit is applied once",
  );
  // The stored outbox empties once the server acknowledged every batch.
  await page.waitForFunction(
    async ({ server, roomId }) =>
      (await window.cloudWorkspace.storedOutbox(server, roomId))?.pending.length === 0,
    { server, roomId },
  );

  // 5. A second device signed in as Ana opens the room from the Files home and sees the edits.
  const second = await launch("b");
  await signIn(second.page);
  await second.page.evaluate(() => window.fileLibrary.showHome());
  await second.page.locator(`#file-home [data-room-id="${roomId}"] .file-open`).click();
  await second.page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await second.page.waitForFunction((textId) => {
    const nodes = window.design.getDocument().pages[0].nodes;
    return (
      ["online-1", "offline-1", "offline-2"].every(
        (name) => nodes.filter((n) => n.name === name).length === 1,
      ) && nodes.find((n) => n.id === textId)?.text === "Hello offline"
    );
  }, textId);
  // Live edits still flow both ways.
  await second.page.evaluate(() => window.design.addNode("rectangle", { name: "from-b" }));
  await page.waitForFunction(() =>
    window.design.getDocument().pages[0].nodes.some((n) => n.name === "from-b"),
  );

  // 6. Disconnect keeps the local copy, marks it detached and forgets the stored outbox.
  await page.locator("#cloud-toggle").click();
  await page.locator("#cloud-leave").click();
  assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
  await page.waitForFunction(
    async ({ server, roomId }) => !(await window.cloudWorkspace.storedOutbox(server, roomId)),
    { server, roomId },
  );
  const detached = await page.evaluate((id) => window.fileLibrary.cloudOf(id), fileId);
  assert.equal(detached.detached, true);
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
  console.log(
    "PASS cloud files: create room marks the file, restart reconnects without copies, Files home lists workspace and shared rooms and joins once, offline edits across an app restart reach the room exactly once with the same client id, second device sees them, disconnect detaches and clears the outbox",
  );
} finally {
  await Promise.all([...apps].map((app) => app.close().catch(() => {})));
  await mf.dispose().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
}
