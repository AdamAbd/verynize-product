// The emailed account pages in a real browser window (Electron with no preload, like a browser
// tab): a verification link lands on /account/verified, and the password-reset page checks the
// repeated password, removes the token from the address bar, saves the new password and refuses
// its link afterwards.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-account-pages-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
try {
  const server = (await mf.ready).origin;
  const post = (route, body) =>
    fetch(server + route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const outbox = async (email) =>
    (await (await fetch(`${server}/api/dev/outbox?to=${encodeURIComponent(email)}`)).json())
      .messages;
  const email = "gina@example.test";
  assert.equal(
    (
      await post("/api/auth/sign-up/email", {
        email,
        password: "gina first password",
        name: "Gina",
        callbackURL: "/account/verified",
      })
    ).status,
    200,
  );

  // A bare window with no preload or node integration stands in for the user's browser.
  const main = path.join(dir, "browser.cjs");
  await fs.writeFile(
    main,
    `const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => new BrowserWindow({ show: false, webPreferences: { sandbox: true } }).loadURL("about:blank"));`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  app = await electron.launch({
    env,
    args: [main, `--user-data-dir=${path.join(dir, "profile")}`],
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

  await page.goto((await outbox(email)).find((m) => /Verify/.test(m.subject)).link);
  assert.equal(new URL(page.url()).pathname, "/account/verified");
  assert.equal(await page.locator("h1").textContent(), "Email verified");

  assert.equal(
    (
      await post("/api/auth/request-password-reset", {
        email,
        redirectTo: "/account/reset-password",
      })
    ).status,
    200,
  );
  const resetLink = (await outbox(email)).find((m) => /Reset/.test(m.subject)).link;
  await page.goto(resetLink);
  await page.waitForFunction(() => location.search === "");
  assert.equal(new URL(page.url()).pathname, "/account/reset-password");
  await page.locator("#reset-password").fill("gina second password");
  await page.locator("#reset-confirm").fill("gina other password");
  await page.locator("#reset-submit").click();
  assert.equal(await page.locator("#reset-status").textContent(), "The passwords do not match.");
  await page.locator("#reset-confirm").fill("gina second password");
  await page.locator("#reset-submit").click();
  await page.waitForFunction(() => document.body.dataset.done === "true");
  assert.match(await page.locator("#reset-status").textContent(), /Password changed/);
  assert.deepEqual(errors, []);

  assert.equal(
    (await post("/api/auth/sign-in/email", { email, password: "gina first password" })).status,
    401,
  );
  assert.equal(
    (await post("/api/auth/sign-in/email", { email, password: "gina second password" })).status,
    200,
  );
  await page.goto(resetLink);
  assert.equal(await page.locator("h1").textContent(), "Reset link not valid");

  console.log(
    "PASS account pages in a browser window: verification landing, reset form (mismatch, token removed from URL, saved), used link refused",
  );
} finally {
  await app?.close();
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
