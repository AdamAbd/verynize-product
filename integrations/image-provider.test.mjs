// Image provider adapters against local HTTP fixture servers that return real PNG/JPEG bytes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { generateImage, normalizeSettings, inspectImage, redact } from "./image-provider.mjs";

const { png } = createRequire(import.meta.url)("../tests/fixtures/png.cjs");
const KEY = "sk-fixture-0123456789abcdef";
const photo = png(64, 40, (x, y) => [x * 4, y * 6, 128]);
const requests = [];
let server, base;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      requests.push({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization || "",
        body: body ? JSON.parse(body) : null,
      });
      if (req.url === "/v1/images/generations") {
        if (req.headers.authorization !== "Bearer " + KEY) {
          res.statusCode = 401;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message: `Incorrect API key provided: ${(req.headers.authorization || "").slice(7)}`,
              },
            }),
          );
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ created: 1, data: [{ b64_json: photo.toString("base64") }] }));
        return;
      }
      if (req.url === "/url/images/generations") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ url: base + "/files/result.png" }] }));
        return;
      }
      if (req.url === "/files/result.png") {
        if (req.headers.authorization) {
          res.statusCode = 400;
          res.end("key leaked to file host");
          return;
        }
        res.setHeader("content-type", "image/png");
        res.end(photo);
        return;
      }
      if (req.url === "/raw") {
        res.setHeader("content-type", "image/png");
        res.end(photo);
        return;
      }
      if (req.url === "/json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ image: "data:image/png;base64," + photo.toString("base64") }));
        return;
      }
      if (req.url === "/not-image") {
        res.setHeader("content-type", "image/png");
        res.end("<html>nope</html>");
        return;
      }
      if (req.url === "/slow") {
        setTimeout(() => {
          res.setHeader("content-type", "image/png");
          res.end(photo);
        }, 2000);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
after(() => new Promise((r) => server.close(r)));

test("settings: https anywhere, plain http only on loopback, no credentials in URL", () => {
  assert.deepEqual(normalizeSettings({}), {
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-image-1",
    size: "1024x1024",
  });
  assert.equal(
    normalizeSettings({ provider: "http", baseURL: "http://localhost:8080/gen/" }).baseURL,
    "http://localhost:8080/gen",
  );
  assert.throws(() => normalizeSettings({ baseURL: "http://images.example.com/v1" }), /https/);
  assert.throws(() => normalizeSettings({ baseURL: "https://u:p@example.com/v1" }), /credentials/);
  assert.throws(() => normalizeSettings({ baseURL: "https://example.com/v1?key=1" }), /query/);
  assert.throws(() => normalizeSettings({ provider: "mystery" }), /Provider/);
  assert.throws(() => normalizeSettings({ size: "9999x9999" }), /size/);
});

test("OpenAI-compatible provider: request shape, bearer key and decoded PNG", async () => {
  const result = await generateImage({
    settings: {
      provider: "openai",
      baseURL: base + "/v1",
      model: "fixture-image-model",
      size: "512x512",
    },
    apiKey: KEY,
    prompt: "A misty pine forest at dawn",
  });
  const req = requests.at(-1);
  assert.equal(req.method, "POST");
  assert.equal(req.auth, "Bearer " + KEY);
  assert.deepEqual(req.body, {
    model: "fixture-image-model",
    prompt: "A misty pine forest at dawn",
    n: 1,
    size: "512x512",
  });
  assert.equal(result.mime, "image/png");
  assert.equal(result.width, 64);
  assert.equal(result.height, 40);
  assert.deepEqual(Buffer.from(result.src.replace("data:image/png;base64,", ""), "base64"), photo);
});

test("hosted result URLs are downloaded without the API key", async () => {
  const result = await generateImage({
    settings: { provider: "openai", baseURL: base + "/url", model: "m" },
    apiKey: KEY,
    prompt: "x",
  });
  assert.equal(result.width, 64);
  assert.equal(requests.at(-1).url, "/files/result.png");
  assert.equal(requests.at(-1).auth, "");
});

test("generic HTTP provider: raw image bytes or JSON data URL, key optional", async () => {
  const raw = await generateImage({
    settings: { provider: "http", baseURL: base + "/raw", model: "local-sdxl", size: "1024x1536" },
    prompt: "portrait",
  });
  assert.deepEqual(requests.at(-1).body, {
    prompt: "portrait",
    model: "local-sdxl",
    width: 1024,
    height: 1536,
  });
  assert.equal(requests.at(-1).auth, "");
  assert.equal(raw.height, 40);
  const json = await generateImage({
    settings: { provider: "http", baseURL: base + "/json" },
    apiKey: "generic-token-xyz",
    prompt: "p",
  });
  assert.equal(requests.at(-1).auth, "Bearer generic-token-xyz");
  assert.equal(json.mime, "image/png");
});

test("errors never contain the API key; non-images and cancellation are rejected", async () => {
  const wrong = "sk-wrong-key-abcdef123456";
  await assert.rejects(
    generateImage({
      settings: { provider: "openai", baseURL: base + "/v1" },
      apiKey: wrong,
      prompt: "x",
    }),
    (e) => {
      assert.match(e.message, /401 \(check the API key\)/);
      assert.doesNotMatch(e.message, /sk-wrong-key/);
      return true;
    },
  );
  await assert.rejects(
    generateImage({
      settings: { provider: "openai", baseURL: base + "/v1" },
      apiKey: "",
      prompt: "x",
    }),
    /Add an API key/,
  );
  await assert.rejects(
    generateImage({ settings: { provider: "http", baseURL: base + "/not-image" }, prompt: "x" }),
    /PNG, JPEG or WebP/,
  );
  await assert.rejects(
    generateImage({ settings: { provider: "http", baseURL: base + "/missing" }, prompt: "x" }),
    /404/,
  );
  await assert.rejects(
    generateImage({ settings: { provider: "http", baseURL: base + "/raw" }, prompt: " " }),
    /Describe/,
  );
  const controller = new AbortController();
  const pending = generateImage({
    settings: { provider: "http", baseURL: base + "/slow" },
    prompt: "x",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /canceled/);
});

test("image inspection and redaction helpers", () => {
  assert.deepEqual(inspectImage(photo), { mime: "image/png", width: 64, height: 40 });
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00,
    0x50, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.deepEqual(inspectImage(jpeg), { mime: "image/jpeg", width: 80, height: 48 });
  assert.equal(inspectImage(Buffer.from("GIF89a......")), null);
  assert.equal(
    redact(`bad key ${KEY} and Bearer abcdefghijklmnop`, KEY),
    "bad key [redacted] and Bearer [redacted]",
  );
});
