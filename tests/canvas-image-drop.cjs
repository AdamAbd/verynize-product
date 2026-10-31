// Electron: image files dropped on the canvas become image layers centred on the drop point (world coordinates under
// zoom and pan), at their natural size (scaled down to 1600 px on the longest side), inside the frame under the
// pointer, selected, one undo step for the whole drop, and persisted. Unsupported files are refused, .fig drops are
// still left to the Figma importer, and an image on the system clipboard pastes as an image layer (web/image-drop.js).
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");

(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/verynize-image-drop-`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");

    const nodes = () =>
      page.evaluate(() => {
        const d = window.design.getDocument();
        return d.pages.find((p) => p.id === d.activePage).nodes;
      });
    const images = async () => (await nodes()).filter((n) => n.type === "image");
    const footer = () =>
      page.evaluate(
        () =>
          (document.querySelector("#workspace footer") || document.querySelector("footer"))
            ?.textContent || "",
      );

    // An empty page with one frame, then a zoomed and panned camera.
    const frameId = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages.find((p) => p.id === d.activePage).nodes = [];
      window.design.loadDocument(d);
      window.design.setSelection([]);
      return window.design.addNode("frame", {
        name: "Drop target",
        x: 400,
        y: 100,
        w: 600,
        h: 400,
        parentId: null,
        strokeWidth: 0,
      });
    });
    await page.evaluate(() => {
      window.design.setSelection([]);
      window.design.setCamera(80, 60, 0.5);
    });

    // Dispatch a real dragover + drop carrying image Files (PNGs encoded by the renderer's own canvas) on whatever
    // element is under the client point, as a drag from Finder would.
    const drop = (files, clientX, clientY) =>
      page.evaluate(
        async ({ files, clientX, clientY }) => {
          const dt = new DataTransfer();
          for (const f of files) {
            if (f.text !== undefined) {
              dt.items.add(new File([f.text], f.name, { type: f.type }));
              continue;
            }
            const canvas = document.createElement("canvas");
            canvas.width = f.width;
            canvas.height = f.height;
            const g = canvas.getContext("2d");
            g.fillStyle = f.color;
            g.fillRect(0, 0, f.width, f.height);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
            dt.items.add(new File([blob], f.name, { type: "image/png" }));
          }
          const target = document.elementFromPoint(clientX, clientY);
          const init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX, clientY };
          const over = new DragEvent("dragover", init);
          target.dispatchEvent(over);
          const dropped = new DragEvent("drop", init);
          if (window.imageDrop) window.imageDrop.lastDrop = null;
          target.dispatchEvent(dropped);
          const ids = await window.imageDrop?.lastDrop;
          return {
            overPrevented: over.defaultPrevented,
            dropPrevented: dropped.defaultPrevented,
            ids,
            onCanvas: !!target.closest("#workspace"),
          };
        },
        { files, clientX, clientY },
      );

    // 1. One image on empty canvas, away from the frame.
    const wrap = await page.locator("#canvas-wrap").boundingBox();
    const at = { x: Math.round(wrap.x + 120), y: Math.round(wrap.y + 140) };
    const camera = await page.evaluate(() => window.design.getCamera());
    const world = {
      x: (at.x - wrap.x - camera.x) / camera.zoom,
      y: (at.y - wrap.y - camera.y) / camera.zoom,
    };
    const first = await drop(
      [{ name: "photo.png", width: 320, height: 200, color: "#3366ff" }],
      at.x,
      at.y,
    );
    assert.equal(first.onCanvas, true);
    assert.equal(first.overPrevented, true, "dragover must be cancelled for the drop to fire");
    assert.equal(first.dropPrevented, true, "the drop must not fall through to a navigation");
    assert.equal(first.ids.length, 1);
    let list = await images();
    assert.equal(list.length, 1);
    const photo = list[0];
    assert.equal(photo.id, first.ids[0]);
    assert.equal(photo.name, "photo.png");
    assert.equal(photo.parentId, null);
    assert.match(photo.src, /^data:image\/png;base64,/);
    assert.deepEqual([photo.w, photo.h], [320, 200]);
    assert.ok(
      Math.abs(photo.x - (world.x - 160)) < 0.01 && Math.abs(photo.y - (world.y - 100)) < 0.01,
      `centred on the drop point: ${JSON.stringify({ photo: [photo.x, photo.y], world })}`,
    );
    // Rendered on screen: centred under the pointer at 50 %.
    const box = await page.locator(`#canvas [data-id="${photo.id}"]`).boundingBox();
    assert.ok(
      Math.abs(box.x + box.width / 2 - at.x) <= 1 && Math.abs(box.y + box.height / 2 - at.y) <= 1,
      JSON.stringify({ box, at }),
    );
    assert.ok(Math.abs(box.width - 160) <= 1);
    assert.equal(
      await page
        .locator(`#canvas [data-id="${photo.id}"] img`)
        .getAttribute("src")
        .then((s) => s.slice(0, 22)),
      "data:image/png;base64,",
    );
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [photo.id]);

    // Undo removes it in one step; redo brings it back.
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal((await images()).length, 0);
    assert.ok(
      (await nodes()).some((n) => n.id === frameId),
      "undo only removes the drop",
    );
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    assert.equal((await images()).length, 1);

    // 2. Two images (one huge) dropped on the frame at 200 %: children of the frame, one row centred on the pointer.
    await page.evaluate(() => {
      window.design.setSelection([]);
      window.design.setCamera(-300, 40, 2);
    });
    const frameBox = await page.locator(`#canvas [data-id="${frameId}"]`).boundingBox();
    const inFrame = { x: Math.round(frameBox.x + 200), y: Math.round(frameBox.y + 150) };
    const second = await drop(
      [
        { name: "wide.png", width: 4000, height: 1000, color: "#ff3366" },
        { name: "small.png", width: 100, height: 60, color: "#33aa66" },
      ],
      inFrame.x,
      inFrame.y,
    );
    assert.equal(second.ids.length, 2);
    list = await images();
    assert.equal(list.length, 3);
    const [wide, small] = second.ids.map((id) => list.find((n) => n.id === id));
    assert.equal(wide.parentId, frameId);
    assert.equal(small.parentId, frameId);
    assert.deepEqual([wide.w, wide.h], [1600, 400], "scaled down to 1600 on the longest side");
    assert.deepEqual([small.w, small.h], [100, 60], "small images keep their natural size");
    // Frame-local coordinates: the pointer is 100×75 world px into the frame; the row is 1600 + 40 + 100 wide.
    const local = { x: (inFrame.x - frameBox.x) / 2, y: (inFrame.y - frameBox.y) / 2 };
    const rowW = 1600 + 40 + 100;
    assert.ok(Math.abs(wide.x - (local.x - rowW / 2)) < 0.01, JSON.stringify({ wide, local }));
    assert.ok(Math.abs(wide.y - (local.y - 200)) < 0.01);
    assert.ok(Math.abs(small.x - (wide.x + 1640)) < 0.01);
    assert.ok(Math.abs(small.y - (local.y - 30)) < 0.01, "shorter images are centred in the row");
    assert.deepEqual(
      (await page.evaluate(() => window.design.getSelection())).sort(),
      [...second.ids].sort(),
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal((await images()).length, 1, "one undo step removes the whole drop");
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    assert.equal((await images()).length, 3);

    // 3. Files the document can't embed are refused without a navigation; a .fig drop is left to the Figma importer.
    const text = await drop([{ name: "notes.txt", type: "text/plain", text: "hello" }], at.x, at.y);
    assert.equal(text.dropPrevented, true);
    assert.equal(text.ids, null);
    assert.match(await footer(), /Drop PNG, JPEG, WebP, GIF or SVG images/);
    const tiff = await drop([{ name: "scan.tiff", type: "image/tiff", text: "II*" }], at.x, at.y);
    assert.deepEqual(tiff.ids, []);
    assert.match(await footer(), /Skipped scan\.tiff \(unsupported format\)/);
    const fig = await drop([{ name: "Broken.fig", type: "", text: "not a fig" }], at.x, at.y);
    assert.equal(fig.ids, null, "image drop ignores .fig files");
    assert.equal(fig.dropPrevented, true, "web/figma-panel.js still takes the .fig drop");
    assert.equal((await images()).length, 3);

    // 4. Persisted with the document.
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    list = await images();
    assert.equal(list.length, 3);
    const reloaded = list.find((n) => n.id === photo.id);
    assert.deepEqual(
      [reloaded.x, reloaded.y, reloaded.w, reloaded.h, reloaded.src],
      [photo.x, photo.y, photo.w, photo.h, photo.src],
    );
    assert.equal(list.find((n) => n.id === wide.id).parentId, frameId);
    assert.equal(await page.locator(`#canvas [data-id="${photo.id}"] img`).count(), 1);

    // 5. An image on the real system clipboard pastes as an image layer (⌘V on the canvas).
    await app.evaluate(({ clipboard, nativeImage }) => {
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsHnCE/4dgAw4mvRvpvpExGKxWCwWi8VisVj8N15JsXjqNugkJgAAAABJRU5ErkJggg==";
      clipboard.clear();
      clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png, "base64")));
    });
    await page.evaluate(() => window.design.setSelection([]));
    await page.locator("#workspace").click({ position: { x: 40, y: 300 } });
    await page.keyboard.press("Meta+V");
    await page.waitForFunction(
      () => {
        const d = window.design.getDocument();
        return (
          d.pages.find((p) => p.id === d.activePage).nodes.filter((n) => n.type === "image")
            .length === 4
        );
      },
      null,
      { timeout: 10000 },
    );
    const pasted = (await images()).find((n) => ![photo.id, wide.id, small.id].includes(n.id));
    assert.match(pasted.src, /^data:image\/png;base64,/);
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [pasted.id]);

    console.log("canvas image drop: ok");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
