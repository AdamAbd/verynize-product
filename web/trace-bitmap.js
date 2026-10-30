(() => {
  // Raster → vector tracing with smooth curves.
  //  1. Downscale to at most `detail` px and quantise to a small palette (minor colours, e.g.
  //     anti-aliasing fringes, merge into their nearest major colour).
  //  2. Contour tracing: every colour region's boundary is followed along pixel edges into closed loops
  //     (outer boundaries and holes, filled even-odd).
  //  3. Staircase removal: loops become run midpoints, keeping the true pixel corners of long straight
  //     runs; Ramer–Douglas–Peucker simplification finds further sharp corners (polygon vertices).
  //  4. Each corner-to-corner stretch is a line when RDP collapses it to one segment, otherwise it is
  //     fitted with cubic Béziers (least-squares, Newton reparameterisation, split at the worst point).
  const round = (v) => Math.round(v * 100) / 100;
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const len = (a) => Math.hypot(a.x, a.y);
  const unit = (a) => {
    const l = len(a);
    return l ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
  };

  function quantize(pixels, width, height, maxColors = 16) {
    const buckets = new Map(),
      keys = new Int32Array(width * height);
    let opaque = 0;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      if (pixels[o + 3] < 128) {
        keys[i] = -1;
        continue;
      }
      opaque++;
      const key = ((pixels[o] >> 4) << 8) | ((pixels[o + 1] >> 4) << 4) | (pixels[o + 2] >> 4);
      keys[i] = key;
      const b = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      b.r += pixels[o];
      b.g += pixels[o + 1];
      b.b += pixels[o + 2];
      b.count++;
      buckets.set(key, b);
    }
    // Palette colours are buckets that form solid areas: count pixels whose four neighbours share the
    // bucket (anti-aliased edge pixels rarely do), and skip buckets within a small distance of a colour
    // already chosen (one colour split across a bucket boundary).
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x,
          key = keys[i];
        if (
          key >= 0 &&
          keys[i - 1] === key &&
          keys[i + 1] === key &&
          keys[i - width] === key &&
          keys[i + width] === key
        )
          buckets.get(key).interior = (buckets.get(key).interior || 0) + 1;
      }
    const score = (b) => (b.interior || 0) + (width < 8 || height < 8 ? b.count : 0);
    const ranked = [...buckets.entries()].sort(
      (a, b) => score(b[1]) - score(a[1]) || b[1].count - a[1].count,
    );
    const minimum = Math.max(3, opaque * 0.002),
      mean = (b) => [b.r / b.count, b.g / b.count, b.b / b.count];
    const kept = [];
    for (const entry of ranked) {
      if (kept.length >= maxColors) break;
      const [, b] = entry,
        c = mean(b);
      if (kept.length >= 1 && score(b) < minimum) continue;
      if (
        kept.some(([, k]) => {
          const m = mean(k);
          return (m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2 + (m[2] - c[2]) ** 2 < 24 ** 2;
        })
      )
        continue;
      kept.push(entry);
    }
    if (!kept.length && ranked.length) kept.push(ranked[0]);
    const palette = kept.map(([, b]) => {
      const r = Math.round(b.r / b.count),
        g = Math.round(b.g / b.count),
        bl = Math.round(b.b / b.count);
      return {
        r,
        g,
        b: bl,
        hex: "#" + [r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join(""),
        count: 0,
      };
    });
    const index = new Map(kept.map(([key], i) => [key, i]));
    const nearest = new Map();
    const labels = new Int16Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const key = keys[i];
      if (key < 0) {
        labels[i] = -1;
        continue;
      }
      let label = index.get(key);
      if (label === undefined) {
        label = nearest.get(key);
        if (label === undefined) {
          const b = buckets.get(key),
            r = b.r / b.count,
            g = b.g / b.count,
            bl = b.b / b.count;
          let best = 0,
            distance = Infinity;
          palette.forEach((p, j) => {
            const d = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - bl) ** 2;
            if (d < distance) {
              distance = d;
              best = j;
            }
          });
          nearest.set(key, (label = best));
        }
      }
      labels[i] = label;
      palette[label].count++;
    }
    return { labels, palette, opaque };
  }

  // Closed boundary loops (pixel-corner vertices) of every region with `label`. Edges are oriented
  // clockwise around the region; at a vertex where two diagonal pixels meet, the walk turns right so
  // diagonal neighbours stay separate loops.
  function traceLoops(labels, width, height, label) {
    const W = width + 1,
      out = new Map();
    const at = (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? labels[y * width + x] : -1);
    const edge = (x0, y0, x1, y1) => {
      const key = y0 * W + x0;
      (out.get(key) || out.set(key, []).get(key)).push({ x0, y0, x1, y1, used: false });
    };
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (labels[y * width + x] !== label) continue;
        if (at(x, y - 1) !== label) edge(x, y, x + 1, y);
        if (at(x + 1, y) !== label) edge(x + 1, y, x + 1, y + 1);
        if (at(x, y + 1) !== label) edge(x + 1, y + 1, x, y + 1);
        if (at(x - 1, y) !== label) edge(x, y + 1, x, y);
      }
    const loops = [];
    for (const list of out.values())
      for (const first of list) {
        if (first.used) continue;
        const loop = [];
        let e = first;
        while (e && !e.used) {
          e.used = true;
          loop.push({ x: e.x0, y: e.y0 });
          const options = (out.get(e.y1 * W + e.x1) || []).filter((n) => !n.used);
          if (options.length > 1) {
            const dx = e.x1 - e.x0,
              dy = e.y1 - e.y0;
            options.sort((a, b) => cross(dx, dy, b) - cross(dx, dy, a));
          }
          e = options[0];
        }
        if (loop.length >= 4) loops.push(loop);
      }
    return loops;
  }
  const cross = (dx, dy, n) => dx * (n.y1 - n.y0) - dy * (n.x1 - n.x0); // > 0: right turn in y-down space

  const area = (loop) => {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i],
        q = loop[(i + 1) % loop.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  };

  // Staircase-free points: one point per straight run (its midpoint), plus the exact pixel corner
  // where two runs of at least `cornerRun` px meet (rectangle corners stay sharp).
  function runPoints(loop, cornerRun = 3) {
    const n = loop.length,
      turns = [];
    for (let i = 0; i < n; i++) {
      const p = loop[(i - 1 + n) % n],
        c = loop[i],
        q = loop[(i + 1) % n];
      if (c.x - p.x !== q.x - c.x || c.y - p.y !== q.y - c.y) turns.push(i);
    }
    const points = [],
      m = turns.length;
    for (let k = 0; k < m; k++) {
      const a = turns[k],
        b = turns[(k + 1) % m],
        c = turns[(k + 2) % m];
      const runAB = (b - a + n) % n || n,
        runBC = (c - b + n) % n || n;
      const pa = loop[a],
        pb = loop[b];
      points.push({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, corner: false });
      if (runAB >= cornerRun && runBC >= cornerRun) points.push({ x: pb.x, y: pb.y, corner: true });
    }
    return points;
  }

  function rdp(points, epsilon) {
    if (points.length < 3) return points.map((_, i) => i);
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      const a = points[first],
        b = points[last],
        ab = sub(b, a),
        l = len(ab);
      let index = -1,
        max = epsilon;
      for (let i = first + 1; i < last; i++) {
        const d = l
          ? Math.abs(ab.x * (a.y - points[i].y) - ab.y * (a.x - points[i].x)) / l
          : len(sub(points[i], a));
        if (d > max) {
          max = d;
          index = i;
        }
      }
      if (index > 0) {
        keep[index] = 1;
        stack.push([first, index], [index, last]);
      }
    }
    return [...keep.keys()].filter((i) => keep[i]);
  }

  // Cubic Bézier fitting of an ordered point list (Schneider's algorithm).
  const bezier = (c, t) => {
    const s = 1 - t;
    return add(
      add(mul(c[0], s * s * s), mul(c[1], 3 * s * s * t)),
      add(mul(c[2], 3 * s * t * t), mul(c[3], t * t * t)),
    );
  };
  const bezierD1 = (c, t) => {
    const s = 1 - t;
    return add(
      add(mul(sub(c[1], c[0]), 3 * s * s), mul(sub(c[2], c[1]), 6 * s * t)),
      mul(sub(c[3], c[2]), 3 * t * t),
    );
  };
  const bezierD2 = (c, t) =>
    add(
      mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)),
      mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t),
    );
  function chordParams(points) {
    const u = [0];
    for (let i = 1; i < points.length; i++) u.push(u[i - 1] + len(sub(points[i], points[i - 1])));
    const total = u[u.length - 1] || 1;
    return u.map((v) => v / total);
  }
  function generate(points, u, t1, t2) {
    const p0 = points[0],
      p3 = points[points.length - 1];
    let c00 = 0,
      c01 = 0,
      c11 = 0,
      x0 = 0,
      x1 = 0;
    for (let i = 0; i < points.length; i++) {
      const t = u[i],
        s = 1 - t,
        b0 = s * s * s,
        b1 = 3 * s * s * t,
        b2 = 3 * s * t * t,
        b3 = t * t * t;
      const a1 = mul(t1, b1),
        a2 = mul(t2, b2);
      c00 += dot(a1, a1);
      c01 += dot(a1, a2);
      c11 += dot(a2, a2);
      const tmp = sub(points[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
      x0 += dot(a1, tmp);
      x1 += dot(a2, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let alpha1 = det ? (x0 * c11 - x1 * c01) / det : 0,
      alpha2 = det ? (c00 * x1 - c01 * x0) / det : 0;
    const segment = len(sub(p3, p0)),
      epsilon = 1e-6 * segment;
    if (alpha1 < epsilon || alpha2 < epsilon) alpha1 = alpha2 = segment / 3;
    return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3];
  }
  function maxError(points, curve, u) {
    let max = 0,
      split = Math.floor(points.length / 2);
    for (let i = 1; i < points.length - 1; i++) {
      const d = len(sub(bezier(curve, u[i]), points[i])) ** 2;
      if (d >= max) {
        max = d;
        split = i;
      }
    }
    return { max, split };
  }
  function reparameterize(points, curve, u) {
    return u.map((t, i) => {
      const d = sub(bezier(curve, t), points[i]),
        d1 = bezierD1(curve, t),
        d2 = bezierD2(curve, t);
      const denominator = dot(d1, d1) + dot(d, d2);
      return denominator ? Math.min(1, Math.max(0, t - dot(d, d1) / denominator)) : t;
    });
  }
  function fitCubic(points, t1, t2, error, out, depth = 0) {
    if (points.length === 2) {
      const d = len(sub(points[1], points[0])) / 3;
      out.push([points[0], add(points[0], mul(t1, d)), add(points[1], mul(t2, d)), points[1]]);
      return;
    }
    let u = chordParams(points),
      curve = generate(points, u, t1, t2),
      result = maxError(points, curve, u);
    if (result.max < error) {
      out.push(curve);
      return;
    }
    if (result.max < error * 4) {
      for (let i = 0; i < 6; i++) {
        u = reparameterize(points, curve, u);
        curve = generate(points, u, t1, t2);
        result = maxError(points, curve, u);
        if (result.max < error) {
          out.push(curve);
          return;
        }
      }
    }
    if (depth > 24) {
      out.push(curve);
      return;
    }
    const split = Math.min(points.length - 2, Math.max(1, result.split));
    let center = unit(sub(points[split - 1], points[split + 1]));
    if (!center.x && !center.y) center = unit(sub(points[split - 1], points[split]));
    fitCubic(points.slice(0, split + 1), t1, center, error, out, depth + 1);
    fitCubic(points.slice(split), mul(center, -1), t2, error, out, depth + 1);
  }
  const tangentAt = (points, i, direction, reach = 3) => {
    let sum = { x: 0, y: 0 };
    for (let k = 1; k <= reach && i + k * direction >= 0 && i + k * direction < points.length; k++)
      sum = add(sum, unit(sub(points[i + k * direction], points[i])));
    return unit(sum);
  };

  // One closed loop → SVG path data (absolute commands, viewBox units).
  function loopPath(loop, options) {
    let points = runPoints(loop, options.cornerRun);
    if (points.length < 3) points = loop.map((p) => ({ ...p, corner: true }));
    // RDP vertices with a sharp turn are corners too (polygon vertices at any angle).
    const ring = [...points, points[0]],
      kept = rdp(ring, options.rdpEpsilon).slice(0, -1);
    for (let k = 0; k < kept.length; k++) {
      const prev = ring[kept[(k - 1 + kept.length) % kept.length]],
        here = ring[kept[k]],
        next = ring[kept[(k + 1) % kept.length]];
      const a = sub(here, prev),
        b = sub(next, here);
      if (len(a) < options.cornerSpan || len(b) < options.cornerSpan) continue;
      const turn = (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
      if (turn > options.cornerAngle) points[kept[k]].corner = true;
    }
    const corners = points.map((p, i) => (p.corner ? i : -1)).filter((i) => i >= 0);
    const segments = [];
    const n = points.length;
    if (!corners.length) {
      // Smooth closed curve: start anywhere with a symmetric tangent so the joint stays smooth.
      const closed = [...points, points[0]];
      const t = unit(sub(points[1], points[n - 1]));
      fitCubic(closed, t, mul(t, -1), options.fitError, segments);
    } else {
      for (let k = 0; k < corners.length; k++) {
        const start = corners[k],
          end = corners[(k + 1) % corners.length];
        const chain = [];
        for (let i = start; ; i = (i + 1) % n) {
          chain.push(points[i]);
          if (i === end && chain.length > 1) break;
          if (chain.length > n + 1) break;
        }
        if (chain.length === 2 || rdp(chain, options.lineEpsilon).length === 2) {
          segments.push([chain[0], null, null, chain[chain.length - 1]]);
          continue;
        }
        fitCubic(
          chain,
          tangentAt(chain, 0, 1),
          tangentAt(chain, chain.length - 1, -1),
          options.fitError,
          segments,
        );
      }
    }
    const first = segments[0][0];
    let d = `M${round(first.x)} ${round(first.y)}`;
    for (const [, c1, c2, p] of segments)
      d += c1
        ? `C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p.x)} ${round(p.y)}`
        : `L${round(p.x)} ${round(p.y)}`;
    return d + "Z";
  }

  /** Trace pixels (RGBA) into an SVG document string. */
  function tracePixels(pixels, width, height, options = {}) {
    const settings = {
      cornerRun: 3,
      rdpEpsilon: 1,
      cornerAngle: 60,
      cornerSpan: 1.5,
      lineEpsilon: 0.8,
      fitError: 0.7,
      maxColors: 16,
      ...options,
    };
    const { labels, palette, opaque } = quantize(pixels, width, height, settings.maxColors);
    const order = palette
      .map((p, i) => i)
      .filter((i) => palette[i].count)
      .sort((a, b) => palette[b].count - palette[a].count);
    const layers = [];
    const tiny = Math.max(width, height) >= 48 ? 1.5 : 0;
    order.forEach((label, rank) => {
      const p = palette[label];
      // A colour covering the whole opaque canvas is drawn as the background rectangle (no seams).
      if (rank === 0 && opaque === width * height) {
        layers.push(`<rect width="${width}" height="${height}" fill="${p.hex}"/>`);
        return;
      }
      const loops = traceLoops(labels, width, height, label).filter(
        (loop) => Math.abs(area(loop)) > tiny,
      );
      if (!loops.length) return;
      const d = loops.map((loop) => loopPath(loop, settings)).join("");
      // Later (smaller) layers get a hairline stroke in their own colour to close anti-alias seams.
      layers.push(
        `<path fill="${p.hex}" fill-rule="evenodd"${rank ? ` stroke="${p.hex}" stroke-width="0.35" stroke-linejoin="round"` : ""} d="${d}"/>`,
      );
    });
    return { layers, palette: order.map((i) => palette[i].hex) };
  }

  async function traceBitmap(source, detail = 256, options = {}) {
    if (!/^data:image\/(png|jpeg|webp|gif);/i.test(source))
      throw Error("Select a PNG, JPEG, WebP or GIF layer");
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error("Unable to decode bitmap"));
      image.src = source;
    });
    const scale = Math.min(
      1,
      Math.max(16, Math.min(1024, detail)) / Math.max(image.width, image.height),
    );
    const width = Math.max(1, Math.round(image.width * scale)),
      height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const { layers } = tracePixels(
      context.getImageData(0, 0, width, height).data,
      width,
      height,
      options,
    );
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${image.width}" height="${image.height}">${layers.join("")}</svg>`;
  }
  window.traceBitmap = traceBitmap;
  window.traceBitmap.pixels = tracePixels;
  const button = document.createElement("button");
  button.id = "trace-bitmap";
  button.textContent = "Trace selected bitmap";
  button.style.width = "100%";
  button.style.marginTop = "8px";
  document.getElementById("figma-import").after(button);
  button.onclick = async () => {
    try {
      const id = document.querySelector("#canvas .layer.selected")?.dataset.id,
        doc = window.design.getDocument(),
        node = doc.pages.find((p) => p.id === doc.activePage).nodes.find((n) => n.id === id);
      if (!node || node.type !== "image") throw Error("Select a bitmap image layer first");
      const svg = await traceBitmap(node.src);
      node.src = "data:image/svg+xml;base64," + btoa(svg);
      node.name += " · traced";
      window.design.setDocument(doc);
    } catch (e) {
      alert(e.message);
    }
  };
})();
