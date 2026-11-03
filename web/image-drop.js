"use strict";
// Image files dropped on the canvas (Finder, a browser, the Files app) become image layers, registered on the canvas
// engine of web/canvas-interactions.js through BetterCanvas.extend.
//
// - Each image keeps its natural size, scaled down to MAX_SIDE on its longest side; several files are laid out left to
//   right with a GAP, and the row is centred on the drop point (world coordinates, so zoom and pan don't matter).
// - Dropped on an unlocked frame, the images become its children (positions relative to its content box), as drawing
//   inside a frame does.
// - One undo step for the whole drop; the new layers are selected. The source is embedded as a data: URL, the format
//   web/document-core.js accepts, so the layers persist with the document.
// - .fig and .pen files are left to web/figma-panel.js. Files larger than the shared upload limit
//   or of a type the document can't embed are skipped with a footer message.
(() => {
  const MAX_SIDE = 1600;
  const GAP = 40;
  const DESIGN_FILE = /\.(fig|pen)$/i;
  const r2 = (v) => Math.round(v * 100) / 100;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

  /** Natural size scaled down to fit `max` on its longest side (an SVG without a size reports 0×0: 300×300). */
  function fitSize(width, height, max = MAX_SIDE) {
    const w = width > 0 ? width : 300,
      h = height > 0 ? height : w;
    const scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  function extend(c) {
    const { ed } = c;
    const workspace = document.getElementById("workspace");
    if (!workspace) return;

    /**
     * Insert image layers centred on a world `point`, as children of `frame` (or at the top level). `images` are
     * {name, src, width, height}. Returns the new ids (empty when the edit is refused).
     */
    function insertImages(images, point, frame = null) {
      if (!images.length) return [];
      const sizes = images.map((i) =>
        fitSize(i.originalWidth ?? i.width, i.originalHeight ?? i.height),
      );
      const rowW = sizes.reduce((sum, s) => sum + s.w, 0) + GAP * (sizes.length - 1),
        rowH = Math.max(...sizes.map((s) => s.h));
      let originX = 0,
        originY = 0;
      if (frame) {
        const r = c.worldRect(frame.id),
          border = Number(frame.strokeWidth) || 0;
        if (r) {
          originX = r.x + border;
          originY = r.y + border;
        }
      }
      let x = point.x - rowW / 2 - originX;
      const nodes = images.map((image, i) => {
        const { w, h } = sizes[i];
        const node = {
          ...ed.defaults,
          id: ed.uid(),
          type: "image",
          name: image.name,
          src: image.src,
          color: "transparent",
          text: "",
          x: r2(x),
          y: r2(point.y - originY - rowH / 2 + (rowH - h) / 2),
          w,
          h,
          parentId: frame?.id || null,
        };
        x += w + GAP;
        return node;
      });
      const candidate = structuredClone(ed.design);
      candidate.pages.find((p) => p.id === ed.page().id).nodes.push(...structuredClone(nodes));
      try {
        window.imageUpload.preflight(candidate);
        ed.validate(candidate);
      } catch (error) {
        c.footer("Unable to add image: " + error.message);
        return [];
      }
      ed.checkpoint();
      ed.nodes().push(...nodes);
      ed.setSelection(new Set(nodes.map((n) => n.id)));
      ed.render();
      return nodes.map((n) => n.id);
    }

    async function dropFiles(files, clientX, clientY) {
      try {
        window.imageUpload.batch(files);
      } catch (error) {
        c.footer(error.message);
        return [];
      }
      // Resolved at drop time: panning or zooming while the files are read must not move the target.
      const pageId = ed.page().id,
        point = c.screenToWorld(clientX, clientY),
        frame = c.frameAt(clientX, clientY);
      const skipped = [],
        images = [];
      for (const file of files) {
        try {
          images.push(await window.imageUpload.prepare(file));
        } catch (error) {
          skipped.push(`${file.name}: ${error.message}`);
        }
      }
      // The document may have changed while the files were read: drop onto the same page and a frame that still exists.
      if (ed.page().id !== pageId) return [];
      const ids = insertImages(images, point, frame && c.find(frame.id) ? frame : null);
      if (skipped.length) c.footer("Skipped " + skipped.join(", "));
      return ids;
    }

    workspace.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without it the drop never fires (and Electron would try to open the file)
      e.dataTransfer.dropEffect = "copy";
    });
    workspace.addEventListener("drop", (e) => {
      if (e.defaultPrevented || !hasFiles(e)) return;
      const files = [...e.dataTransfer.files];
      if (!files.length || files.some((f) => DESIGN_FILE.test(f.name))) return; // web/figma-panel.js opens those
      e.preventDefault();
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) {
        c.footer("Drop PNG, JPEG, WebP, GIF or SVG images on the canvas.");
        return;
      }
      const done = dropFiles(files, e.clientX, e.clientY);
      window.imageDrop.lastDrop = done;
    });

    window.imageDrop = { fitSize, insertImages, dropFiles, lastDrop: null };
  }

  window.BetterCanvas?.extend(extend);
})();
