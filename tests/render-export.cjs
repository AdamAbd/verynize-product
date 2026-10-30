// Native export must scale the artwork itself, not only the output PNG dimensions.
const { _electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'better-render-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1';
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env, timeout: 20000 });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector('#canvas');
    // 7.2 / 27 cover the 720p and 2160p presets of 100×80 artwork: past Chromium's 5× page zoom cap the
    // renderer adds CSS zoom, which must still fill the whole output and keep measurements in CSS px.
    for (const scale of [0.5, 1, 2, 4, 5.12, 7.2, 27]) {
      const result = await page.evaluate(async scale => {
        // Deliberately transparent body: propagating a body background over the viewport can
        // hide an unscaled drawing surrounded by empty space. Only these explicit boxes paint.
        const result = await window.desktop.renderDesign({
          html: '<html><body style="margin:0;background:transparent"><div data-id="art" style="position:relative;width:100px;height:80px"><div data-id="left" style="position:absolute;left:0;top:0;width:50px;height:80px;background:red"></div><div data-id="right" style="position:absolute;left:50px;top:0;width:50px;height:80px;background:blue"></div></div></body></html>',
          width: 100, height: 80, scale,
        });
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = result.dataURL; });
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixel = (x, y) => [...context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data];
        return {
          width: image.width, height: image.height,
          leftTop: pixel(37, 10), leftBottom: pixel(37, 70),
          rightTop: pixel(87, 10), rightBottom: pixel(87, 70),
          boxes: result.boxes,
        };
      }, scale);
      assert.equal(result.width, Math.ceil(100 * scale - 1e-6), `${scale}× PNG width`);
      assert.equal(result.height, Math.ceil(80 * scale - 1e-6), `${scale}× PNG height`);
      assert.deepEqual(result.leftTop, [255, 0, 0, 255], `${scale}× artwork's left half scales horizontally`);
      assert.deepEqual(result.leftBottom, [255, 0, 0, 255], `${scale}× artwork scales vertically`);
      assert.deepEqual(result.rightTop, [0, 0, 255, 255], `${scale}× right half fills the output`);
      assert.deepEqual(result.rightBottom, [0, 0, 255, 255], `${scale}× lower-right artwork is not empty or clipped`);
      const near = (b, e) => Object.entries(e).every(([k, v]) => Math.abs(b[k] - v) < 0.01);
      assert.ok(near(result.boxes.art, { x: 0, y: 0, w: 100, h: 80 }), `${scale}× layout boxes stay in document CSS pixels: ${JSON.stringify(result.boxes.art)}`);
      assert.ok(near(result.boxes.right, { x: 50, y: 0, w: 50, h: 80 }), `${scale}× zoom does not leak into measured positions: ${JSON.stringify(result.boxes.right)}`);
    }
    // Output limits replace the old 4× cap: 16384 px per side, 32 MP.
    const rejected = await page.evaluate(async () => {
      try { await window.desktop.renderDesign({ html: '<div></div>', width: 100, height: 80, scale: 200 }); return null; } catch (error) { return String(error.message || error); }
    });
    assert.match(rejected || '', /32 megapixels|16384/);
    console.log('PASS native export at 0.5×/1×/2×/4×/5.12×/7.2×/27×: artwork pixels, full output coverage, unscaled layout measurements and output limits');
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
