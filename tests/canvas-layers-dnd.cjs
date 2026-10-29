// Layers panel drag & drop (reorder / re-parent / multi-select / locked / cancel), flip and rotate 90°,
// eyedropper (EyeDropper API and click-to-sample fallback), ellipse shapes and the extra context-menu commands.
const {_electron} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-layers-dnd-')), env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({env, args: ['.', `--user-data-dir=${dir}`], timeout: 20000});
  try {
    const page = await app.firstWindow({timeout: 20000});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('#canvas .layer');
    await page.waitForSelector('#bd-layer-tree');
    const near = (actual, expected, tolerance = 1, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const nodesOf = async () => (await page.evaluate(() => window.design.getDocument())).pages[0].nodes;
    const node = async id => (await nodesOf()).find(n => n.id === id);
    const siblings = async (parentId = null) => (await nodesOf()).filter(n => (n.parentId || null) === parentId).map(n => n.id);
    const selection = () => page.evaluate(() => window.design.getSelection().toSorted());
    const undo = () => page.evaluate(() => document.getElementById('undo').click());
    const rect = (id, x, y, w = 100, h = 80, extra = {}) => ({id, name: id, type: 'rectangle', x, y, w, h, color: '#8844cc', ...extra});
    const frame = (id, x, y, w, h, extra = {}) => ({id, name: id, type: 'frame', x, y, w, h, color: '#ffffff', layout: 'free', ...extra});
    async function seed(nodes) {
      await page.evaluate(nodes => {
        const d = window.design.getDocument();
        d.pages = [{id: d.pages[0].id, name: 'Desktop', nodes}]; d.activePage = d.pages[0].id;
        window.design.setDocument(d); window.design.setSelection([]); window.design.setTool('move'); window.design.setCamera(100, 100, 1);
      }, nodes);
    }
    const canvasRect = id => page.locator(`#canvas [data-id="${id}"]`).evaluate(e => e.getBoundingClientRect().toJSON());
    const row = id => page.locator(`#bd-layer-tree .layer-row[data-id="${id}"]`);
    // Drag a layer row to a fraction of another row's height (0 = top edge, 1 = bottom edge), or below the list.
    async function dragRow(from, to, fraction = 0.5, {during, before} = {}) {
      const a = await row(from).boundingBox();
      let y;
      if (to === 'end') { const tree = await page.locator('#bd-layer-tree').boundingBox(); const rows = await page.locator('#bd-layer-tree .layer-row').evaluateAll(els => Math.max(...els.map(e => e.getBoundingClientRect().bottom))); y = Math.min(tree.y + tree.height - 30, rows + 12); }
      else { const b = await row(to).boundingBox(); y = b.y + b.height * fraction; }
      await page.mouse.move(a.x + 60, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(a.x + 60, y, {steps: 8});
      const seen = during ? await during() : undefined;
      if (before) await before();
      await page.mouse.up();
      return seen;
    }
    const indicator = () => page.locator('#bd-layer-drop-indicator').evaluate(e => ({position: e.dataset.position, target: e.dataset.target})).catch(() => null);

    // ---- 1. Reorder siblings: the panel lists the frontmost layer first ----
    await seed([frame('F', 100, 50, 400, 300), rect('c1', 20, 20, 80, 60, {parentId: 'F'}), rect('a', 600, 0), rect('b', 600, 200, 100, 80, {color: '#00aa00'}), rect('L', 800, 0, 100, 80, {locked: true})]);
    assert.deepEqual(await page.locator('#bd-layer-tree .layer-row').evaluateAll(els => els.map(e => e.dataset.id)), ['L', 'b', 'a', 'F'], 'top rows are frontmost; frames start collapsed');
    const seen = await dragRow('a', 'b', 0.1, {during: indicator});
    assert.deepEqual(seen, {position: 'above', target: 'b'}, 'drop indicator shows above the hovered row');
    assert.deepEqual(await siblings(), ['F', 'b', 'a', 'L'], 'a moved in front of b');
    assert.equal(await page.locator('#bd-layer-drop-indicator').count(), 0, 'indicator removed after drop');
    assert.deepEqual(await selection(), ['a'], 'dragged layer is selected');
    await undo();
    assert.deepEqual(await siblings(), ['F', 'a', 'b', 'L'], 'reorder is one undo step');
    // Below a row = behind it.
    await dragRow('b', 'F', 0.9);
    assert.deepEqual(await siblings(), ['b', 'F', 'a', 'L'], 'drop below the frame sends b behind it');
    await undo();

    // ---- 2. Re-parent into a frame keeps the on-screen position ----
    const beforeB = await canvasRect('b');
    assert.deepEqual(await dragRow('b', 'F', 0.5, {during: indicator}), {position: 'inside', target: 'F'});
    let b = await node('b');
    assert.equal(b.parentId, 'F'); near(b.x, 500); near(b.y, 150);
    const afterB = await canvasRect('b');
    near(afterB.left, beforeB.left, 1, 'b stays put on screen x'); near(afterB.top, beforeB.top, 1, 'b stays put on screen y');
    assert.equal(await row('b').count(), 1, 'target frame is expanded to show the moved layer');
    assert.deepEqual(await siblings('F'), ['c1', 'b'], 'moved layer becomes the frontmost child');
    await undo();
    b = await node('b'); assert.equal(b.parentId, null, 're-parent is one undo step'); assert.equal(b.x, 600);

    // ---- 3. Out of a frame: drop below the list = root, behind everything ----
    await page.evaluate(() => window.design.setSelection(['c1']));
    await page.waitForSelector('#bd-layer-tree .layer-row[data-id="c1"]');
    const beforeC = await canvasRect('c1');
    await dragRow('c1', 'end');
    const c1 = await node('c1');
    assert.equal(c1.parentId, null, 'c1 left the frame'); near(c1.x, 120); near(c1.y, 70);
    assert.deepEqual(await siblings(), ['c1', 'F', 'a', 'b', 'L'], 'dropped at the back of the page');
    const afterC = await canvasRect('c1'); near(afterC.left, beforeC.left); near(afterC.top, beforeC.top);
    await undo();

    // ---- 4. Multi-selection drags together and keeps its relative order ----
    await page.evaluate(() => window.design.setSelection([]));
    await row('a').click(); await row('b').click({modifiers: ['Shift']});
    assert.deepEqual(await selection(), ['a', 'b']);
    await dragRow('a', 'F', 0.5);
    assert.deepEqual(await siblings('F'), ['c1', 'a', 'b'], 'both layers moved into the frame in order');
    assert.deepEqual(await selection(), ['a', 'b'], 'selection kept');
    await undo();
    assert.deepEqual(await siblings(), ['F', 'a', 'b', 'L'], 'multi move is one undo step');

    // ---- 5. Locked layers do not move; nothing drops into a locked frame; Escape cancels ----
    await page.evaluate(() => window.design.setSelection([]));
    await dragRow('L', 'F', 0.5);
    assert.equal((await node('L')).parentId, null, 'locked layer cannot be dragged');
    await page.evaluate(() => window.design.updateNodes(['F'], {locked: true}));
    await page.evaluate(() => window.design.setSelection([]));
    const lockedDrop = await dragRow('a', 'F', 0.5, {during: indicator});
    assert.notEqual(lockedDrop?.position, 'inside', 'no inside indicator on a locked frame');
    assert.equal((await node('a')).parentId, null, 'cannot drop into a locked frame');
    await page.evaluate(() => window.design.updateNodes(['F'], {locked: undefined}));
    const order = await siblings();
    await dragRow('a', 'L', 0.1, {before: () => page.keyboard.press('Escape')});
    assert.deepEqual(await siblings(), order, 'Escape cancels the drag');
    assert.deepEqual(await page.evaluate(() => window.design.moveNodes(['F'], 'c1', 'inside')), null, 'cannot drop a frame into its own child');

    // ---- 6. Flip and rotate ----
    await seed([rect('a', 0, 0, 100, 60, {rotation: 30}), rect('b', 200, 0, 50, 60)]);
    await page.evaluate(() => window.design.setSelection(['a']));
    await page.keyboard.press('Shift+KeyH');
    let a = await node('a');
    assert.equal(a.flipX, true, '⇧H flips horizontally'); assert.equal(a.rotation, -30, 'mirroring negates rotation');
    assert.match(await page.locator('#canvas [data-id=a]').evaluate(e => e.style.transform), /rotate\(-30deg\) scale\(-1, 1\)/);
    await page.keyboard.press('Shift+KeyV');
    a = await node('a'); assert.equal(a.flipY, true, '⇧V flips vertically'); assert.equal(a.rotation, 30);
    await undo(); await undo();
    a = await node('a'); assert.equal(a.flipX, undefined); assert.equal(a.rotation, 30, 'each flip is one undo step');
    // Group flip mirrors positions across the selection bounds.
    await page.evaluate(() => window.design.updateNodes(['a'], {rotation: 0}));
    await page.evaluate(() => window.design.setSelection(['a', 'b']));
    await page.keyboard.press('Shift+KeyH');
    assert.equal((await node('a')).x, 150, 'a mirrored to the right'); assert.equal((await node('b')).x, 0, 'b mirrored to the left');
    assert.equal((await node('b')).flipX, true);
    await undo();
    // Rotate 90° from the context menu.
    await page.evaluate(() => window.design.setSelection(['b']));
    const bc = await canvasRect('b');
    await page.mouse.click(bc.left + 10, bc.top + 10, {button: 'right'});
    for (const id of ['transform.flipH', 'transform.flipV', 'transform.rotate90', 'edit.copyPng', 'edit.copyCode', 'select.inverse', 'select.matching']) assert.ok(await page.locator(`#canvas-menu [data-command="${id}"]`).isVisible(), id + ' in context menu');
    await page.locator('#canvas-menu [data-command="transform.rotate90"]').click();
    assert.equal((await node('b')).rotation, 90, 'rotate 90°');
    await page.keyboard.press('Alt+Shift+KeyR');
    assert.equal((await node('b')).rotation, 180, '⌥⇧R rotates again');
    await page.keyboard.press('Alt+Shift+KeyR');
    assert.equal((await node('b')).rotation, -90, 'rotation stays within (-180, 180]');
    // A flipped layer resizes from the handle under the pointer.
    await seed([rect('f', 0, 0, 100, 80, {flipX: true})]);
    await page.evaluate(() => window.design.setSelection(['f']));
    const handle = await page.locator('#canvas [data-id=f] .handle[data-corner=se]').boundingBox();
    const box = await canvasRect('f');
    assert.ok(handle.x < box.left + box.width / 2, 'the se handle of a horizontally flipped layer sits on the left');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 20, handle.y + handle.height / 2, {steps: 4}); await page.mouse.up();
    const f = await node('f'); near(f.w, 120, 0.5, 'dragging the left handle outward widens'); near(f.x, -20, 0.5, 'right edge stays fixed');

    // ---- 7. Eyedropper ----
    await seed([rect('a', 0, 0), rect('b', 200, 0, 100, 80, {color: '#00aa00'}), {id: 't', name: 't', type: 'text', x: 0, y: 200, w: 200, h: 40, text: 'Hi', color: '#222222'}]);
    assert.ok(await page.locator('#eyedropper-tool').isVisible(), 'toolbar has an eyedropper');
    await page.evaluate(() => { window.EyeDropper = class { open() { return Promise.resolve({sRGBHex: '#123456'}); } }; window.design.setSelection(['a', 't']); });
    await page.keyboard.press('i');
    await page.waitForFunction(() => window.design.getTool() === 'move');
    assert.equal((await node('a')).color, '#123456', 'picked color fills the shape');
    assert.equal((await node('t')).color, '#123456', 'and colors the text');
    await undo();
    assert.equal((await node('a')).color, '#8844cc', 'eyedropper is one undo step'); assert.equal((await node('t')).color, '#222222');
    // Without the EyeDropper API the tool samples the layer under the pointer.
    await page.evaluate(() => { window.EyeDropper = undefined; window.design.setSelection(['a']); });
    await page.locator('#eyedropper-tool').click();
    assert.equal(await page.evaluate(() => window.design.getTool()), 'eyedropper');
    assert.equal(await page.locator('#eyedropper-tool').getAttribute('aria-pressed'), 'true');
    const bb = await canvasRect('b');
    await page.mouse.click(bb.left + 20, bb.top + 20);
    assert.equal((await node('a')).color, '#00aa00', 'fallback samples the clicked layer');
    assert.deepEqual(await selection(), ['a'], 'sampling does not change the selection');
    assert.equal(await page.evaluate(() => window.design.getTool()), 'move');

    // ---- 8. Ellipse ----
    await seed([rect('a', 0, 0)]);
    await page.keyboard.press('o');
    assert.equal(await page.evaluate(() => window.design.getTool()), 'ellipse');
    const wrap = await page.locator('#canvas-wrap').boundingBox();
    const cam = await page.evaluate(() => window.design.getCamera());
    const sx = wrap.x + cam.x + 300, sy = wrap.y + cam.y + 50;
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 120, sy + 80, {steps: 5}); await page.mouse.up();
    let ellipse = (await nodesOf()).find(n => n.ellipse);
    assert.ok(ellipse, 'O + drag draws an ellipse'); near(ellipse.w, 120); near(ellipse.h, 80); assert.equal(ellipse.type, 'rectangle');
    assert.equal(await page.locator(`#canvas [data-id="${ellipse.id}"]`).evaluate(e => e.style.borderRadius), '50%');
    await page.locator('#add-ellipse').click();
    assert.equal((await nodesOf()).filter(n => n.ellipse).length, 2, 'toolbar inserts an ellipse');
    // Select matching / inverse.
    await page.evaluate(id => window.design.setSelection([id]), ellipse.id);
    assert.ok(await page.evaluate(() => window.design.runCommand('select.matching')));
    assert.equal((await selection()).length, 2, 'select matching picks every ellipse');
    await page.keyboard.press('Meta+Shift+KeyA');
    assert.deepEqual(await selection(), ['a'], '⌘⇧A selects the inverse');

    // ---- 9. Copy as code / PNG ----
    await page.evaluate(() => window.design.setSelection(['a']));
    await page.keyboard.press('Meta+Shift+KeyC');
    await page.waitForFunction(() => /Copied selection as HTML/.test(document.querySelector('#workspace footer, footer')?.textContent || ''));
    const code = await app.evaluate(({clipboard}) => clipboard.readText());
    assert.match(code, /<!doctype html>/i); assert.match(code, /data-id="a"/);
    assert.ok(await page.evaluate(() => window.design.runCommand('edit.copyPng')));
    await page.waitForFunction(() => /PNG/.test(document.querySelector('#workspace footer, footer')?.textContent || ''));
    const footerText = await page.evaluate(() => document.querySelector('#workspace footer, footer').textContent);
    const image = await app.evaluate(({clipboard}) => clipboard.readImage().getSize());
    if (image.width) assert.ok(/Copied 200 × 160 PNG$/.test(footerText) && image.width === 200 && image.height === 160, `copy as PNG puts a 2× image on the clipboard (${footerText}; ${JSON.stringify(image)})`);
    else {
      // The shell denies async-clipboard image writes: the PNG is copied as an HTML <img> instead.
      assert.match(footerText, /Copied 200 × 160 PNG as an HTML image/);
      const html = await app.evaluate(({clipboard}) => clipboard.readHTML());
      const size = await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, html.match(/src="(data:image\/png;base64,[^"]+)"/)[1]);
      assert.deepEqual(size, [200, 160], 'clipboard HTML carries the 2× PNG');
    }

    assert.deepEqual(errors, [], 'no page errors');
    console.log('canvas layers dnd tests passed');
  } finally {
    await app.close();
    await fs.rm(dir, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exit(1); });
