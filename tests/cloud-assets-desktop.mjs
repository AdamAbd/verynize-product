// Two Electron clients in one room: an image inserted by one client is uploaded to the room's R2
// asset store and the other client receives only its URL (never the data URI). The image renders
// in both editors and a raster export inlines it for the offline renderer.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-assets-ui-"));
const options = await cloudOptions(path.join(dir, "state"));
const mf = new Miniflare(options);
const apps = [];
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(
    [a, b].map((page) => page.waitForFunction(() => !!window.design && !!window.cloudAssets)),
  );
  // Every frame client A sends over the room socket.
  const sent = [];
  a.on("websocket", (socket) =>
    socket.on("framesent", (frame) => sent.push(String(frame.payload))),
  );

  await a.locator("#cloud-toggle").click();
  await a.locator("#cloud-server").fill(server);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(() => document.getElementById("cloud-invite").value.includes("token="));
  const invite = await a.locator("#cloud-invite").inputValue();
  const room = new URLSearchParams(new URL(invite).hash.slice(1));
  b.on("dialog", async (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
  await b.locator("#cloud-toggle").click();
  await b.locator("#cloud-invite").fill(invite);
  await b.locator("#cloud-connect").click();
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  await a.locator("#cloud-close").click();
  await b.locator("#cloud-close").click();

  // Insert a real (canvas-encoded) red PNG as an embedded image in client A.
  const inserted = await a.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 64, 64);
    const src = canvas.toDataURL("image/png");
    const id = window.design.addNode("image", { src, name: "Red", x: 40, y: 40, w: 64, h: 64 });
    return { id, src };
  });
  assert.ok(inserted.id);
  const srcOf = (page, id) =>
    page.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src || "",
      id,
    );
  // A swaps the data URI for the room asset URL; B receives that URL.
  await a.waitForFunction(
    (id) =>
      /\/assets\//.test(
        window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src || "",
      ),
    inserted.id,
    { timeout: 20000 },
  );
  const url = await srcOf(a, inserted.id);
  assert.match(
    url,
    new RegExp(
      `^${server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/rooms/${room.get("room")}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`,
    ),
  );
  await b.waitForFunction(
    ([id, url]) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src === url,
    [inserted.id, url],
    { timeout: 20000 },
  );
  // The image bytes never travelled through the room: no socket frame and no server document
  // holds the data URI.
  assert.equal(
    sent.some((frame) => frame.includes("data:image/png")),
    false,
  );
  assert.equal(
    sent.some((frame) => frame.includes(url.split("?")[0])),
    true,
  );
  const shared = await (
    await fetch(`${server}/api/rooms/${room.get("room")}`, {
      headers: { authorization: `Bearer ${room.get("token")}` },
    })
  ).json();
  assert.equal(JSON.stringify(shared.document).includes("data:image"), false);
  assert.equal(shared.document.pages[0].nodes.find((n) => n.id === inserted.id).src, url);

  // Both editors render the remote image (decoded, not broken).
  for (const page of [a, b])
    await page.waitForFunction(
      (id) => {
        const img = document.querySelector(`[data-id="${CSS.escape(id)}"] img`);
        return img && img.complete && img.naturalWidth === 64;
      },
      inserted.id,
      { timeout: 20000 },
    );

  // Inserting the same image again reuses the uploaded asset (no second upload).
  const again = await b.evaluate(
    (src) =>
      window.design.addNode("image", { src, name: "Red again", x: 140, y: 40, w: 64, h: 64 }),
    inserted.src,
  );
  await a.waitForFunction(
    ([id, url]) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.src === url,
    [again, url],
    { timeout: 20000 },
  );

  // Raster export inlines the room image for the offline renderer: the exported PNG is red.
  await b.evaluate((id) => window.design.setSelection([id]), inserted.id);
  const pixel = await b.evaluate(async () => {
    const result = await window.design.exportArtwork({
      format: "PNG",
      scale: 1,
      selectionOnly: true,
    });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = result.dataURL;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return [
      ...ctx.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data,
    ];
  });
  assert.ok(pixel[0] > 200 && pixel[1] < 50 && pixel[2] < 50 && pixel[3] > 200, `pixel ${pixel}`);
  assert.equal((await a.evaluate(() => window.cloudAssets.status())).failed, 0);

  console.log(
    "PASS desktop room assets: inserted image uploaded to R2, collaborator receives only the URL, both editors render it, dedupe on reinsert, raster export inlines it",
  );
} finally {
  await Promise.all(apps.map((app) => app.close().catch(() => {})));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
