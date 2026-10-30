/**
 * Publish a project's built web app to the Verynize cloud (desktop main process).
 * ===============================================================================
 * Plain Node (no Electron imports) so tests drive it against local workerd.
 *
 *   detect(root)                     -> {name, command, packageManager, outputDir, hasBuild}
 *   build(root, {command?, timeoutMs?}) -> {code, log}  runs the project's own build script
 *   collect(dir)                     -> [{path, size, sha256, bytes}]  static output files
 *   upload({server, session, name, title, files, note, fetchImpl?}) -> {url, versionUrl, version, files, bytes}
 *   publish({root, server, session, name?, title?, outputDir?, build?}) -> upload result + {log, outputDir}
 *   registerAppPublish(handle, {getProject}) -> IPC: cloudAppDetect, cloudAppPublish
 *
 * Builds run from an argument array (no shell) in the project root. Vite/Vite+ builds receive a
 * relative base so the output works under the per-publication URL.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { childEnv } = require("./dev-server.cjs");

const LOCK_FILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];
const OUTPUT_DIRS = ["dist", "build", "out", "public"];
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_FILES = 3000,
  MAX_FILE = 25 * 1024 * 1024,
  MAX_TOTAL = 100 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SESSION = /^vs_[0-9a-f]{64}$/;

const readJson = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
};
const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};
const slug = (value) =>
  String(value || "app")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "app";

async function detect(root) {
  const pkg = await readJson(path.join(root, "package.json"));
  const scripts = pkg && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const hasBuild = typeof scripts.build === "string" && scripts.build.trim().length > 0;
  let packageManager = /^(npm|pnpm|yarn|bun)@/.exec(pkg?.packageManager || "")?.[1] || null;
  if (!packageManager)
    for (const [file, pm] of LOCK_FILES)
      if (await exists(path.join(root, file))) {
        packageManager = pm;
        break;
      }
  packageManager ||= "npm";
  let command = null;
  if (hasBuild) {
    // Vite builds default to absolute "/" asset URLs; a relative base keeps them inside the app path.
    const vite = /\b(vite|vp)\s+build\b/.test(scripts.build) && !/--base[ =]/.test(scripts.build);
    command = [packageManager, "run", "build"];
    if (vite) command.push(...(packageManager === "yarn" ? [] : ["--"]), "--base=./");
  }
  const configured = typeof pkg?.verynize?.outputDir === "string" ? pkg.verynize.outputDir : null;
  return {
    root,
    name: slug(pkg?.name || path.basename(root)),
    title: String(pkg?.name || path.basename(root)).slice(0, 120),
    hasBuild,
    command,
    packageManager,
    outputDir: configured || (await findOutput(root)),
  };
}

async function findOutput(root) {
  for (const dir of OUTPUT_DIRS) if (await exists(path.join(root, dir, "index.html"))) return dir;
  return null;
}

function contained(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative))
    throw Error("Choose an output folder inside the project");
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep))
    throw Error("Choose an output folder inside the project");
  return full;
}

function build(root, { command, timeoutMs = 10 * 60 * 1000 } = {}) {
  if (
    !Array.isArray(command) ||
    !command.length ||
    !command.every((part) => typeof part === "string" && part.length < 4096)
  )
    return Promise.reject(Error("This project has no build script"));
  return new Promise((resolve, reject) => {
    let log = "";
    const keep = (chunk) => {
      log = (log + chunk.toString()).slice(-20000);
    };
    const child = spawn(command[0], command.slice(1), {
      cwd: root,
      env: childEnv({ CI: "1" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(Error("Build timed out"), { log }));
    }, timeoutMs);
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(Object.assign(Error(`Could not run ${command[0]}: ${error.message}`), { log }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code, log });
      else
        reject(
          Object.assign(
            Error(
              `Build failed (exit ${code}). ${log.trim().split("\n").slice(-3).join(" ")}`.slice(
                0,
                600,
              ),
            ),
            { log },
          ),
        );
    });
  });
}

async function collect(dir) {
  const files = [];
  let total = 0;
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = await fs.readFile(full);
      if (bytes.byteLength > MAX_FILE)
        throw Error(`${path.relative(dir, full)} is larger than 25 MB`);
      total += bytes.byteLength;
      if (files.length >= MAX_FILES || total > MAX_TOTAL)
        throw Error("Build output exceeds 3000 files or 100 MB");
      files.push({
        path: path.relative(dir, full).split(path.sep).join("/"),
        size: bytes.byteLength,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        bytes,
      });
    }
  };
  await walk(dir);
  if (!files.some((file) => file.path === "index.html"))
    throw Error("The build output needs an index.html at its root");
  return files;
}

async function upload({
  server,
  session,
  name,
  title,
  files,
  note,
  fetchImpl = fetch,
  activate = true,
}) {
  const origin = checkServer(server);
  if (!SESSION.test(session || "")) throw Error("Sign in before publishing an app");
  if (!NAME.test(name || "")) throw Error("App names use lowercase letters, numbers and dashes");
  const call = async (route, options = {}) => {
    const response = await fetchImpl(origin + route, {
      ...options,
      headers: {
        "x-verynize-session": session,
        ...(options.body && !(options.body instanceof Uint8Array)
          ? { "content-type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(Error(data.error || `Server returned ${response.status}`), {
        status: response.status,
      });
    return data;
  };
  const { app } = await call("/api/apps", {
    method: "POST",
    body: JSON.stringify({ name, title }),
  });
  const { version } = await call(`/api/apps/${app.id}/versions`, {
    method: "POST",
    body: JSON.stringify({ note: note || "" }),
  });
  const queue = files.slice();
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const route = `/api/apps/${app.id}/versions/${version}/files/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      await call(route, {
        method: "PUT",
        body: new Uint8Array(file.bytes),
        headers: { "content-type": "application/octet-stream" },
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  const manifest = files.map(({ path: file, size, sha256 }) => ({ path: file, size, sha256 }));
  return call(`/api/apps/${app.id}/versions/${version}/finalize`, {
    method: "POST",
    body: JSON.stringify({ files: manifest, activate }),
  });
}

function checkServer(server) {
  const url = new URL(server);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw Error("Use an HTTP or HTTPS server URL");
  return url.origin;
}

async function publish({
  root,
  server,
  session,
  name,
  title,
  outputDir,
  build: runBuild = true,
  note,
  fetchImpl,
}) {
  const info = await detect(root);
  let log = "";
  if (runBuild && info.hasBuild) log = (await build(root, { command: info.command })).log;
  const relative = outputDir || info.outputDir || (await findOutput(root));
  if (!relative)
    throw Error(
      "No build output with an index.html was found (looked in dist, build, out, public)",
    );
  const files = await collect(contained(root, relative));
  const result = await upload({
    server,
    session,
    name: name || info.name,
    title: title || info.title,
    files,
    note,
    fetchImpl,
  });
  return {
    ...result,
    outputDir: relative,
    log: log.slice(-4000),
    built: runBuild && info.hasBuild,
  };
}

function registerAppPublish(handle, { getProject }) {
  const root = () => {
    const project = getProject();
    if (!project) throw Error("Open a project folder first");
    return project.root;
  };
  handle("cloudAppDetect", async () => {
    const info = await detect(root());
    return { ...info, command: info.command ? info.command.join(" ") : null };
  });
  handle("cloudAppPublish", async (options = {}) => {
    if (!options || typeof options !== "object") throw Error("Invalid publish request");
    if (
      options.outputDir !== undefined &&
      (typeof options.outputDir !== "string" || options.outputDir.length > 200)
    )
      throw Error("Invalid output folder");
    const result = await publish({
      root: root(),
      server: options.server,
      session: options.session,
      name: options.name,
      title: options.title,
      outputDir: options.outputDir || undefined,
      build: options.build !== false,
      note: typeof options.note === "string" ? options.note.slice(0, 200) : "",
    });
    return result;
  });
}

module.exports = { detect, build, collect, upload, publish, registerAppPublish };
