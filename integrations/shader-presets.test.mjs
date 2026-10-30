// Parametric shader presets (web/shaders.js): catalog, validation, colour-variable resolution, HTML export,
// JSX round trip and colour-variable rename/delete through the shared colour-holder walk.
import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import { exportHTML } from "./export-html.mjs";
import { PRESETS, presetIds, shaderError, resolveShader } from "./shaders.mjs";
import {
  buildNodes,
  elementCode,
  ensureShortIds,
  renameTokenRefs,
  runDirectives,
  syncTokenColors,
  unbindToken,
} from "./design-edit.mjs";
import { parseJsx } from "./jsx-codec.mjs";

const shader = (extra = {}) => ({
  id: "s",
  name: "Shader",
  type: "shader",
  x: 0,
  y: 0,
  w: 300,
  h: 200,
  color: "#a58bdd",
  shaderPreset: "tidal-swirl-3",
  shaderSpeed: 1,
  shaderIntensity: 1,
  ...extra,
});
const doc = (node, tokens = { "brand/accent": "#ff00aa" }) => ({
  version: 2,
  name: "Shaders",
  tokens,
  pages: [{ id: "p", name: "Page", nodes: [node] }],
});

test("catalog: original parametric families next to the six classic presets", () => {
  assert.equal(new Set(presetIds).size, presetIds.length, "ids are unique");
  for (const id of ["aurora", "waves", "noise", "ribbon", "mesh", "swirl"])
    assert.ok(presetIds.includes(id));
  const param = PRESETS.filter((p) => p.kind === "param");
  assert.ok(param.length >= 12);
  assert.deepEqual(
    [...new Set(param.map((p) => p.family))],
    ["Tidal Swirl", "Ripple Pool", "Pixel Bloom", "Signal Grid"],
  );
  for (const p of param) {
    assert.deepEqual(Object.keys(p.defaults.colors), ["center", "edge", "ripple", "background"]);
    for (const k of ["aspect", "size", "density", "distortion", "grain"])
      assert.ok(p.defaults[k] >= 0 && p.defaults[k] <= 100, `${p.id} ${k}`);
    assert.ok(p.defaults.speed >= 0 && p.defaults.speed <= 5);
    assert.doesNotMatch(p.name, /Shifted Swirls|Pixel Party|Network Light/);
  }
});

test("validation rejects malformed shader colours and sliders in both validators", () => {
  for (const extra of [
    { shaderPreset: "shifted-swirls-3" },
    { shaderColors: { glow: { color: "#ffffff" } } },
    { shaderColors: { center: { color: "red" } } },
    { shaderColors: { center: "#ffffff" } },
    { shaderColors: { center: { color: "#ffffff", token: "<bad>" } } },
    { shaderParams: { aspect: 101 } },
    { shaderParams: { speed: 1 } },
    { shaderParams: [] },
  ]) {
    assert.notEqual(shaderError(shader(extra)), "", JSON.stringify(extra));
    assert.throws(() => validateDocument(doc(shader(extra))), /shader/i, JSON.stringify(extra));
  }
  const ok = shader({
    shaderColors: { center: { color: "#11223380", token: "brand/accent" } },
    shaderParams: { aspect: 0, grain: 100 },
  });
  assert.equal(shaderError(ok), "");
  validateDocument(doc(ok));
});

test("resolve: defaults, stored colours, bound variables win while they resolve", () => {
  const defaults = PRESETS.find((p) => p.id === "tidal-swirl-3").defaults;
  const plain = resolveShader(shader(), {});
  assert.equal(plain.kind, "param");
  assert.deepEqual(plain.colors, defaults.colors);
  assert.equal(plain.density, defaults.density);
  assert.equal(plain.speed, 1, "speed comes from shaderSpeed");
  const node = shader({
    shaderColors: {
      center: { color: "#123456", token: "brand/accent" },
      edge: { color: "#654321ff" },
      ripple: { color: "#abcdef", token: "missing" },
    },
    shaderParams: { density: 80 },
  });
  const r = resolveShader(node, { "brand/accent": "#FF00AA" });
  assert.equal(r.colors.center, "#ff00aa");
  assert.equal(r.colors.edge, "#654321ff");
  assert.equal(r.colors.ripple, "#abcdef", "a missing variable falls back to the stored colour");
  assert.equal(r.colors.background, defaults.colors.background);
  assert.equal(r.density, 80);
  assert.equal(r.aspect, defaults.aspect);
  assert.equal(resolveShader(shader({ shaderPreset: "waves" }), {}).kind, "legacy");
});

test("HTML export carries resolved parameters; classic presets keep their attributes only", () => {
  const html = exportHTML(
    doc(
      shader({
        shaderColors: { center: { color: "#000000", token: "brand/accent" } },
        shaderParams: { grain: 0 },
      }),
    ),
  );
  const raw = html.match(/data-shader-params="([^"]+)"/)[1].replaceAll("&quot;", '"');
  const params = JSON.parse(raw);
  assert.equal(params.preset, "tidal-swirl-3");
  assert.equal(params.colors.center, "#ff00aa");
  assert.equal(params.grain, 0);
  assert.match(html, /paramFragment/, "runtime with the parametric program is embedded");
  assert.doesNotMatch(exportHTML(doc(shader({ shaderPreset: "waves" }))), /data-shader-params="/);
});

test("shader colours and sliders survive a JSX round trip and edits; invalid JSON is rejected", () => {
  const node = shader({
    shaderColors: {
      center: { color: "#123456", token: "brand/accent" },
      ripple: { color: "#ffffff80" },
    },
    shaderParams: { aspect: 10, distortion: 90 },
  });
  const d = doc(node);
  validateDocument(d);
  ensureShortIds(d);
  const page = d.pages[0];
  const code = elementCode(d, page, page.nodes[0]);
  assert.match(code, /preset="tidal-swirl-3"/);
  assert.match(code, /data-shader-colors="/);
  const built = buildNodes(parseJsx(code).elements, { document: d, page }).nodes[0];
  assert.equal(built.shaderPreset, "tidal-swirl-3");
  assert.deepEqual(built.shaderColors, node.shaderColors);
  assert.deepEqual(built.shaderParams, node.shaderParams);
  const id = code.match(/data-node-id="([^"]+)"/)[1];
  const edited = runDirectives(
    d,
    "p",
    `{/* edit ${id} */}\n${code.replace("&quot;distortion&quot;:90", "&quot;distortion&quot;:40").replace('preset="tidal-swirl-3"', 'preset="pixel-bloom-2"')}`,
  );
  assert.equal(edited.failed, 0, edited.report);
  const after = edited.document.pages[0].nodes.find((n) => n.id === "s");
  assert.equal(after.shaderParams.distortion, 40);
  assert.equal(after.shaderPreset, "pixel-bloom-2");
  assert.throws(
    () =>
      buildNodes(parseJsx('<Shader data-shader-params="{&quot;aspect&quot;:500}" />').elements, {
        document: d,
        page,
      }),
    /shader parameter/,
  );
});

test("colour variable rename, value sync and delete reach shader colours", () => {
  const d = doc(shader({ shaderColors: { center: { color: "#ff00aa", token: "brand/accent" } } }));
  renameTokenRefs(d, "brand/accent", "brand/pink");
  d.tokens = { "brand/pink": "#ff00aa" };
  assert.equal(d.pages[0].nodes[0].shaderColors.center.token, "brand/pink");
  d.tokens["brand/pink"] = "#00ff00";
  syncTokenColors(d);
  assert.equal(d.pages[0].nodes[0].shaderColors.center.color, "#00ff00");
  unbindToken(d, "brand/pink");
  delete d.tokens["brand/pink"];
  assert.deepEqual(d.pages[0].nodes[0].shaderColors.center, { color: "#00ff00" });
  validateDocument(d);
});
