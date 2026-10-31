// Selection chrome and transform gestures (Wonder S4, TR1, TR2, T4): size badge text, the add-to-chat chip, the
// multi-selection union box, rotate zones outside the corners, edge resize with Shift / Alt, and the Scale tool's
// proportional factor.
const {_electron} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-transform-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1';
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    const near = (actual, expected, tolerance = 1.5, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const node = id => page.evaluate(id => window.design.getDocument().pages[0].nodes.find(n => n.id === id), id);
    const rect = (id, x, y, w, h, extra = {}) => ({id, name: 'Card ' + id, type: 'rectangle', x, y, w, h, color: '#8844cc', ...extra});
    async function seed(nodes, selection) {
      await page.evaluate(([nodes, selection]) => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setTool('move'); window.design.setCamera(100, 100, 1);
        window.design.setSelection(selection);
      }, [nodes, selection]);
    }
    async function screen(x, y) {
      return page.evaluate(([x, y]) => {
        const r = document.querySelector('#canvas-wrap').getBoundingClientRect(), c = window.design.getCamera();
        return {x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom};
      }, [x, y]);
    }
    const center = async selector => { const b = await page.locator(selector).boundingBox(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; };
    async function dragFrom(from, dx, dy, {modifier, during} = {}) {
      await page.mouse.move(from.x, from.y);
      if (modifier) await page.keyboard.down(modifier);
      await page.mouse.down();
      await page.mouse.move(from.x + dx / 2, from.y + dy / 2, {steps: 4});
      await page.mouse.move(from.x + dx, from.y + dy, {steps: 4});
      const seen = during ? await during() : undefined;
      await page.mouse.up();
      if (modifier) await page.keyboard.up(modifier);
      return seen;
    }

    // ---------- S4: badge text, size and gap; the ⊕ chip ----------
    await seed([rect('a', 200, 200, 100, 70), {id: 'hug', name: 'Hug text', type: 'text', x: 400, y: 200, w: 80, h: 20, text: 'Canvas', fontSize: 12, color: '#ffffff', wMode: 'hug', hMode: 'hug'}], ['a']);
    assert.equal(await page.locator('#selection-measure').textContent(), '100 x 70', 'W x H with a lowercase x and no Fixed');
    const badge = await page.locator('#selection-measure').boundingBox(), box = await page.locator('#canvas [data-id=a]').boundingBox();
    near(badge.height, 22, 1, 'badge height');
    near(badge.y - (box.y + box.height), 10, 1.5, 'badge gap below the box');
    near(badge.x + badge.width / 2, box.x + box.width / 2, 1, 'badge centred');
    const chip = page.locator('#selection-chat-chip');
    assert.ok(await chip.isVisible(), 'the add-to-chat chip shows on a selection');
    assert.equal(await chip.getAttribute('aria-label'), 'Add selection to chat');
    const cb = await chip.boundingBox();
    assert.ok(cb.y + cb.height < box.y && cb.x + cb.width <= box.x + box.width + 1 && cb.x > box.x + box.width - 24, `chip sits above the top-right corner (${JSON.stringify(cb)} vs ${JSON.stringify(box)})`);
    await page.evaluate(() => window.design.setSelection(['hug']));
    assert.match(await page.locator('#selection-measure').textContent(), /^[\d.]+ Hug x [\d.]+ Hug$/, 'Hug reads on both axes');
    // The chip runs the add-to-chat action: the chat opens with the selection as a mention.
    await page.evaluate(() => window.design.setSelection(['a']));
    await chip.click();
    await page.waitForFunction(() => document.body.classList.contains('agent-chat-open'));
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), ['a'], 'clicking the chip keeps the selection');
    await page.evaluate(() => window.agentWorkspace.closeChat());

    // ---------- Multi-selection: one union box with handles and a combined badge ----------
    await seed([rect('a', 200, 200, 100, 70), rect('b', 400, 300, 50, 40)], ['a', 'b']);
    const union = page.locator('#canvas-overlay .selection-union');
    assert.ok(await union.isVisible(), 'a union box surrounds the multi-selection');
    const ub = await union.boundingBox(), tl = await screen(200, 200), br = await screen(450, 340);
    near(ub.x, tl.x, 1); near(ub.y, tl.y, 1); near(ub.width, br.x - tl.x, 1); near(ub.height, br.y - tl.y, 1);
    assert.equal(await union.locator('.union-handle').count(), 4);
    assert.equal(await page.locator('#selection-measure').textContent(), '250 x 140', 'one badge for the union');
    assert.equal(await page.locator('#canvas .layer > .handle:visible').count(), 0, 'no per-node handles in a multi-selection');
    assert.ok(await page.locator('.selection-union #selection-chat-chip').isVisible(), 'the chip sits on the union box');

    // ---------- TR2: dragging just outside a corner rotates around the centre ----------
    await seed([rect('a', 200, 200, 100, 70)], ['a']);
    const c = await screen(250, 235), se = await screen(300, 270);
    const start = {x: se.x + 8, y: se.y + 8};
    assert.ok(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.rotate-zone'), [start.x, start.y]), 'a rotate zone sits just outside the corner');
    const target = {x: c.x + 60, y: c.y - 50}; // pointer swings counter-clockwise around the centre
    await dragFrom(start, target.x - start.x, target.y - start.y);
    const expected = (Math.atan2(target.y - c.y, target.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x)) * 180 / Math.PI;
    let a = await node('a');
    near(a.rotation, expected, 0.5, 'rotation follows the pointer angle');
    assert.deepEqual([a.w, a.h], [100, 70], 'rotation keeps the size');
    near(a.x, 200, 0.01); near(a.y, 200, 0.01);
    near(Number(await page.locator('[name=rotation]').inputValue()), a.rotation, 0.01, 'inspector shows the rotation');
    // The label, chip and badge turn with the node (by a multiple of 90°, within ±45°).
    const turn = await page.locator('#canvas-overlay .sel-text-box').evaluate(el => el.style.transform);
    assert.match(turn, /rotate\(-?[\d.]+deg\)/);
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    assert.equal((await node('a')).rotation || 0, 0, 'one undo step');
    // Shift snaps to 15°.
    await dragFrom(start, target.x - start.x, target.y - start.y, {modifier: 'Shift'});
    a = await node('a');
    assert.equal(Math.abs(a.rotation % 15), 0, `Shift snaps to 15° (${a.rotation})`);
    assert.ok(a.rotation > -180 && a.rotation <= 180);

    // ---------- TR1: edge resize, Shift aspect, Alt from the centre, no distance guides ----------
    await seed([rect('a', 200, 200, 100, 70), rect('far', 600, 200, 40, 40)], ['a']);
    await dragFrom(await center('#canvas-overlay .resize-edge[data-edge=e]'), 40, 25);
    a = await node('a');
    assert.deepEqual([a.x, a.y, a.w, a.h], [200, 200, 140, 70], 'right edge changes only the width');
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    await dragFrom(await center('#canvas-overlay .resize-edge[data-edge=n]'), 0, -30);
    a = await node('a');
    assert.deepEqual([a.x, a.y, a.w, a.h], [200, 170, 100, 100], 'top edge keeps the bottom edge in place');
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    await dragFrom(await center('#canvas-overlay .resize-edge[data-edge=e]'), 50, 0, {modifier: 'Shift'});
    a = await node('a');
    near(a.w, 150, 0.01); near(a.h, 105, 0.01, 'Shift keeps the aspect ratio');
    near(a.x, 200, 0.01); near(a.y, 182.5, 0.01, 'the other axis grows around the centre');
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    await page.mouse.move((await screen(620, 220)).x, (await screen(620, 220)).y); // hover a sibling: Alt would measure to it
    const guides = await dragFrom(await center('#canvas-overlay .resize-edge[data-edge=e]'), 20, 0, {modifier: 'Alt', during: () => page.locator('#canvas-overlay .guide').count()});
    a = await node('a');
    assert.deepEqual([a.x, a.w, a.h], [180, 140, 70], 'Alt resizes from the centre');
    assert.equal(guides, 0, 'no distance guides during a resize');
    await page.evaluate(() => window.design.runCommand('edit.undo'));

    // ---------- T4: the Scale tool scales by the drag projected on the diagonal ----------
    await seed([{id: 'f', name: 'Frame', type: 'frame', x: 200, y: 200, w: 100, h: 70, color: '#ffffff'}, {id: 't', name: 'Label', type: 'text', parentId: 'f', x: 10, y: 10, w: 60, h: 20, text: 'Hi', fontSize: 10, color: '#000000'}], ['f']);
    await page.evaluate(() => window.design.runCommand('tool.scale'));
    // Wonder: 100×70 → 150×105 (150 %) on a diagonal drag.
    await dragFrom(await center('#canvas [data-id=f] > .handle[data-corner=se]'), 50, 35);
    let f = await node('f');
    near(f.w, 150, 0.05); near(f.h, 105, 0.05, 'Wonder 100×70 → 150×105');
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    // A mostly horizontal drag uses the projected factor, not the larger axis factor (which would give 150).
    await dragFrom(await center('#canvas [data-id=f] > .handle[data-corner=se]'), 50, 5);
    f = await node('f');
    const k = (150 * 100 + 75 * 70) / (100 * 100 + 70 * 70);
    near(f.w, 100 * k, 0.05); near(f.h, 70 * k, 0.05, 'diagonal-projected factor');
    const t = await node('t');
    near(t.fontSize, 10 * k, 0.05, 'child type scales with the factor'); near(t.w, 60 * k, 0.05);
    await page.evaluate(() => window.design.runCommand('tool.move'));

    // ---------- T4: the Scale section (Wonder T4-scale-retry: Scale ✕, W 150 | H 105, 150 %) ----------
    await seed([{id: 'f', name: 'Frame', type: 'frame', x: 200, y: 200, w: 100, h: 70, color: '#ffffff'}, {id: 't', name: 'Label', type: 'text', parentId: 'f', x: 10, y: 10, w: 60, h: 20, text: 'Hi', fontSize: 10, color: '#000000'}], ['f']);
    assert.equal(await page.locator('#scale-section').count(), 0, 'no Scale section with the Move tool');
    await page.evaluate(() => window.design.runCommand('tool.scale'));
    await page.locator('#scale-section').waitFor();
    assert.equal(await page.locator('#insp-properties [name=x]').isVisible(), false, 'the Scale section replaces the other sections');
    const scaleField = name => page.locator(`#scale-section [name=${name}]`);
    assert.deepEqual([await scaleField('scaleW').inputValue(), await scaleField('scaleH').inputValue(), await scaleField('scalePercent').inputValue()], ['100', '70', '100']);
    const sw = await scaleField('scaleW').locator('xpath=ancestor::*[@data-field-shell][1]').boundingBox();
    const sp = await scaleField('scalePercent').locator('xpath=ancestor::*[@data-field-shell][1]').boundingBox();
    near(sw.width, 124, 1, 'W field width'); near(sp.width, 256, 1, '% field spans both columns'); near(sp.y - sw.y, 32, 0.5, 'rows 8px apart');
    // A Scale-tool drag reads 150 % against the size the section opened with.
    await dragFrom(await center('#canvas [data-id=f] > .handle[data-corner=se]'), 50, 35);
    await page.waitForFunction(() => document.querySelector('#scale-section [name=scaleW]')?.value === '150', null, {timeout: 3000}).catch(() => {});
    assert.deepEqual([await scaleField('scaleW').inputValue(), await scaleField('scaleH').inputValue(), await scaleField('scalePercent').inputValue()], ['150', '105', '150']);
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    // Typing a percentage scales the layer and its content like the tool, in one undo step.
    await scaleField('scalePercent').fill('200');
    await scaleField('scalePercent').press('Enter');
    f = await node('f');
    assert.deepEqual([f.x, f.y, f.w, f.h], [200, 200, 200, 140], '200 % keeps the top-left corner');
    let label = await node('t');
    assert.deepEqual([label.x, label.y, label.w, label.h, label.fontSize], [20, 20, 120, 40, 20], 'children and type scale too');
    await page.evaluate(() => window.design.runCommand('edit.undo'));
    f = await node('f'); label = await node('t');
    assert.deepEqual([f.w, f.h, label.fontSize], [100, 70, 10], 'one undo step restores the layer and its content');
    // W (or H) scales proportionally.
    await scaleField('scaleW').fill('150');
    await scaleField('scaleW').press('Enter');
    f = await node('f');
    assert.deepEqual([f.w, f.h], [150, 105]);
    assert.equal(await scaleField('scalePercent').inputValue(), '150');
    await scaleField('scaleH').fill('35');
    await scaleField('scaleH').press('Enter');
    f = await node('f');
    assert.deepEqual([f.w, f.h], [50, 35]);
    assert.equal(await scaleField('scalePercent').inputValue(), '50');
    // ✕ leaves the Scale tool and restores the regular inspector.
    await page.locator('#scale-close').click();
    await page.locator('#scale-section').waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => window.design.getTool()), 'move');
    assert.equal(await page.locator('#insp-properties [name=x]').isVisible(), true);

    // ---------- TR2: the rotation field shows "-47.19" in full (Wonder TR2-rotate-verified) ----------
    await seed([rect('r', 150, 300, 100, 70, {rotation: -47.19})], ['r']);
    const rotation = await page.locator('[name=rotation]').evaluate(el => ({value: el.value, fits: el.scrollWidth <= el.clientWidth}));
    assert.deepEqual(rotation, {value: '-47.19', fits: true}, 'rotation value is not truncated');

    // ---------- V3: zoom to selection leaves Wonder's margins (V3-selection: 120×120 → 538 % in an 880×830 view) ----------
    await seed([rect('z', 515, -133, 120, 120)], ['z']);
    await page.evaluate(() => window.design.runCommand('view.selection'));
    const view = await page.evaluate(() => { const r = document.querySelector('#canvas-wrap').getBoundingClientRect(); return {w: r.width, h: r.height, zoom: window.design.getCamera().zoom}; });
    near(view.zoom, Math.min((view.w - 58) / 120, (view.h - 184) / 120), 0.001, 'zoom to selection: 29px sides, 64px top, 120px bottom');
    const zr = await page.locator('#canvas [data-id=z]').boundingBox(), wrapBox = await page.locator('#canvas-wrap').boundingBox();
    near(zr.y - wrapBox.y, 64, 1, 'selection sits 64px below the top edge');

    assert.deepEqual(errors, []);
    console.log('canvas transform: PASS badge text and gap, chat chip, multi-selection box, rotate zones with Shift snap, edge resize with Shift/Alt and no guides, proportional Scale tool, Scale section, rotation field width, zoom-to-selection margins');
  } finally {
    await app.close();
    await fs.rm(dir, {recursive: true, force: true});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
