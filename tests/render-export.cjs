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
  const app = await _electron.launch({ args: ['.', `--user-data-dir=${profile}`], env, timeout: 20000 });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector('#canvas');
    for (const scale of [0.5, 1, 2, 4]) {
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
      assert.equal(result.width, 100 * scale, `${scale}× PNG width`);
      assert.equal(result.height, 80 * scale, `${scale}× PNG height`);
      assert.deepEqual(result.leftTop, [255, 0, 0, 255], `${scale}× artwork's left half scales horizontally`);
      assert.deepEqual(result.leftBottom, [255, 0, 0, 255], `${scale}× artwork scales vertically`);
      assert.deepEqual(result.rightTop, [0, 0, 255, 255], `${scale}× right half fills the output`);
      assert.deepEqual(result.rightBottom, [0, 0, 255, 255], `${scale}× lower-right artwork is not empty or clipped`);
      assert.deepEqual(result.boxes.art, { x: 0, y: 0, w: 100, h: 80 }, 'layout boxes stay in document CSS pixels');
      assert.deepEqual(result.boxes.right, { x: 50, y: 0, w: 50, h: 80 }, 'zoom does not leak into measured positions');
    }
    console.log('PASS native export at 0.5×/1×/2×/4×: artwork pixels, full output coverage and unscaled layout measurements');
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
