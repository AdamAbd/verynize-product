// Pure helpers of desktop/capture-core.cjs: @font-face parsing and source choice, font sniffing,
// colour conversion, descriptor normalisation and the captured document model.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../desktop/capture-core.cjs");

test("parses @font-face rules and @import URLs relative to the stylesheet", () => {
  const css = `/* c */ @import url("more.css"); @import 'print.css' print;
    @font-face { font-family: "Brand Sans"; font-weight: 400 700; font-style: normal; src: local("Brand"), url(fonts/brand.woff) format("woff"), url('fonts/brand.woff2') format('woff2'); unicode-range: U+0000-00FF; }
    .x{color:red} @font-face{font-family:Mono;src:url(data:font/woff2;base64,AAAA)}`;
  const { faces, imports } = core.parseFontFaces(css, "https://cdn.example/css/site.css");
  assert.deepEqual(imports, [
    "https://cdn.example/css/more.css",
    "https://cdn.example/css/print.css",
  ]);
  assert.equal(faces.length, 2);
  assert.equal(faces[0].family, '"Brand Sans"');
  assert.equal(faces[0].weight, "400 700");
  assert.equal(faces[0].unicodeRange, "U+0000-00FF");
  assert.equal(
    core.pickFontSource(faces[0].src, faces[0].base),
    "https://cdn.example/css/fonts/brand.woff2",
    "woff2 preferred, local() skipped",
  );
  assert.equal(core.pickFontSource("local(X)", "https://a/"), null);
});

test("sniffs font containers and rejects non-fonts", () => {
  const woff2 = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@fontsource",
      "inter",
      "files",
      "inter-latin-400-normal.woff2",
    ),
  );
  const woff = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@fontsource",
      "inter",
      "files",
      "inter-latin-400-normal.woff",
    ),
  );
  assert.equal(core.fontMime(woff2), "font/woff2");
  assert.equal(core.fontMime(woff), "font/woff");
  assert.equal(core.fontMime(Buffer.from([0, 1, 0, 0, 9])), "font/ttf");
  assert.equal(core.fontMime(Buffer.from("<html>")), null);
});

test("colours, family names and descriptors", () => {
  assert.equal(core.cssColorHex("rgb(1, 2, 3)"), "#010203");
  assert.equal(core.cssColorHex("rgba(255, 0, 0, 0.5)"), "#ff000080");
  assert.equal(core.cssColorHex("rgba(0, 0, 0, 0)"), "");
  assert.deepEqual(core.familyNames('"Fixture Display", Inter, sans-serif'), [
    "fixture display",
    "inter",
    "sans-serif",
  ]);
  assert.deepEqual(
    core.fontDescriptor({
      family: "'A;B'",
      weight: "bolder",
      style: "oblique 12deg",
      unicodeRange: "U+0-7F",
    }),
    { family: "AB", weight: "400", style: "oblique", unicodeRange: "U+0-7F" },
  );
});

test("document model carries background paints, source mapping, states and fonts", () => {
  const style = {
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgb(1, 2, 3)",
    fontSize: "16px",
    fontFamily: '"Brand Sans"',
    fontWeight: "400",
    fontStyle: "normal",
    textAlign: "start",
    borderRadius: "0px",
    opacity: "1",
    borderTopWidth: "0px",
    borderTopColor: "rgb(0, 0, 0)",
    boxShadow: "none",
    lineHeight: "normal",
    letterSpacing: "normal",
    display: "block",
    flexDirection: "row",
    gap: "normal",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    alignItems: "normal",
    justifyContent: "normal",
    gridTemplateColumns: "none",
    overflow: "visible",
    backgroundSize: "contain",
    backgroundRepeat: "no-repeat",
  };
  const snapshot = {
    area: { x: 0, y: 0, width: 300, height: 200 },
    title: "T",
    url: "https://example.com/",
    warnings: [],
    assets: [],
    fontFaces: [
      {
        family: "Brand Sans",
        weight: "400",
        style: "normal",
        src: "data:font/woff2;base64,AAAA",
        source: "https://cdn/x.woff2",
      },
    ],
    records: [
      {
        id: "captured-1",
        parentId: null,
        type: "rectangle",
        name: "a",
        x: 1,
        y: 2,
        w: 30,
        h: 20,
        style,
        gradient: "",
        rotation: 0,
        text: "",
        backgrounds: ["data:image/png;base64,AAAA"],
        source: { url: "https://example.com/", selector: "#a", xpath: "/html[1]/body[1]/a[1]" },
        transitions: [{ property: "color", duration: 0.3, timing: "ease", delay: 0 }],
        states: {
          hover: {
            style: { color: "rgb(255, 0, 0)" },
            from: { color: "rgb(0, 0, 0)" },
            descendants: [],
          },
        },
      },
    ],
  };
  const doc = core.captureModel(snapshot);
  const node = doc.pages[0].nodes[1];
  assert.deepEqual(node.fills, [
    { type: "image", src: "data:image/png;base64,AAAA", fit: "contain" },
    { type: "solid", color: "#010203" },
  ]);
  assert.deepEqual(node.capture.source, {
    url: "https://example.com/",
    selector: "#a",
    xpath: "/html[1]/body[1]/a[1]",
  });
  assert.deepEqual(node.capture.notes, [
    "On :hover: color rgb(0, 0, 0) → rgb(255, 0, 0)",
    "Transition color 300ms ease",
  ]);
  assert.deepEqual(
    doc.fontFaces,
    [{ family: "Brand Sans", weight: "400", style: "normal", src: "data:font/woff2;base64,AAAA" }],
    "download URL is not stored",
  );
  assert.deepEqual(doc.pages[0].nodes[0].capture.source, {
    url: "https://example.com/",
    region: snapshot.area,
  });
  assert.match(
    core.captureHTML(snapshot, doc),
    /@font-face\{font-family:"Brand Sans";font-weight:400;font-style:normal;src:url\(data:font\/woff2;base64,AAAA\)\}/,
  );
  assert.equal(core.validRegion({ x: 0, y: 0, width: 10, height: 10 }, 10, 10), true);
  assert.equal(core.validRegion({ x: 1, y: 0, width: 10, height: 10 }, 10, 10), false);
});
