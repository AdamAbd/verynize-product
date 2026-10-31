// Photographic image providers end to end in Electron: provider settings with the API key stored via
// safeStorage (never returned, logged, persisted in clear text or kept in renderer storage), generation
// through a local OpenAI-compatible fixture server and a generic HTTP fixture that return real PNG
// bytes, insertion as an image layer, relaunch persistence and redacted provider errors.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require('./helpers/ui-ready.cjs');
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { png } = require("./fixtures/png.cjs");

const KEY = "sk-verynize-fixture-7f3a9c21d4e8b6";
const WRONG = "sk-wrong-fixture-key-55aa11";

(async () => {
  const photo = png(96, 64, (x, y) => [x * 2, 80 + y, 200 - x]);
  const generic = png(40, 30, [20, 160, 90]);
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ url: req.url, auth: req.headers.authorization || "", body });
      if (req.url === "/v1/images/generations") {
        res.setHeader("content-type", "application/json");
        if (req.headers.authorization !== "Bearer " + KEY) {
          res.statusCode = 401;
          res.end(
            JSON.stringify({
              error: { message: "Invalid key: " + (req.headers.authorization || "").slice(7) },
            }),
          );
          return;
        }
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: photo.toString("base64") }] }));
        return;
      }
      if (req.url === "/generate") {
        res.setHeader("content-type", "image/png");
        res.end(generic);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "generation-image-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1';
  let logs = "";
  const launch = async () => {
    const app = await _electron.launch({
      env,
      args: [".", `--user-data-dir=${dir}`],
      timeout: 20000,
    });
    app.process().stdout.on("data", (d) => {
      logs += d;
    });
    app.process().stderr.on("data", (d) => {
      logs += d;
    });
    app.on("console", (m) => {
      logs += m.text();
    });
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    page.on("console", (m) => {
      logs += m.text();
    });
    await page.waitForFunction(
      () => !!window.desktop?.imageProvider && !!document.getElementById("generate-engine"),
    );
    return { app, page };
  };
  const openDialog = async (page) => {
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#generate-art").click();
    await page.locator("#generate-dialog").waitFor({ state: "visible" });
    await page.locator("#generate-engine").selectOption("image");
  };
  const imageNodes = (page) =>
    page.evaluate(() =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .filter((n) => n.type === "image"),
    );
  let { app, page } = await launch();
  try {
    // Engine switch shows provider settings, hides agent-only fields.
    await openDialog(page);
    assert.equal(await page.locator("#generate-image-settings").isVisible(), true);
    assert.equal(await page.locator("#generate-agent").isVisible(), false);
    assert.equal(await page.locator("#image-api-key").getAttribute("type"), "password");
    // Plain http to a non-loopback host is refused (the key would travel in clear text).
    const refused = await page.evaluate(() =>
      window.desktop.imageProvider
        .set({ provider: "openai", baseURL: "http://images.example.com/v1" })
        .catch((e) => e.message),
    );
    assert.match(refused, /https/);

    await page.locator("#image-provider").selectOption("openai");
    await page.locator("#image-base-url").fill(base + "/v1");
    await page.locator("#image-model").fill("fixture-photo-model");
    await page.locator("#image-size").selectOption("512x512");
    await page.locator("#image-api-key").fill(KEY);
    await page.locator("#generate-prompt").fill("A foggy harbour at sunrise, 35mm photo");
    await page.locator("#generate-run").click();
    await page.waitForFunction(
      () => /Image inserted/.test(document.getElementById("generate-status").textContent),
      null,
      { timeout: 20000 },
    );
    assert.equal(
      await page.locator("#image-api-key").inputValue(),
      "",
      "key field cleared after saving",
    );
    const sent = requests.find((r) => r.url === "/v1/images/generations");
    assert.equal(sent.auth, "Bearer " + KEY);
    assert.deepEqual(JSON.parse(sent.body), {
      model: "fixture-photo-model",
      prompt: "A foggy harbour at sunrise, 35mm photo",
      n: 1,
      size: "512x512",
    });
    let images = await imageNodes(page);
    assert.equal(images.length, 1);
    assert.equal(images[0].w, 96);
    assert.equal(images[0].h, 64);
    assert.deepEqual(
      Buffer.from(images[0].src.replace("data:image/png;base64,", ""), "base64"),
      photo,
    );
    assert.equal(
      (await page
        .locator(`#canvas [data-id="${images[0].id}"] img, #canvas [data-id="${images[0].id}"]`)
        .count()) > 0,
      true,
    );

    // The key never comes back to the renderer and is not stored in clear text anywhere.
    const settings = await page.evaluate(() => window.desktop.imageProvider.get());
    assert.equal(settings.hasKey, true);
    assert.equal(settings.model, "fixture-photo-model");
    assert.doesNotMatch(JSON.stringify(settings), new RegExp(KEY));
    const file = await fs.readFile(path.join(dir, "image-provider.json"), "utf8");
    assert.doesNotMatch(file, new RegExp(KEY));
    const secure = settings.secureStorage;
    if (secure) {
      assert.equal(settings.keyStorage, "keychain");
      assert.ok(JSON.parse(file).key.length > 20, "ciphertext stored");
    } else assert.equal(settings.keyStorage, "session");
    const rendererState = await page.evaluate(
      () =>
        JSON.stringify(localStorage) +
        JSON.stringify(sessionStorage) +
        JSON.stringify(window.design.getDocument()),
    );
    assert.doesNotMatch(rendererState, new RegExp(KEY));

    // Provider errors are surfaced without the key.
    await page.evaluate((k) => window.desktop.imageProvider.set({ apiKey: k }), WRONG);
    await page.locator("#generate-run").click();
    await page.waitForFunction(
      () => /401/.test(document.getElementById("generate-status").textContent),
      null,
      { timeout: 20000 },
    );
    const errorText = await page.locator("#generate-status").textContent();
    assert.match(errorText, /check the API key/);
    assert.doesNotMatch(errorText, new RegExp(WRONG));
    await page.evaluate((k) => window.desktop.imageProvider.set({ apiKey: k }), KEY);
    await page.locator("#generate-close").click();
    await app.close();

    // Relaunch: the saved provider and (keychain) key are reused without re-entering them.
    ({ app, page } = await launch());
    if (secure) {
      await openDialog(page);
      assert.equal(await page.locator("#image-base-url").inputValue(), base + "/v1");
      assert.match(await page.locator("#image-api-key").getAttribute("placeholder"), /Saved/);
      await page.locator("#generate-prompt").fill("Second photo");
      await page.locator("#generate-run").click();
      await page.waitForFunction(
        () => /Image inserted/.test(document.getElementById("generate-status").textContent),
        null,
        { timeout: 20000 },
      );
      assert.equal(requests.at(-1).auth, "Bearer " + KEY);
      await page.locator("#generate-close").click();
    }
    // Generic HTTP provider returning raw PNG bytes; removing the key stops sending it.
    await page.evaluate(
      (url) =>
        window.desktop.imageProvider.set({
          provider: "http",
          baseURL: url,
          model: "local-diffusion",
          clearKey: true,
        }),
      base + "/generate",
    );
    assert.equal((await page.evaluate(() => window.desktop.imageProvider.get())).hasKey, false);
    assert.doesNotMatch(await fs.readFile(path.join(dir, "image-provider.json"), "utf8"), /"key"/);
    await openDialog(page);
    await page.locator("#generate-prompt").fill("Studio product shot of a green ceramic mug");
    await page.locator("#image-size").selectOption("1024x1536");
    await page.locator("#generate-run").click();
    await page.waitForFunction(
      () => /Image inserted \(40×30/.test(document.getElementById("generate-status").textContent),
      null,
      { timeout: 20000 },
    );
    const last = requests.at(-1);
    assert.equal(last.url, "/generate");
    assert.equal(last.auth, "");
    assert.deepEqual(JSON.parse(last.body), {
      prompt: "Studio product shot of a green ceramic mug",
      model: "local-diffusion",
      width: 1024,
      height: 1536,
    });
    images = await imageNodes(page);
    assert.ok(
      images.some(
        (n) =>
          n.src === "data:image/png;base64," + generic.toString("base64") &&
          n.w === 40 &&
          n.h === 30,
      ),
    );
    assert.doesNotMatch(logs, new RegExp(KEY + "|" + WRONG), "API keys never logged");
    console.log(
      `PASS image model providers: OpenAI-compatible + generic HTTP fixtures, real PNG inserted as layers, key in ${secure ? "keychain (safeStorage) across relaunch" : "session memory"}, never returned/logged/plain-stored, redacted errors`,
    );
  } finally {
    await app.close().catch(() => {});
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
