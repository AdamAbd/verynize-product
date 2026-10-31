// Vite plugin that lets the TanStack Start web app reuse the desktop renderer without forking it.
//
// - `virtual:verynize/legacy-shell` is generated from web/index.html: its stylesheets, body markup
//   and scripts in document order. The editor routes boot exactly that page client-side
//   (web-start/src/legacy/boot.ts), so editing web/index.html changes desktop and web together.
// - Static files come from web/ through an allowlist: everything except web/src (sources),
//   web/index.html (Start renders the document) and desktop-only pages. Served by a dev middleware
//   and emitted into the client build, replacing the old `publicDir: "web"`.
import fs from "node:fs";
import path from "node:path";

const VIRTUAL_ID = "virtual:verynize/legacy-shell";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

/**
 * Paths under web/ that are never published to the browser deployment. web/dist only ships the
 * combined bundle (single-island development builds stay local).
 */
const EXCLUDED = [
  /^src\//,
  /^index\.html$/,
  /^storage-migration\.html$/,
  /^dist\/(?!ui\.(js|css)$)/,
  /(^|\/)\./,
  /\.md$/,
];

export function isPublicWebFile(relative) {
  return !EXCLUDED.some((pattern) => pattern.test(relative));
}

/** Every publishable file under `webDir`, as posix paths relative to it. */
export function publicWebFiles(webDir) {
  return fs
    .readdirSync(webDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(webDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .filter(isPublicWebFile)
    .sort();
}

const attributes = (source) =>
  Object.fromEntries(
    [...source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((m) => [
      m[1].toLowerCase(),
      m[2] ?? m[3] ?? m[4] ?? "",
    ]),
  );

/**
 * Split web/index.html into the parts the client boot needs. Scripts are collected from the whole
 * document in order (a script added to <head> still runs before the body scripts).
 */
export function parseLegacyShell(html) {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error("web/index.html has no <body>");
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attributes(match[1]);
    scripts.push(attrs.src ? { attrs } : { attrs, text: match[2] });
  }
  const styles = [];
  for (const match of head.matchAll(/<link\b([^>]*)>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (match[2] !== undefined) styles.push({ text: match[2] });
    else {
      const attrs = attributes(match[1]);
      if (attrs.rel === "stylesheet" && attrs.href) styles.push({ href: attrs.href });
    }
  }
  return {
    title: head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim() ?? "",
    styles,
    bodyAttributes: attributes(bodyMatch[1]),
    bodyHtml: bodyMatch[2].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""),
    scripts,
  };
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".html": "text/html; charset=utf-8",
};

export function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** @param {{ webDir: string }} options */
export function legacyWeb({ webDir }) {
  const indexHtml = path.join(webDir, "index.html");
  return {
    name: "verynize:legacy-web",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      this.addWatchFile(indexHtml);
      return `export default ${JSON.stringify(parseLegacyShell(fs.readFileSync(indexHtml, "utf8")))};`;
    },
    configureServer(server) {
      server.watcher.add(indexHtml);
      server.watcher.on("change", (file) => {
        if (path.resolve(file) !== indexHtml) return;
        for (const environment of Object.values(server.environments)) {
          const module = environment.moduleGraph.getModuleById(RESOLVED_ID);
          if (module) environment.moduleGraph.invalidateModule(module);
        }
      });
      // Serve allowlisted web/ files before Start's request handler sees the request.
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        let relative;
        try {
          relative = decodeURIComponent(new URL(req.url, "http://local").pathname).slice(1);
        } catch {
          return next();
        }
        const file = path.join(webDir, relative);
        if (!relative || !file.startsWith(webDir + path.sep) || !isPublicWebFile(relative))
          return next();
        fs.stat(file, (error, stat) => {
          if (error || !stat.isFile()) return next();
          res.setHeader("content-type", contentType(file));
          res.setHeader("content-length", stat.size);
          res.setHeader("cache-control", "no-cache");
          if (req.method === "HEAD") return res.end();
          fs.createReadStream(file).pipe(res);
        });
      });
    },
    buildStart() {
      if (this.environment?.name !== "client") return;
      if (!fs.existsSync(path.join(webDir, "dist", "ui.js")))
        this.warn("web/dist/ui.js is missing: run `npm run build:ui` before building the web app.");
    },
    generateBundle() {
      if (this.environment?.name !== "client") return;
      for (const fileName of publicWebFiles(webDir))
        this.emitFile({
          type: "asset",
          fileName,
          source: fs.readFileSync(path.join(webDir, fileName)),
        });
    },
  };
}
