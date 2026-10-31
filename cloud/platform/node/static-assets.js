// Static web assets on Node: what the ASSETS binding serves on Cloudflare. Files come from web/
// (web/src, the bundles' sources, is never served). Like the Worker's
// `notFoundHandling: "single-page-application"`, paths without a file answer index.html so the
// app's client routes load. `match` finds a file only; `fetch` (the env.ASSETS binding) adds the
// SPA fallback and a 404.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

export function createStaticAssets(root, { exclude = ["src"] } = {}) {
  const base = path.resolve(root);
  const excluded = exclude.map((dir) => path.join(base, dir));

  /** The file for a URL path, or null (never outside root or inside an excluded directory). */
  function resolve(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const candidates = decoded.endsWith("/")
      ? [path.join(decoded, "index.html")]
      : [decoded, `${decoded}.html`, path.join(decoded, "index.html")];
    for (const candidate of candidates) {
      const file = path.join(base, path.normalize(candidate));
      if (file !== base && !file.startsWith(base + path.sep)) continue;
      if (excluded.some((dir) => file === dir || file.startsWith(dir + path.sep))) continue;
      if (path.basename(file).startsWith(".")) continue;
      try {
        const stat = fs.statSync(file);
        if (stat.isFile()) return { file, stat };
      } catch {}
    }
    return null;
  }

  function serve(request, found, status = 200) {
    const etag = `"${found.stat.size.toString(16)}-${Math.floor(found.stat.mtimeMs).toString(16)}"`;
    const headers = new Headers({
      "content-type":
        TYPES[path.extname(found.file).slice(1).toLowerCase()] || "application/octet-stream",
      "cache-control": "public, max-age=0, must-revalidate",
      etag,
      "x-content-type-options": "nosniff",
    });
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    headers.set("content-length", String(found.stat.size));
    const body = request.method === "HEAD" ? null : Readable.toWeb(fs.createReadStream(found.file));
    return new Response(body, { status, headers });
  }

  return {
    async match(request) {
      if (!["GET", "HEAD"].includes(request.method)) return null;
      const found = resolve(new URL(request.url).pathname);
      return found ? serve(request, found) : null;
    },
    async fetch(request) {
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", { status: 405 });
      const found = resolve(new URL(request.url).pathname) || resolve("/index.html");
      return found ? serve(request, found) : new Response("Not found", { status: 404 });
    },
  };
}
