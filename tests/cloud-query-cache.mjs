// Server state in the islands (TanStack Query, web/src/lib/query) against local workerd: cached
// workspaces and rooms are scoped to the signed-in identity, so signing out clears them and
// switching accounts never shows the previous account's organizations or rooms, not even for a
// frame; Settings › Members mutations (invite, cancel, role change, remove) update the page
// without reopening it.
import { Miniflare } from "miniflare";
import { _electron as electron } from "@playwright/test";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-query-cache-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
try {
  const server = (await mf.ready).origin;
  const api = (route, session, body) =>
    fetch(server + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-verynize-session": session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(async (response) => {
      const text = await response.text();
      assert.ok(response.ok, `${route}: ${response.status} ${text}`);
      return text ? JSON.parse(text) : null;
    });
  const doc = (name) => ({
    version: 2,
    name,
    activePage: "p1",
    pages: [{ id: "p1", name: "Page 1", nodes: [] }],
    tokens: {},
  });
  const password = "a long enough password";
  const ana = await passwordUser(server, "ana@example.test", "Ana", fetch, "192.0.2.30");
  const budi = await passwordUser(server, "budi@example.test", "Budi", fetch, "192.0.2.31");
  // Ana: a team "Ana Studio" with a room in it. Budi: a room in his personal workspace.
  const studio = await api("/api/auth/organization/create", ana, {
    name: "Ana Studio",
    slug: "ana-studio",
  });
  const anaRoom = await api("/api/rooms", ana, {
    document: doc("Ana secret plan"),
    organizationId: studio.id,
  });
  const budiRoom = await api("/api/rooms", budi, { document: doc("Budi brief") });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`],
    timeout: 20000,
  });
  const page = await app.firstWindow({ timeout: 20000 });
  await waitForUiReady(page);
  await page.waitForFunction(
    () => !!window.cloudAccount && !!window.fileLibrary && !!window.__bdQueryCache,
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  const signIn = (email) =>
    page.evaluate(
      ({ server, email, password }) => window.cloudAccount.signIn({ server, email, password }),
      { server, email, password },
    );
  const accountId = () => page.evaluate(() => window.cloudAccount.get()?.account.id);
  // Cloud entries holding data or belonging to an account (signed-out placeholders are neither).
  const cloudKeys = () =>
    page.evaluate(() =>
      window
        .__bdQueryCache()
        .filter(({ key, data }) => key[0] === "cloud" && (data || key[1] !== ""))
        .map(({ key }) => key),
    );
  const card = (id) => page.locator(`#file-home [data-room-id="${id}"]`);
  // Records whether any of `needles` is ever rendered from now on (checked on every DOM change).
  const watchFor = (needles) =>
    page.evaluate((needles) => {
      const seen = (window.__leaked = []);
      const check = () => {
        const text = document.body.innerText;
        for (const needle of needles)
          if (
            (text.includes(needle) || document.querySelector(`[data-room-id="${needle}"]`)) &&
            !seen.includes(needle)
          )
            seen.push(needle);
      };
      window.__leakObserver?.disconnect();
      window.__leakObserver = new MutationObserver(check);
      window.__leakObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      check();
    }, needles);
  const leaked = () => page.evaluate(() => window.__leaked);

  // 1. Ana: her team's room is listed in the Files home and cached under her scope only.
  await signIn("ana@example.test");
  const anaId = await accountId();
  await page.evaluate((id) => window.cloudAccount.setActiveOrganization(id), studio.id);
  await page.evaluate(() => window.fileLibrary.showHome());
  await card(anaRoom.id).waitFor();
  await page.waitForFunction(() =>
    document.getElementById("workspace-profile").textContent.includes("Ana Studio"),
  );
  let keys = await cloudKeys();
  assert.ok(keys.length > 0, "workspaces and rooms are cached");
  assert.ok(
    keys.every((key) => key[1] === server && key[2] === anaId),
    `every cloud key is scoped to Ana: ${JSON.stringify(keys)}`,
  );
  assert.ok(keys.some((key) => key[3] === "organizations"));
  assert.ok(keys.some((key) => key[3] === "rooms" && key[4] === studio.id));

  // 2. Sign-out clears every account-scoped entry; nothing of Ana's is rendered afterwards.
  await page.evaluate(() => window.cloudAccount.signOut());
  await page.waitForFunction(() => !window.cloudAccount.get());
  assert.deepEqual(await cloudKeys(), [], "sign-out clears the cloud cache");
  await card(anaRoom.id).waitFor({ state: "detached" });
  await watchFor(["Ana Studio", "Ana secret plan", anaRoom.id]);

  // 3. Budi signs in on the same window: only his rooms, never Ana's, not even while loading.
  await signIn("budi@example.test");
  const budiId = await accountId();
  assert.notEqual(budiId, anaId);
  await card(budiRoom.id).waitFor();
  await page.locator("#workspace-profile").click();
  await page.waitForSelector("#workspace-create");
  await page.keyboard.press("Escape");
  assert.deepEqual(await leaked(), [], "nothing of Ana's is shown to Budi");
  keys = await cloudKeys();
  assert.ok(
    keys.length > 0 && keys.every((key) => key[2] === budiId),
    `only Budi's scope is cached: ${JSON.stringify(keys)}`,
  );

  // 4. Switching straight back to Ana (no sign-out in between) drops Budi's cache before anything
  // renders for Ana: checked from a change listener that runs right after the cache's own one.
  await page.evaluate((budiId) => {
    window.__keysAtSwitch = null;
    window.addEventListener(
      "cloud-account-changed",
      () => {
        window.__keysAtSwitch = window
          .__bdQueryCache()
          .filter(({ key }) => key[2] === budiId)
          .map(({ key }) => key);
      },
      { once: true },
    );
  }, budiId);
  await signIn("ana@example.test");
  assert.deepEqual(
    await page.evaluate(() => window.__keysAtSwitch),
    [],
    "Budi's entries are gone when the account changes",
  );
  await card(anaRoom.id).waitFor();
  assert.equal(await card(budiRoom.id).count(), 0);
  keys = await cloudKeys();
  assert.ok(
    keys.every((key) => key[2] === anaId),
    `the switch drops Budi's scope: ${JSON.stringify(keys)}`,
  );

  // 5. Settings › Members: each mutation updates the page by itself.
  await page.evaluate(() => window.appSettings.open("members"));
  await page.waitForSelector(`#members-page[data-organization="${studio.id}"]`);
  await page.waitForSelector('[data-org-member="ana@example.test"]');
  const pendingCount = () =>
    page
      .locator('section[aria-labelledby="members-overview-label"]')
      .textContent()
      .then((text) => Number(/Pending invitations\s*(\d+)/.exec(text)?.[1]));
  assert.equal(await pendingCount(), 0);
  // Invite: the pending invitation and the count appear.
  await page.locator("#members-invite").click();
  await page.locator("#members-invite-email").fill("budi@example.test");
  await page.locator("#members-invite-send").click();
  await page.waitForSelector('[data-cancel-invitation="budi@example.test"]');
  assert.equal(await pendingCount(), 1);
  // Cancel: it disappears.
  await page.locator('[data-cancel-invitation="budi@example.test"]').click();
  await page.waitForSelector('[data-cancel-invitation="budi@example.test"]', {
    state: "detached",
  });
  assert.equal(await pendingCount(), 0);
  // Budi joins through the API; the page shows him once it is opened again.
  await api("/api/auth/organization/invite-member", ana, {
    email: "budi@example.test",
    role: "member",
    organizationId: studio.id,
  });
  const [invitation] = await api("/api/auth/organization/list-user-invitations", budi);
  await api("/api/auth/organization/accept-invitation", budi, { invitationId: invitation.id });
  await page.locator('[data-section="account"]').click();
  await page.locator('[data-section="members"]').click();
  await page.waitForSelector('[data-org-member="budi@example.test"]');
  // Role change: the server's new role is what the page shows.
  await page.locator('[data-org-member-role="budi@example.test"]').selectOption("admin");
  await page.waitForFunction(
    () => document.querySelector('[data-org-member-role="budi@example.test"]')?.value === "admin",
  );
  const budiMember = (
    await api(`/api/auth/organization/get-full-organization?organizationId=${studio.id}`, ana)
  ).members.find((member) => member.user.email === "budi@example.test");
  assert.equal(budiMember.role, "admin");
  // Remove: the row disappears.
  await page.locator('[data-org-remove-member="budi@example.test"]').click();
  await page.waitForSelector('[data-org-member="budi@example.test"]', { state: "detached" });
  const after = await api(
    `/api/auth/organization/get-full-organization?organizationId=${studio.id}`,
    ana,
  );
  assert.equal(after.members.length, 1);

  // 6. Signing out from the Members page clears the cache and shows the sign-in entry.
  await page.evaluate(() => window.cloudAccount.signOut());
  await page.waitForSelector("#members-sign-in");
  assert.deepEqual(await cloudKeys(), []);

  console.log(
    "PASS cloud query cache: identity-scoped keys, sign-out clears the cache, account switches never render the previous account's workspaces or rooms, Members invite/cancel/role change/remove update the page by themselves",
  );
} finally {
  await app?.close().catch(() => {});
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
