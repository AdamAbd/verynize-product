// Effects inspector (Wonder 16–21, 27–28): blend menu, border style, a real outline, the shadow list
// (box / inner / drop / text, colour bound to a Colors variable), layer + backdrop filters and gradient
// masks. Every edit goes through the real inspector, is one undo step, renders on the canvas and in
// the exported HTML.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-effects-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const css = (id, prop) =>
      page
        .locator(`#canvas [data-id="${id}"]`)
        .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), prop);
    const undo = async () => {
      await page.evaluate(() => window.design.runCommand("edit.undo"));
    };
    const commit = async (selector, value) => {
      const field = page.locator(selector);
      await field.fill(value);
      await field.press("Enter");
    };
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { ...d.tokens, accent: "#ff0000" };
      d.pages = [
        {
          id: "p",
          name: "Effects",
          nodes: [
            { id: "back", name: "Back", type: "rectangle", x: 20, y: 20, w: 200, h: 120, color: "#3366ff" },
            { id: "card", name: "Card", type: "rectangle", x: 60, y: 40, w: 200, h: 120, color: "#ffcc00", radius: 16 },
            { id: "label", name: "Label", type: "text", x: 20, y: 200, w: 200, h: 40, text: "Hello", color: "#111111", fontSize: 24 },
          ],
        },
      ];
      d.activePage = "p";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    await page.waitForSelector("#appearance-section");

    // Blend: all 18 modes are offered; Multiply applies mix-blend-mode, undo restores Normal.
    await page.locator("#blend-mode").click();
    assert.equal(await page.locator("[data-blend]").count(), 18);
    for (const mode of ["plus-darker", "plus-lighter", "difference", "exclusion", "hue", "saturation", "color", "luminosity"])
      assert.equal(await page.locator(`[data-blend="${mode}"]`).count(), 1, mode);
    await page.locator('[data-blend="multiply"]').click();
    assert.equal((await node("card")).blendMode, "multiply");
    assert.equal(await css("card", "mix-blend-mode"), "multiply");
    await undo();
    assert.equal((await node("card")).blendMode, undefined);
    assert.equal(await css("card", "mix-blend-mode"), "normal");
    // plus-darker keeps a standard fallback when the engine lacks it.
    await page.waitForTimeout(400);
    await page.locator("#blend-mode").click();
    await page.locator('[data-blend="plus-darker"]').click();
    assert.ok(["plus-darker", "color-burn"].includes(await css("card", "mix-blend-mode")));
    await undo();

    // Border style (Solid / Dashed / Dotted) next to uniform + per-side widths.
    await page.locator("#border-section .insp-add").click();
    await commit("[name=strokeWidth]", "2");
    await page.locator("[name=strokeStyle]").selectOption("dashed");
    assert.equal(await css("card", "border-top-style"), "dashed");

    // Outline: a real CSS outline with width / offset / colour, not a box-shadow.
    await page.locator("#outline-section .insp-add").click();
    assert.equal((await node("card")).outlineWidth, 1);
    await commit("[name=outlineWidth]", "3");
    await commit("[name=outlineOffset]", "4");
    await commit("[name=outlineColor]", "5EEAD4");
    let n = await node("card");
    assert.deepEqual([n.outlineWidth, n.outlineOffset, n.outlineColor], [3, 4, "#5eead4"]);
    // The canvas keeps the user's outline while the layer is selected.
    assert.equal(await css("card", "outline-width"), "3px");
    assert.equal(await css("card", "outline-offset"), "4px");
    assert.equal(await css("card", "outline-color"), "rgb(94, 234, 212)");
    assert.equal(await css("card", "box-shadow"), "none");
    await undo();
    assert.equal((await node("card")).outlineColor, "#000000");

    // Shadows: add box, edit geometry, make inner, add drop, bind colour to a variable, hide, remove.
    await page.locator("#shadow-section .insp-add").click();
    await page.waitForSelector("#shadow-editor");
    await commit("[name=shadow-0-x]", "0");
    await commit("[name=shadow-0-y]", "12");
    await commit("[name=shadow-0-blur]", "4");
    await commit("[name=shadow-0-spread]", "-4");
    await commit("[name=shadow-0-colorAlpha]", "25");
    assert.deepEqual((await node("card")).shadows, [{ type: "box", x: 0, y: 12, blur: 4, spread: -4, color: "#00000040" }]);
    assert.equal(await css("card", "box-shadow"), "rgba(0, 0, 0, 0.25) 0px 12px 4px -4px");
    await page.locator("[name=shadow-0-inset]").check();
    assert.ok((await css("card", "box-shadow")).includes("inset"));
    await undo();
    assert.ok(!(await css("card", "box-shadow")).includes("inset"));
    await page.keyboard.press("Escape");
    await page.locator("#shadow-section .insp-add").click();
    await page.locator('[data-shadow-editor="1"] [data-shadow-type="drop"]').click();
    assert.equal((await node("card")).shadows[1].type, "drop");
    assert.match(await css("card", "filter"), /drop-shadow/);
    // Bind the drop shadow colour to the "accent" Colors variable and follow the variable.
    await page.evaluate(() =>
      window.design.updateNodes(["card"], (c) => ({
        shadows: c.shadows.map((s, i) => (i === 1 ? { ...s, token: "accent", color: "#ff0000" } : s)),
      })),
    );
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens.accent = "#00ff00";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    assert.match(await css("card", "filter"), /rgb\(0, 255, 0\)/);
    await page.keyboard.press("Escape");
    await page.locator('[data-shadow-row="1"] [data-effect-tool="visibility"]').click();
    assert.equal((await node("card")).shadows[1].hidden, true);
    assert.equal(await css("card", "filter"), "none");
    await page.locator('[data-shadow-row="1"] [data-effect-tool="remove"]').click();
    assert.equal((await node("card")).shadows.length, 1);

    // Text shadow is offered on text layers only and renders as text-shadow.
    await page.evaluate(() => window.design.setSelection(["label"]));
    await page.locator("#shadow-section .insp-add").click();
    assert.equal(await page.locator('[data-shadow-editor="0"] [data-shadow-type="text"]').count(), 1);
    await page.locator('[data-shadow-editor="0"] [data-shadow-type="text"]').click();
    assert.match(await css("label", "text-shadow"), /rgba\(0, 0, 0, 0\.25\) 0px 4px 12px/);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.design.setSelection(["card"]));

    // Filters: Blur default, change to Brightness 1.1, add a backdrop blur, hide, remove.
    await page.locator("#filter-section .insp-add").click();
    assert.deepEqual((await node("card")).filters, [{ type: "blur", value: 4 }]);
    await page.locator("[name=filter-0-type]").selectOption("layer:brightness");
    await commit("[name=filter-0-value]", "1.1");
    assert.deepEqual((await node("card")).filters, [{ type: "brightness", value: 1.1 }]);
    assert.match(await css("card", "filter"), /^brightness\(1\.1\)/);
    await commit("[name=filter-0-value]", "9");
    assert.equal((await node("card")).filters[0].value, 3, "brightness clamps to 0–3");
    await undo();
    await page.locator("#filter-section .insp-add").click();
    await page.locator("[name=filter-1-type]").selectOption("backdrop:blur");
    assert.equal(await css("card", "backdrop-filter"), "blur(4px)");
    for (const type of ["contrast", "grayscale", "hueRotate", "invert", "saturate", "sepia"]) {
      await page.locator("[name=filter-1-type]").selectOption("layer:" + type);
      assert.notEqual(await css("card", "filter"), "none", type);
    }
    await page.locator('[data-filter-row="1"] [data-effect-tool="visibility"]').click();
    assert.equal(await css("card", "filter"), "brightness(1.1)");
    await page.locator('[data-filter-row="1"] [data-effect-tool="remove"]').click();
    assert.equal((await node("card")).filters.length, 1);

    // Masks: Linear 180° → Conic 45°, alpha, invert, visibility.
    await page.locator("#mask-section .insp-add").click();
    await page.waitForSelector("#mask-editor");
    assert.deepEqual((await node("card")).masks, [{ type: "linear", rotation: 180, alpha: 100 }]);
    // 180deg is the CSS default direction, so the computed value omits it.
    assert.equal(await css("card", "mask-image"), "linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))");
    await page.locator('[data-mask-editor="0"] [data-mask-type="conic"]').click();
    await commit("[name=mask-0-rotation]", "45");
    await commit("[name=mask-0-alpha]", "80");
    await page.locator("[name=mask-0-invert]").check();
    assert.deepEqual((await node("card")).masks, [{ type: "conic", rotation: 45, alpha: 80, invert: true }]);
    assert.match(await css("card", "mask-image"), /conic-gradient\(from 45deg/);
    await page.keyboard.press("Escape");
    await page.locator('[data-mask-row="0"] [data-effect-tool="visibility"]').click();
    assert.equal(await css("card", "mask-image"), "none");
    await page.locator('[data-mask-row="0"] [data-effect-tool="visibility"]').click();

    // Export: the same declarations reach the headless HTML.
    const html = await page.evaluate(() => window.design.exportHTML());
    for (const part of ["box-shadow: rgba(0, 0, 0, 0.25) 0px 12px 4px -4px", "filter: brightness(1.1)", "2px dashed", "outline-offset: 4px", "mask-image: conic-gradient(from 45deg", "text-shadow:"])
      assert.ok(html.includes(part), part);

    // Validation rejects malformed effects (shared with design-store validateDocument).
    const rejected = await page.evaluate(() => {
      const out = [];
      for (const patch of [{ blendMode: "burn" }, { shadows: [{ type: "text", x: 0, y: 0, blur: 0, spread: 0, color: "#000000" }] }, { filters: [{ type: "brightness", value: 9 }] }, { masks: [{ type: "diamond" }] }]) {
        try { window.design.updateNodes(["card"], patch); out.push(false); } catch { out.push(true); }
      }
      return out;
    });
    assert.deepEqual(rejected, [true, true, true, true]);
    console.log("PASS inspector effects: 18 blend modes, border style, real outline, box/inner/drop/text shadows with variable colour, layer/backdrop filters, gradient masks, undo, canvas CSS, export, validation");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
