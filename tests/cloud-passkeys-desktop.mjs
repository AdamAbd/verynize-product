// Passkeys end to end in Electron: the Share panel opens the server's /passkey window, Chromium's
// virtual authenticator (CDP WebAuthn domain) performs the real ceremony, and the desktop claims
// the session through the handoff. Runs against local workerd only.
import { Miniflare } from "miniflare";
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-passkeys-ui-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
try {
  const direct = (await mf.ready).origin;
  const server = direct.replace("127.0.0.1", "localhost"); // WebAuthn relying parties must be domains, not IPs
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, "profile")}`] });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.design && !!window.cloudWorkspace);
  page.on("dialog", (dialog) => dialog.accept());
  const statusIncludes = (text) =>
    page.waitForFunction(
      (text) => document.getElementById("cloud-status").textContent.includes(text),
      text,
    );
  await page.evaluate(() => {
    document.getElementById("cloud-dialog").showModal();
    document.getElementById("cloud-account-section").open = true;
  });
  await page.locator("#cloud-server").fill(server);

  // Magic-link sign-in first, then register a passkey for the account.
  await page.locator("#cloud-email").fill("alice@example.test");
  await page.locator("#cloud-signin-start").click();
  await statusIncludes("Check alice@example.test");
  const { messages } = await (
    await fetch(`${direct}/api/dev/outbox?to=alice%40example.test`)
  ).json();
  await page.locator("#cloud-signin-code").fill(messages[0].link);
  await page.locator("#cloud-signin-verify").click();
  await page.waitForFunction(() => !document.getElementById("cloud-signed-in").hidden);

  async function ceremonyWindow(trigger) {
    const [popup] = await Promise.all([app.waitForEvent("window"), trigger()]);
    await popup.waitForLoadState("domcontentloaded");
    assert.equal(new URL(popup.url()).origin, server);
    assert.equal(
      await popup.evaluate(() => typeof window.desktop),
      "undefined",
      "the passkey window has no preload bridge",
    );
    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    // Credentials are captured as the authenticator creates them (the panel closes the window right after).
    const added = new Promise((resolve) =>
      cdp.on("WebAuthn.credentialAdded", (event) => resolve(event.credential)),
    );
    return { popup, cdp, authenticatorId, added };
  }
  const registration = await ceremonyWindow(() => page.locator("#cloud-passkey-add").click());
  await registration.popup.locator("#passkey-go").click();
  await statusIncludes("Passkey added");
  await page.waitForFunction(
    () => document.querySelectorAll("#cloud-passkeys [data-remove-passkey]").length === 1,
  );
  const credentials = [await registration.added];
  assert.equal(credentials[0].isResidentCredential, true);
  assert.equal(credentials[0].rpId, "localhost");
  await registration.popup.waitForEvent("close", { timeout: 5000 }).catch(() => {});
  assert.equal(
    registration.popup.isClosed(),
    true,
    "the panel closes the ceremony window when done",
  );

  // Sign out, then sign back in with only the passkey (same authenticator credential).
  const oldSession = await page.evaluate(
    () => JSON.parse(localStorage.getItem("verynize.cloud.account")).session,
  );
  await page.locator("#cloud-signout").click();
  await page.waitForFunction(() => !document.getElementById("cloud-signed-out").hidden);
  assert.equal(
    (await fetch(`${direct}/api/me`, { headers: { "x-verynize-session": oldSession } })).status,
    401,
  );
  await page.locator("#cloud-email").fill("alice@example.test");
  const signin = await ceremonyWindow(() => page.locator("#cloud-passkey-signin").click());
  await signin.cdp.send("WebAuthn.addCredential", {
    authenticatorId: signin.authenticatorId,
    credential: credentials[0],
  });
  await signin.popup.locator("#passkey-go").click();
  await statusIncludes("Signed in with a passkey as alice@example.test");
  await page.waitForFunction(() => !document.getElementById("cloud-signed-in").hidden);
  const session = await page.evaluate(
    () => JSON.parse(localStorage.getItem("verynize.cloud.account")).session,
  );
  assert.equal(
    (await (await fetch(`${direct}/api/me`, { headers: { "x-verynize-session": session } })).json())
      .account.email,
    "alice@example.test",
  );
  const passkeys = (
    await (
      await fetch(`${direct}/api/me/passkeys`, { headers: { "x-verynize-session": session } })
    ).json()
  ).passkeys;
  assert.equal(passkeys.length, 1);
  assert.ok(passkeys[0].lastUsedAt > 0, "the server recorded the verified assertion");

  // Removing the passkey makes the next passkey sign-in fail inside the ceremony window.
  await page.locator("#cloud-passkeys [data-remove-passkey]").click();
  await page.waitForFunction(() =>
    document.getElementById("cloud-passkeys").textContent.includes("No passkeys yet"),
  );
  await page.locator("#cloud-signout").click();
  await page.waitForFunction(() => !document.getElementById("cloud-signed-out").hidden);
  await page.locator("#cloud-email").fill("alice@example.test");
  const refused = await ceremonyWindow(() => page.locator("#cloud-passkey-signin").click());
  await refused.cdp.send("WebAuthn.addCredential", {
    authenticatorId: refused.authenticatorId,
    credential: credentials[0],
  });
  await refused.popup.locator("#passkey-go").click();
  await refused.popup.waitForFunction(() =>
    document
      .getElementById("passkey-status")
      .textContent.includes("No passkey is registered for that email"),
  );
  assert.equal(
    await page.evaluate(() => !document.getElementById("cloud-signed-out").hidden),
    true,
  );
  console.log(
    "PASS desktop passkeys: server-origin ceremony window without preload, virtual authenticator registration (resident ES256), handoff sign-in after sign-out, assertion recorded, removal refuses sign-in",
  );
} finally {
  await app?.close();
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
