// CLI source round trips: import-html (page + local stylesheet), export-jsx -> import-jsx and
// export-css -> import-html keep every layer (real CLI processes on a temporary document root).
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const strip = (node) => {
  const { id, parentId, shortId, measured, ...rest } = node;
  void id;
  void parentId;
  void shortId;
  void measured;
  return rest;
};

test("CLI imports HTML with its stylesheet and round-trips the result through JSX and HTML/CSS", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codec-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const site = path.join(root, "site");
  await fs.mkdir(site);
  await fs.writeFile(
    path.join(site, "style.css"),
    ":root{--brand:#0ea5e9}.card{display:flex;gap:8px;padding:16px;border-radius:12px;background:var(--brand);color:#fff}@media (max-width:600px){.card{flex-direction:column}}",
  );
  await fs.writeFile(
    path.join(site, "index.html"),
    '<!doctype html><title>Site</title><link rel="stylesheet" href="style.css"><body><div class="card"><b>One</b><span>Two</span></div></body>',
  );
  const run = (args) =>
    spawnSync(process.execPath, ["integrations/design-cli.mjs", "--root", root, ...args], {
      encoding: "utf8",
    });
  const imported = run([
    "import-html",
    "site",
    path.join(site, "index.html"),
    "--viewport",
    "500x800",
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  const doc = JSON.parse(imported.stdout).document;
  const card = doc.pages[0].nodes.find((n) => n.name === "div.card");
  assert.deepEqual(
    [card.layout, card.direction, card.gap, card.padding, card.radius, card.token],
    ["flex", "column", 8, 16, 12, "brand"],
  );
  assert.equal(doc.tokens.brand, "#0ea5e9");
  assert.equal(
    run(["import-html", "site", path.join(site, "index.html")]).status,
    1,
    "refuses to overwrite",
  );

  const jsx = run(["export-jsx", "site"]);
  assert.equal(jsx.status, 0, jsx.stderr);
  await fs.writeFile(path.join(root, "site.jsx"), jsx.stdout);
  const fromJsx = run(["import-jsx", "site-jsx", path.join(root, "site.jsx")]);
  assert.equal(fromJsx.status, 0, fromJsx.stderr);
  const css = run(["export-css", "site"]);
  assert.equal(css.status, 0, css.stderr);
  await fs.writeFile(path.join(root, "site.html"), css.stdout);
  const fromCss = run(["import-html", "site-css", path.join(root, "site.html")]);
  assert.equal(fromCss.status, 0, fromCss.stderr);
  for (const out of [fromJsx, fromCss]) {
    const back = JSON.parse(out.stdout).document;
    assert.deepEqual(back.pages[0].nodes.map(strip), doc.pages[0].nodes.map(strip));
    assert.deepEqual(back.tokens, doc.tokens);
  }
});
