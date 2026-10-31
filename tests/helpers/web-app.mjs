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
