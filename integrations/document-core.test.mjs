// One document schema (web/document-core.js) for the canvas (web/app.js validate → prepareDocument) and the headless
// store (design-store.mjs validateDocument): what the canvas prepares, the store accepts, and the rules the two
// hand-synced validators used to disagree on are settled in one place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateDocument as coreValidate,
  normalizeDocument,
  prepareDocument,
  resolveAliases,
} from "./document-core.mjs";
import { validateDocument } from "./design-store.mjs";

const read = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
// The canvas layer defaults (`const defaults={…}` in web/app.js), a plain object literal.
const DEFAULTS = Function(
  `return (${read("web/app.js").match(/const defaults=(\{[^}]*\})/)[1]})`,
)();
const page = (nodes) => ({ id: "p1", name: "Page 1", nodes });
const doc = (nodes, extra = {}) => ({
  version: 2,
  name: "Doc",
  activePage: "p1",
  tokens: {},
  pages: [page(nodes)],
  ...extra,
});
const rect = (extra = {}) => ({
  id: "r1",
  type: "rectangle",
  name: "Box",
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  ...extra,
});

test("web/app.js has no validator of its own: validate() is prepareDocument with the canvas defaults", () => {
  const app = read("web/app.js");
  assert.match(
    app,
    /function validate\(d\)\{return window\.VerynizeDocument\.prepareDocument\(d,defaults\)\}/,
  );
  assert.doesNotMatch(app, /function roomAssetUrl/);
  const html = read("web/index.html");
  const order = [
    "/platform.js",
    "/shaders.js",
    "/node-style.js",
    "/document-core.js",
    "/app.js",
  ].map((src) => html.indexOf(`src="${src}"`));
  assert.ok(
    order.every((i) => i >= 0),
    "index.html loads the shared scripts",
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "shared scripts load before app.js",
  );
});

test("a document the canvas prepares passes the store validator", () => {
  const sparse = {
    version: 2,
    pages: [
      {
        id: "p1",
        nodes: [
          rect({ name: "" }),
          { id: "t1", type: "text", x: 1, y: 2, w: 30, h: 20, fontWeight: 700, animated: "neon" },
        ],
      },
    ],
  };
  const prepared = prepareDocument(sparse, DEFAULTS);
  assert.equal(prepared, sparse, "prepared in place, like the old validate()");
  assert.equal(prepared.name, "Untitled");
  assert.equal(prepared.pages[0].name, "Page");
  assert.equal(prepared.activePage, "p1");
  assert.deepEqual(prepared.tokens, {});
  const [box, text] = prepared.pages[0].nodes;
  assert.equal(box.name, "Rectangle", "a blank layer name falls back to the type");
  assert.equal(box.shaderPreset, "aurora", "canvas defaults filled");
  assert.equal(text.fontWeight, "700", "numeric font weight stored as a string");
  assert.equal(text.animated, "", "unknown animated palette (rendered as none) cleared");
  assert.doesNotThrow(() => validateDocument(structuredClone(prepared)));
});

test("the store validator does not repair: missing names and a dangling active page are errors", () => {
  assert.throws(() => validateDocument({ ...doc([rect()]), name: "" }), /Document name/);
  assert.throws(() => validateDocument(doc([rect({ name: " " })])), /Node name/);
  assert.throws(() => validateDocument(doc([rect()], { activePage: "gone" })), /active page/);
  assert.throws(() => validateDocument({ ...doc([rect()]), tokens: undefined }), /tokens/);
  // The canvas repairs the same documents.
  for (const bad of [
    { ...doc([rect()]), name: "" },
    doc([rect({ name: " " })]),
    doc([rect()], { activePage: "gone" }),
  ])
    assert.doesNotThrow(() => prepareDocument(bad, DEFAULTS));
});

test("rules the two validators used to disagree on now hold for both", () => {
  const both = (d, re, label) => {
    assert.throws(() => validateDocument(structuredClone(d)), re, "store: " + label);
    assert.throws(() => prepareDocument(structuredClone(d), DEFAULTS), re, "canvas: " + label);
  };
  // Previously store-only.
  both(doc([rect({ x: 2e6 })]), /Invalid node x/, "coordinates within ±1e6");
  both(doc([rect({ id: "" })]), /Node id/, "nonempty ids");
  both(
    doc([rect({ gradient: "x".repeat(4001) })]),
    /Invalid node gradient/,
    "free-form strings ≤ 4000",
  );
  both(doc([rect({ name: "x".repeat(201) })]), /Node name/, "names ≤ 200");
  both(
    {
      ...doc([]),
      pages: [
        page(Array.from({ length: 5000 }, (_, i) => rect({ id: "a" + i }))),
        {
          id: "p2",
          name: "B",
          nodes: Array.from({ length: 5000 }, (_, i) => rect({ id: "b" + i })),
        },
        { id: "p3", name: "C", nodes: [rect({ id: "c" })] },
      ],
    },
    /10000 nodes/,
    "10000 layers in total",
  );
  both(
    doc([rect()], {
      views: [{ id: "v".repeat(201), name: "V", page: "p1", zoom: 1, scrollLeft: 0, scrollTop: 0 }],
    }),
    /View id/,
    "view ids ≤ 200",
  );
  // Previously canvas-only.
  both(doc([rect({ strokeWidth: -1 })]), /strokeWidth/, "non-negative border width");
  both(doc([rect({ shadow: "0 0 url(https://x.example/a)" })]), /shadow/, "no url() in shadows");
  both(
    doc([
      rect({ textRuns: [], text: "ab" }),
      rect({
        id: "r2",
        text: "ab",
        textRuns: [{ start: 0, end: 1, bold: true, italic: false, color: ["#ffffff"] }],
      }),
    ]),
    /text ranges/,
    "text run colours are strings",
  );
  both(
    doc([rect({ shaderPreset: "custom" })]),
    /shader preset/,
    "shader preset on any layer that sets it",
  );
  both(doc([rect({ shaderSpeed: 9 })]), /shaderSpeed/, "shader speed on any layer that sets it");
});

test("aliases are validated by the shared core and resolved only when the canvas loads", () => {
  const d = doc([rect()], {
    tokens: { brand: "#112233", accent: "#000000" },
    aliases: { accent: "brand" },
  });
  assert.equal(
    coreValidate(structuredClone(d)).tokens.accent,
    "#000000",
    "validation never mutates",
  );
  assert.equal(prepareDocument(structuredClone(d), DEFAULTS).tokens.accent, "#112233");
  assert.equal(resolveAliases(structuredClone(d)).tokens.accent, "#112233");
  assert.throws(
    () =>
      prepareDocument(
        doc([rect()], { tokens: { a: "#000000", b: "#ffffff" }, aliases: { a: "b", b: "a" } }),
        DEFAULTS,
      ),
    /cycle/,
  );
});

test("normalizeDocument tolerates malformed input and leaves rejection to validation", () => {
  for (const bad of [
    null,
    1,
    "x",
    {},
    { version: 2, pages: "x" },
    { version: 2, pages: [null, 1, { id: "p", nodes: [null] }] },
  ]) {
    assert.doesNotThrow(() => normalizeDocument(bad, DEFAULTS));
    assert.throws(() => prepareDocument(bad, DEFAULTS));
  }
});
