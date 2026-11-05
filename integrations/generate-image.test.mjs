import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, toolTable } from "./design-tools.mjs";
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
  const inserted = await tool.run({ document: "doc", prompt: "Forest", provider: "nano_banana" });
  assert.equal(inserted.filled, false);
  let doc = (await store.read("doc")).document;
  assert.equal(doc.pages[0].nodes[0].src, src);
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
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { prompt: "Forest", provider: "nano_banana" });
});
