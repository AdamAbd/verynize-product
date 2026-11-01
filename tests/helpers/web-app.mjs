// Helpers for the browser tests of the web app (tests/web-*.mjs).
import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "@playwright/test";

/** A TCP port that was free a moment ago. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Spawn a long-running process in its own process group and wait until `ready` answers HTTP.
 * `stop()` kills the whole group (vp dev starts workerd children).
 */
export async function startProcess(command, args, { cwd, env, ready, timeout = 90000 }) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 5000);
    await exited;
    clearTimeout(timer);
  };
  const deadline = Date.now() + timeout;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${command} exited early:\n${output}`);
    try {
      const response = await fetch(ready);
      await response.body?.cancel();
      if (response.status < 500) break;
    } catch {}
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`${ready} did not answer in time:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { child, stop, output: () => output };
}

/** Playwright's Chromium, or the installed Google Chrome when the bundled one is not downloaded. */
export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) throw error;
    return chromium.launch({ channel: "chrome" });
  }
}

/**
 * A browser context signed in to `origin`: the session record the web sign-in screen and web/cloud-panel.js share
 * (`verynize.cloud.account`), so the editor boots instead of the sign-in screen. `aiSetupDone` (default true) also
 * marks the web AI setup steps as done on this browser, so they do not cover the editor.
 */
export async function signedInContext(
  browser,
  origin,
  { session, account, personalOrganizationId = null },
  { aiSetupDone = true, ...options } = {},
) {
  const context = await browser.newContext(options);
  const stored = JSON.stringify({ server: origin, session, account, personalOrganizationId });
  const setupKey = aiSetupDone ? `verynize.web-ai-setup.${account.id || account.email}` : "";
  // Top document only: sandboxed preview frames have no storage.
  await context.addInitScript(
    ([value, key]) => {
      if (window !== window.top) return;
      localStorage.setItem("verynize.cloud.account", value);
      if (key) localStorage.setItem(key, "done");
    },
    [stored, setupKey],
  );
  return context;
}

/** Saves a screenshot into $VERYNIZE_SCREENSHOTS when it is set (review material, not an assertion). */
export async function screenshot(page, name) {
  const dir = process.env.VERYNIZE_SCREENSHOTS;
  if (!dir) return;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}` });
}
