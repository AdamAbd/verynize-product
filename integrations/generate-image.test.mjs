import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, toolTable, SERVER_VERSION } from "./design-tools.mjs";
const { png } = createRequire(import.meta.url)("../tests/fixtures/png.cjs");
test("generate_image inserts, fills, preserves other properties and rejects headless calls", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "generate-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await DesignStore.open(root);
  await store.create("doc", "Doc");
  const plain = createStoreBackend(store);
  await assert.rejects(
    toolTable(plain).generate_image.run({ document: "doc", prompt: "x" }),
    /needs the Verynize desktop app/,
  );
  const src = "data:image/png;base64," + png(32, 24, [20, 40, 60]).toString("base64");
  const calls = [];
  const backend = createStoreBackend(store, {
    generateImage: async (options) => {
      calls.push(options);
      return { src, width: 32, height: 24 };
    },
  });
  const tool = toolTable(backend).generate_image;
  assert.equal(SERVER_VERSION, "0.8.0");
  assert.equal(tool.inputSchema.provider.parse("openai_gpt_image_2"), "openai_gpt_image_2");
  assert.throws(() => tool.inputSchema.provider.parse("unknown"));
  const inserted = await tool.run({ document: "doc", prompt: "Forest", provider: "nano_banana" });
  assert.equal(inserted.filled, false);
  let doc = (await store.read("doc")).document;
  assert.equal(doc.pages[0].nodes[0].src, src);
  assert.equal(doc.pages[0].nodes[0].x, 40);
  await tool.run({ document: "doc", element: inserted.element, prompt: "Replace" });
  assert.equal((await store.read("doc")).document.pages[0].nodes.length, 1);
  await backend.transact("doc", (d) => {
    d.pages[0].nodes[0].type = "rectangle";
    d.pages[0].nodes[0].name = "Keep me";
    return { document: d };
  });
  const filled = await tool.run({ document: "doc", element: inserted.element, prompt: "Ocean" });
  assert.equal(filled.filled, true);
  doc = (await store.read("doc")).document;
  assert.equal(doc.pages[0].nodes.length, 1);
  assert.equal(doc.pages[0].nodes[0].name, "Keep me");
  assert.deepEqual(doc.pages[0].nodes[0].fills, [
    { type: "image", src, fit: "cover", imageWidth: 32, imageHeight: 24 },
  ]);
  await assert.rejects(tool.run({ document: "doc", element: "missing", prompt: "x" }));
  assert.equal(calls.length, 3);
  await backend.transact("doc", (d) => {
    d.pages[0].nodes[0].type = "text";
    return { document: d };
  });
  await assert.rejects(
    tool.run({ document: "doc", element: inserted.element, prompt: "No charge" }),
    /Target must/,
  );
  assert.equal(calls.length, 3);
  const placed = await tool.run({ document: "doc", prompt: "Placed", x: 800, y: 120 });
  const node = (await store.read("doc")).document.pages[0].nodes.at(-1);
  assert.equal(node.x, 800);
  assert.equal(node.y, 120);
  assert.equal(placed.filled, false);
  await tool.run({ document: "doc", prompt: "Beside content" });
  assert.equal((await store.read("doc")).document.pages[0].nodes.at(-1).x, 872);
  const beforeInvalidParent = calls.length;
  await assert.rejects(
    tool.run({ document: "doc", prompt: "Invalid parent", parent: inserted.element }),
    /Parent must/,
  );
  assert.equal(calls.length, beforeInvalidParent);
  await backend.transact("doc", (d) => {
    d.pages[0].nodes[0].type = "frame";
    return { document: d };
  });
  await tool.run({
    document: "doc",
    prompt: "Inside frame",
    parent: inserted.element,
    x: 12,
    y: 24,
  });
  const child = (await store.read("doc")).document.pages[0].nodes.at(-1);
  assert.equal(child.parentId, (await store.read("doc")).document.pages[0].nodes[0].id);
  assert.equal(child.x, 12);
  assert.equal(child.y, 24);
  assert.deepEqual(calls[0], { prompt: "Forest", provider: "nano_banana" });
});
