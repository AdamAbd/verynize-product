// Paint stack, image fill fit, multicolour SVG Colors and the Export section (design/wonder/2026-10-30 05–07,
// 21–26, 41; docs/wonder-design-workflow-2026-10-30.md P20, P22, P23, P30, P32). Real Electron: UI edits through
// the inspector, native raster/vector/code export through the save dialog, decoded output pixels and dimensions.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const LOGO = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="10" height="10" fill="#ff0000"/><rect x="10" width="10" height="10" fill="#0000ff"/></svg>',
);

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-paints-"));
  const out = path.join(dir, "out");
  await fs.mkdir(out);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1';
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const fill = page.locator("#fill-section");
    const setup = (nodes) =>
      page.evaluate((nodes) => {
        const d = window.design.getDocument();
        d.tokens = { brand: "#172033" };
        delete d.variables;
        d.pages[0].nodes = nodes;
        window.design.setDocument(d);
        window.design.setSelection([nodes[0].id]);
      }, nodes);
    // Decode an exported image in the renderer (sRGB canvas) and sample pixels at output coordinates.
    const sample = (file, mime, points) =>
      fs.readFile(file).then((bytes) =>
        page.evaluate(
          async ({ b64, mime, points }) => {
            const image = new Image();
            await new Promise((ok, fail) => {
              image.onload = ok;
              image.onerror = fail;
              image.src = `data:${mime};base64,${b64}`;
            });
            const c = document.createElement("canvas");
            c.width = image.naturalWidth;
            c.height = image.naturalHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(image, 0, 0);
            return {
              width: c.width,
              height: c.height,
              px: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]),
            };
          },
          { b64: bytes.toString("base64"), mime, points },
        ),
      );
    const near = (actual, expected, label, tol = 3) =>
      assert.ok(
        actual.every((v, i) => Math.abs(v - expected[i]) <= tol),
        `${label}: ${actual} ≈ ${expected}`,
      );
    // Escape only while a paint editor is open (on the canvas it would clear the selection).
    const closeDialog = async () => {
      if (await page.locator("#color-dialog").count()) await page.keyboard.press("Escape");
      await page.waitForSelector("#color-dialog", { state: "detached" });
    };
    let target = "",
      defaultPath = "";
    // The Export section starts closed for every newly selected layer.
    const openExport = async () => {
      if (!(await page.locator("#artwork-scale").isVisible()))
        await page.locator("#export-section .insp-add").click();
    };
    const saveAs = async (file) => {
      target = path.join(out, file);
      await app.evaluate(({ dialog }, t) => {
        dialog.showSaveDialog = async (_w, o) => {
          globalThis.__lastDefault = o.defaultPath;
          return { canceled: false, filePath: t };
        };
      }, target);
    };
    const exportNow = async () => {
      await fs.rm(target, { force: true });
      await page.locator("#artwork-download").click();
      const deadline = Date.now() + 30000;
      for (;;) {
        const status = (await page.locator("#artwork-status").textContent()) || "";
        if (
          /^Exported/.test(status) &&
          (await fs.stat(target).then(
            () => true,
            () => false,
          ))
        )
          break;
        if (status && !/^Exported/.test(status)) throw new Error("Export failed: " + status);
        if (Date.now() > deadline) throw new Error("Export timed out");
        await page.waitForTimeout(100);
      }
      defaultPath = await app.evaluate(() => globalThis.__lastDefault);
      return fs.readFile(target);
    };

    // --- Paint stack through the inspector --------------------------------------------------------------------
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
      },
    ]);
    assert.equal(
      await fill.locator("[data-paint]").count(),
      1,
      "an older single-fill layer shows one solid paint",
    );
    await fill.getByRole("button", { name: "Add paint" }).click();
    let card = await node("card");
    assert.deepEqual(
      card.fills,
      [
        { type: "solid", color: "#d9d9d9" },
        { type: "solid", color: "#ff0000" },
      ],
      "new paint goes on top",
    );
    await page.locator("[name=color]").click();
    await page.locator("#color-dialog #paint-type").selectOption("linear");
    card = await node("card");
    assert.equal(card.fills[0].type, "linear");
    assert.equal(card.fills[0].stops.length, 2);
    assert.equal(card.fills[0].stops[0].color, "#d9d9d9", "conversion keeps the colour");
    await closeDialog();
    await fill.getByRole("button", { name: "Edit linear paint" }).click();
    await page.locator("#color-dialog").getByRole("button", { name: "Add stop" }).click();
    assert.equal((await node("card")).fills[0].stops.length, 3, "Add stop");
    const pos = page.getByRole("textbox", { name: "Stop 3 position" });
    await pos.fill("25");
    await pos.press("Enter");
    assert.equal((await node("card")).fills[0].stops[2].position, 25);
    await page.locator("#color-dialog").getByRole("button", { name: "Remove stop 3" }).click();
    assert.equal((await node("card")).fills[0].stops.length, 2, "Remove stop");
    // Bind stop 1 to a colour variable, then detach: the resolved colour stays.
    await page.locator("#color-dialog").getByRole("button", { name: "Select stop 1" }).click();
    await page.locator("#color-dialog").getByRole("tab", { name: "Variables" }).click();
    await page.locator("#color-dialog").getByRole("option", { name: /brand/ }).click();
    card = await node("card");
    assert.deepEqual(card.fills[0].stops[0], { position: 0, color: "#172033", token: "brand" });
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens.brand = "#00ff00";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    assert.match(
      await page.locator("#canvas [data-id=card]").evaluate((e) => e.style.backgroundImage),
      /rgb\(0, 255, 0\) 0%/,
      "bound stop follows the variable at render time",
    );
    // setDocument replaces the document (the editor may close); reopen it to detach.
    await page.waitForTimeout(300);
    if (!(await page.locator("#color-dialog").count()))
      await fill.getByRole("button", { name: "Edit linear paint" }).click();
    await page
      .locator("#color-dialog")
      .getByRole("button", { name: "Detach stop 1 variable" })
      .click();
    card = await node("card");
    assert.deepEqual(
      card.fills[0].stops[0],
      { position: 0, color: "#00ff00" },
      "detach keeps the resolved colour",
    );
    await page.locator("#color-dialog").getByRole("button", { name: "Move paint down" }).click();
    assert.equal((await node("card")).fills[1].type, "linear", "reorder");
    await closeDialog();
    await fill.locator('[data-paint-visibility="1"]').click();
    assert.equal((await node("card")).fills[1].hidden, true, "hide paint");
    assert.equal(
      await page.locator("#canvas [data-id=card]").evaluate((e) => e.style.backgroundImage),
      "linear-gradient(rgb(255, 0, 0), rgb(255, 0, 0))",
      "hidden paint is not drawn",
    );
    await fill.locator('[data-paint-remove="1"]').click();
    card = await node("card");
    assert.equal(card.fills, undefined, "one plain solid paint collapses back into color");
    assert.equal(card.color, "#ff0000");
    console.log(
      "PASS paint stack: add, type conversion, stops add/position/remove, stop variable bind/follow/detach, reorder, hide, remove, collapse to single fill",
    );

    // --- Rendered pixels: stack with per-paint opacity, hidden paint (native PNG export, 2×) ------------------
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
        fills: [
          { type: "solid", color: "#ff0000", opacity: 50 },
          {
            type: "linear",
            angle: 90,
            stops: [
              { position: 0, color: "#0000ff" },
              { position: 50, color: "#0000ff" },
              { position: 50, color: "#00ff00" },
              { position: 100, color: "#00ff00" },
            ],
          },
        ],
      },
    ]);
    await openExport();
    await saveAs("stack.png");
    await page.locator("#artwork-scale").selectOption("2");
    await page.locator("#artwork-format").selectOption("PNG");
    await exportNow();
    let shot = await sample(target, "image/png", [
      [40, 80],
      [160, 80],
    ]);
    assert.deepEqual({ width: shot.width, height: shot.height }, { width: 200, height: 160 });
    assert.equal(path.basename(defaultPath), "Card@2x.png", "default name gets the scale suffix");
    // Translucent blending happens in the display colour space (macOS offscreen capture), so the expected
    // colours come from the equivalent plain layering rendered by the same native pipeline.
    const ref = await page.evaluate(async () => {
      const res = await window.desktop.renderDesign({
        html: '<body style="margin:0"><div style="position:relative;width:100px;height:80px"><div style="position:absolute;inset:0 50px 0 0;background:#0000ff"></div><div style="position:absolute;inset:0 0 0 50px;background:#00ff00"></div><div style="position:absolute;inset:0;background:rgba(255,0,0,0.5)"></div></div>',
        width: 100,
        height: 80,
        scale: 2,
      });
      const i = new Image();
      await new Promise((o) => {
        i.onload = o;
        i.src = res.dataURL;
      });
      const c = document.createElement("canvas");
      c.width = i.width;
      c.height = i.height;
      const x = c.getContext("2d");
      x.drawImage(i, 0, 0);
      return [
        [40, 80],
        [160, 80],
      ].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]);
    });
    near(shot.px[0], ref[0], "left: 50% red over blue");
    near(shot.px[1], ref[1], "right: 50% red over green");
    assert.ok(
      shot.px[0][0] > 100 && shot.px[0][2] > 100 && shot.px[1][0] > 100 && shot.px[1][1] > 100,
      "both paints contribute",
    );
    await fill.locator('[data-paint-visibility="0"]').click();
    await exportNow();
    shot = await sample(target, "image/png", [
      [40, 80],
      [160, 80],
    ]);
    near(shot.px[0], [0, 0, 255, 255], "hidden top paint: blue");
    near(shot.px[1], [0, 255, 0, 255], "hidden top paint: green");
    console.log("PASS stack pixels: per-paint opacity and hidden paint in the exported PNG");

    // --- Image fill fit modes (Fill / Cover / Contain / None) and image paint opacity ---------------------------
    const green = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 10;
      c.height = 10;
      const x = c.getContext("2d");
      x.fillStyle = "#00ff00";
      x.fillRect(0, 0, 10, 10);
      return c.toDataURL("image/png");
    });
    await setup([
      {
        id: "pic",
        name: "Pic",
        type: "frame",
        x: 20,
        y: 200,
        w: 100,
        h: 50,
        color: "transparent",
        layout: "free",
        fills: [{ type: "image", src: green, fit: "fill", imageWidth: 10, imageHeight: 10 }],
      },
    ]);
    await saveAs("pic.png");
    await openExport();
    await page.locator("#artwork-scale").selectOption("1");
    const expect = { fill: [1, 1, 1], cover: [1, 1, 1], contain: [0, 1, 1], none: [0, 0, 1] };
    for (const fit of ["fill", "cover", "contain", "none"]) {
      await fill.getByRole("button", { name: "Edit image paint" }).click();
      await page.locator("#color-dialog #paint-image-fit").selectOption(fit);
      assert.equal((await node("pic")).fills[0].fit, fit);
      await closeDialog();
      await exportNow();
      const r = await sample(target, "image/png", [
        [10, 25],
        [30, 25],
        [50, 25],
      ]);
      assert.deepEqual(
        r.px.map((p) => (p[3] > 200 && p[1] > 200 ? 1 : 0)),
        expect[fit],
        `${fit}: painted columns ${JSON.stringify(r.px)}`,
      );
      assert.equal(r.px[0][3] === 0 || expect[fit][0] === 1, true);
    }
    const opacityField = fill.getByRole("textbox", { name: "Fill opacity" });
    await opacityField.fill("50");
    await opacityField.press("Enter");
    assert.equal((await node("pic")).fills[0].opacity, 50);
    await exportNow();
    const faded = await sample(target, "image/png", [[50, 25]]);
    assert.ok(
      Math.abs(faded.px[0][3] - 128) <= 4 && faded.px[0][1] > 240,
      `image paint at 50%: ${faded.px[0]}`,
    );
    console.log(
      "PASS image fill fit Fill/Cover/Contain/None and image paint opacity in exported pixels",
    );

    // --- Text Fill: gradient paint clips to the glyphs ------------------------------------------------------------
    await setup([
      {
        id: "title",
        name: "Title",
        type: "text",
        x: 20,
        y: 300,
        w: 200,
        h: 60,
        text: "Gradient",
        fontSize: 40,
        color: "#111111",
        fills: [
          {
            type: "linear",
            angle: 90,
            stops: [
              { position: 0, color: "#ff0000" },
              { position: 100, color: "#0000ff" },
            ],
          },
        ],
      },
    ]);
    assert.equal(await fill.locator("h3").textContent(), "Text Fill");
    const textStyle = await page
      .locator("#canvas [data-id=title]")
      .evaluate((e) => ({
        clip: getComputedStyle(e).backgroundClip,
        color: getComputedStyle(e).color,
        image: e.style.backgroundImage,
      }));
    assert.deepEqual(textStyle, {
      clip: "text",
      color: "rgba(0, 0, 0, 0)",
      image: "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    });
    console.log("PASS Text Fill gradient clipped to text");

    // --- Multicolour SVG Colors, SVG-only export format, recoloured raster and vector output --------------------
    await setup([
      {
        id: "logo",
        name: "Logo",
        type: "image",
        x: 20,
        y: 400,
        w: 40,
        h: 20,
        color: "transparent",
        src: LOGO,
      },
    ]);
    const colors = page.locator("#svg-colors-section");
    assert.equal(
      await colors.locator("[data-svg-paints]").getAttribute("data-svg-paints"),
      "2",
      "one row per distinct paint",
    );
    const hex = page.getByRole("textbox", { name: "SVG color 1 hex" });
    await hex.fill("00ff00");
    await hex.press("Enter");
    assert.deepEqual((await node("logo")).svgPaints, { "#ff0000": "#00ff00" });
    assert.equal((await node("logo")).src, LOGO, "source unchanged");
    await openExport();
    const formats = await page
      .locator("#artwork-format option")
      .evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(
      formats,
      ["SVG", "PNG", "JPG", "WEBP", "PDF", "CODE"],
      "SVG offered for an SVG-only selection",
    );
    await saveAs("logo.png");
    await page.locator("#artwork-scale").selectOption("2");
    await page.locator("#artwork-format").selectOption("PNG");
    await exportNow();
    const logo = await sample(target, "image/png", [
      [20, 20],
      [60, 20],
    ]);
    assert.deepEqual({ width: logo.width, height: logo.height }, { width: 80, height: 40 });
    near(logo.px[0], [0, 255, 0, 255], "replaced paint");
    near(logo.px[1], [0, 0, 255, 255], "untouched paint");
    await saveAs("logo.svg");
    await page.locator("#artwork-format").selectOption("SVG");
    const vector = (await exportNow()).toString();
    assert.match(vector, /^<svg[^>]* width="80" height="40" viewBox="0 0 40 20"/);
    assert.match(vector, /fill="#00ff00"/);
    assert.match(vector, /fill="#0000ff"/);
    assert.doesNotMatch(vector, /foreignObject/);
    const drawn = await sample(target, "image/svg+xml", [
      [20, 20],
      [60, 20],
    ]);
    near(drawn.px[0], [0, 255, 0, 255], "SVG output draws the replacement");
    await page.getByRole("button", { name: "Restore SVG color 1" }).click();
    assert.equal((await node("logo")).svgPaints, undefined);
    console.log(
      "PASS multicolour SVG Colors: per-paint replacement, restore, SVG-only format, recoloured PNG and SVG output",
    );

    // --- Size presets, formats, suffix and code ----------------------------------------------------------------
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
        fills: [
          { type: "solid", color: "#ff0000" },
          { type: "solid", color: "#0000ff", hidden: true },
        ],
      },
    ]);
    await openExport();
    assert.deepEqual(
      await page.locator("#artwork-format option").evaluateAll((els) => els.map((e) => e.value)),
      ["PNG", "JPG", "WEBP", "PDF", "CODE"],
      "no SVG for a frame",
    );
    await page.locator("#artwork-format").selectOption("PNG");
    for (const [preset, size, name] of [
      ["720p", [900, 720], "Card@720p.png"],
      ["512w", [512, 410], "Card@512w.png"],
      ["512h", [640, 512], "Card@512h.png"],
      ["2160p", [2700, 2160], "Card@2160p.png"],
      ["0.5", [50, 40], "Card@0.5x.png"],
    ]) {
      await saveAs(`card-${preset}.png`);
      await page.locator("#artwork-scale").selectOption(preset);
      const bytes = await exportNow();
      assert.deepEqual(pngSize(bytes), { width: size[0], height: size[1] }, preset);
      assert.equal(path.basename(defaultPath), name);
      // Right and bottom edge centres (layers default to a 12 px corner radius, so not the corner itself).
      const corner = await sample(target, "image/png", [
        [size[0] - 2, Math.floor(size[1] / 2)],
        [Math.floor(size[0] / 2), size[1] - 2],
      ]);
      near(corner.px[0], [255, 0, 0, 255], `${preset}: artwork fills the output`);
      near(corner.px[1], [255, 0, 0, 255], `${preset}: artwork fills the output height`);
    }
    const suffix = page.getByRole("textbox", { name: "Export file suffix" });
    await suffix.fill("-hero");
    await suffix.press("Enter");
    await saveAs("hero.png");
    await exportNow();
    assert.equal(path.basename(defaultPath), "Card-hero.png", "custom suffix");
    for (const [format, mime, magic] of [
      ["JPG", "image/jpeg", "ffd8ff"],
      ["WEBP", "image/webp", "52494646"],
    ]) {
      await page.locator("#artwork-scale").selectOption("2");
      await page.locator("#artwork-format").selectOption(format);
      await saveAs(`card.${format.toLowerCase()}`);
      const bytes = await exportNow();
      assert.equal(
        bytes.subarray(0, magic.length / 2).toString("hex"),
        magic,
        `${format} signature`,
      );
      const r = await sample(target, mime, [[100, 80]]);
      assert.deepEqual(
        { width: r.width, height: r.height },
        { width: 200, height: 160 },
        `${format} dimensions`,
      );
      near(r.px[0], [255, 0, 0, 255], `${format} pixels`, 12);
    }
    await page.locator("#artwork-format").selectOption("CODE");
    assert.equal(await page.locator("#artwork-scale").isDisabled(), true, "code has no scale");
    await page.locator("#artwork-code").selectOption("tailwind");
    await saveAs("card.jsx");
    const jsx = (await exportNow()).toString();
    assert.match(jsx, /export default function Card\(\)/);
    assert.match(jsx, /data-fills="\[/);
    assert.match(jsx, /className="[^"]*bg-/);
    assert.doesNotMatch(jsx, /data-node-id/);
    await page.locator("#artwork-code").selectOption("css");
    await saveAs("card.html");
    const html = (await exportNow()).toString();
    assert.match(
      html,
      /<style>[\s\S]*:root \{\n  --brand: #172033;[\s\S]*\.card \{\n[^}]*background: linear-gradient\(rgb\(255, 0, 0\), rgb\(255, 0, 0\)\)/,
    );
    assert.match(html, /<div[^>]* class="card"/);
    assert.doesNotMatch(html, /data-id="card"[^>]* style=/);
    console.log(
      "PASS export presets 720p/512w/512h/2160p/0.5×, suffix, JPG/WebP pixels, Code Tailwind and CSS",
    );

    // --- Persistence and back-compat ------------------------------------------------------------------------------
    await page.evaluate((src) => {
      const d = window.design.getDocument();
      d.pages[0].nodes.push(
        {
          id: "old",
          name: "Old",
          type: "rectangle",
          x: 300,
          y: 20,
          w: 50,
          h: 50,
          color: "#123456",
        },
        {
          id: "logo",
          name: "Logo",
          type: "image",
          x: 20,
          y: 400,
          w: 40,
          h: 20,
          color: "transparent",
          src,
          svgPaints: { "#0000ff": "#ffff00" },
        },
      );
      window.design.setDocument(d);
    }, LOGO);
    await page.reload();
    await page.waitForSelector("#canvas .layer");
    assert.equal((await node("card")).fills.length, 2, "fills persist");
    assert.deepEqual(
      (await node("logo")).svgPaints,
      { "#0000ff": "#ffff00" },
      "SVG paints persist",
    );
    assert.equal((await node("old")).fills, undefined, "single-fill layers keep their shape");
    assert.equal(
      await page
        .locator("#canvas [data-id=old]")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(18, 52, 86)",
    );
    const rejected = await page.evaluate(() => {
      const out = [];
      for (const bad of [
        { type: "solid", color: "red" },
        { type: "image", src: "https://x.test/a.png" },
        { type: "linear", stops: [] },
      ]) {
        const d = window.design.getDocument();
        d.pages[0].nodes[0].fills = [bad];
        try {
          window.design.setDocument(d);
          out.push(false);
        } catch {
          out.push(true);
        }
      }
      return out;
    });
    assert.deepEqual(rejected, [true, true, true], "validate() rejects malformed paints");
    assert.deepEqual(errors, [], "no renderer errors");
    console.log("PASS persistence, single-fill back-compat and paint validation");
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
