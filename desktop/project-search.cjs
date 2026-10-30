// Global search across every registered project (Code workspace repositories).
//
// Source search uses ripgrep: the bundled `@vscode/ripgrep` binary when that package is installed, otherwise
// `rg` on PATH (Homebrew paths included). ripgrep honours .gitignore/.ignore (with --no-require-git, also in
// folders that are not git repositories). Without ripgrep a Node walker does the same job: in a git checkout
// the file list comes from `git ls-files --cached --others --exclude-standard`; elsewhere the root .gitignore
// is applied with a small glob matcher. Both skip .git, binary files and files over 1 MB.
//
// Design search reads `*.verynize.json` documents found in those projects (plus the caller's extra files) and
// matches page names, layer names and text content.
//
//   searchProjects({query, regex, caseSensitive, projects:[{id,name,root}], limit, engine, designFiles})
//     -> {engine:'ripgrep'|'node', results:[{projectId, project, root, path, line, column, preview}],
//         design:[{projectId, project, root, path, pageId, page, nodeId, name, match}], truncated, errors}
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

const MAX_FILE = 1024 * 1024;
const MAX_FILES = 20000;
const DEFAULT_LIMIT = 500;
const SKIP_DIRS = new Set([".git", "node_modules"]);

let cachedRg;
/** The ripgrep binary shipped with the app (`@vscode/ripgrep`, a production dependency), or null. */
async function bundledRipgrep() {
  try {
    const bundled = require("@vscode/ripgrep").rgPath;
    await fs.access(bundled, 1);
    return bundled;
  } catch {
    return null;
  }
}
/** Path of a ripgrep binary, or null: the bundled one first, then `rg` on PATH / Homebrew. */
async function findRipgrep({ env = process.env, bundled = true } = {}) {
  const cacheable = env === process.env && bundled;
  if (cachedRg !== undefined && cacheable) return cachedRg;
  let found = bundled ? await bundledRipgrep() : null;
  if (!found) {
    for (const dir of [
      ...String(env.PATH || "").split(path.delimiter),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
    ]) {
      if (!dir || !path.isAbsolute(dir)) continue;
      const candidate = path.join(dir, process.platform === "win32" ? "rg.exe" : "rg");
      try {
        await fs.access(candidate, 1);
        found = candidate;
        break;
      } catch {}
    }
  }
  if (cacheable) cachedRg = found;
  return found;
}

function validate({ query, regex, caseSensitive, projects, limit }) {
  if (typeof query !== "string" || !query.trim() || query.length > 500 || query.includes("\0"))
    throw Error("Enter text to search for");
  if (regex) {
    try {
      new RegExp(query);
    } catch {
      throw Error("That regular expression is invalid");
    }
  }
  if (!Array.isArray(projects) || projects.length > 100) throw Error("No projects to search");
  for (const p of projects)
    if (!p || typeof p.root !== "string" || !path.isAbsolute(p.root))
      throw Error("Invalid project");
  const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 5000) : DEFAULT_LIMIT;
  return { query, regex: !!regex, caseSensitive: !!caseSensitive, projects, limit: max };
}

function matcher({ query, regex, caseSensitive }) {
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, caseSensitive ? "g" : "gi");
}

const preview = (line) => (line.length > 300 ? line.slice(0, 300) + "…" : line).replace(/\r$/, "");

// --- ripgrep ---------------------------------------------------------------------------------------
function ripgrep(rg, root, options, budget) {
  return new Promise((resolve) => {
    const args = [
      "--json",
      "--no-require-git",
      "--hidden",
      "--glob",
      "!.git",
      "--glob",
      "!node_modules",
      "--glob",
      "!*.verynize.json",
      "--max-filesize",
      "1M",
      "--max-columns",
      "1000",
      "--max-count",
      "50",
    ];
    if (!options.regex) args.push("--fixed-strings");
    if (!options.caseSensitive) args.push("--ignore-case");
    args.push("--regexp", options.query, "--", ".");
    const results = [];
    let buffer = "",
      truncated = false,
      stderr = "";
    const child = spawn(rg, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      truncated = true;
      child.kill("SIGTERM");
    }, 20000);
    const take = (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type !== "match") return;
      const data = msg.data;
      const file = data.path?.text;
      if (typeof file !== "string") return;
      const text = data.lines?.text ?? "";
      const first = data.submatches?.[0];
      const column = first
        ? Buffer.from(text).subarray(0, first.start).toString("utf8").length + 1
        : 1;
      if (results.length >= budget()) {
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      results.push({
        path: file.replace(/^\.\//, "").split(path.sep).join("/"),
        line: data.line_number,
        column,
        preview: preview(text.replace(/\n$/, "")),
      });
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        take(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ results, truncated, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      take(buffer);
      resolve({
        results,
        truncated,
        ...(code === 2 && !results.length ? { error: stderr.trim().split("\n")[0] } : {}),
      });
    });
  });
}

// --- Node fallback ---------------------------------------------------------------------------------
/** Minimal .gitignore matcher: `*`, `**`, `?`, leading `/`, trailing `/`, `!` negation. */
function gitignoreMatcher(text) {
  const rules = [];
  for (let raw of String(text || "").split("\n")) {
    raw = raw.replace(/\r$/, "");
    if (!raw.trim() || raw.startsWith("#")) continue;
    let pattern = raw.trim(),
      negate = false,
      dirOnly = false;
    if (pattern.startsWith("!")) {
      negate = true;
      pattern = pattern.slice(1);
    }
    if (pattern.endsWith("/")) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    pattern = pattern.replace(/^\//, "");
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "*" && pattern[i + 1] === "*") {
        re += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += pattern[i + 2] === "/" ? 2 : 1;
      } else if (c === "*") re += "[^/]*";
      else if (c === "?") re += "[^/]";
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    rules.push({
      re: new RegExp(anchored ? `^${re}(?:/.*)?$` : `(?:^|/)${re}(?:/.*)?$`),
      negate,
      dirOnly,
    });
  }
  return (relative, isDir) => {
    let ignored = false;
    // The walker never descends into an ignored folder, so a `dir/` rule only needs to match folders.
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(relative)) ignored = !rule.negate;
    }
    return ignored;
  };
}

async function listFiles(root) {
  try {
    const { stdout } = await exec(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    );
    const top = (
      await exec("git", ["-C", root, "rev-parse", "--show-toplevel"], { timeout: 10000 })
    ).stdout.trim();
    if (top && (await fs.realpath(top)) === (await fs.realpath(root)))
      return stdout.split("\0").filter(Boolean).slice(0, MAX_FILES);
  } catch {}
  let ignore = () => false;
  try {
    ignore = gitignoreMatcher(await fs.readFile(path.join(root, ".gitignore"), "utf8"));
  } catch {}
  const out = [];
  const walk = async (dir, depth) => {
    if (depth > 20 || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name),
        rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || ignore(rel, true)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && !ignore(rel, false)) out.push(rel);
      if (out.length >= MAX_FILES) return;
    }
  };
  await walk(root, 0);
  return out;
}

async function nodeSearch(root, options, budget) {
  const re = matcher(options),
    results = [];
  let truncated = false;
  for (const file of await listFiles(root)) {
    if (file.split("/").some((part) => SKIP_DIRS.has(part)) || file.endsWith(".verynize.json"))
      continue; // design files: see designMatches
    let data;
    try {
      const full = path.join(root, file);
      const stat = await fs.lstat(full);
      if (!stat.isFile() || stat.size > MAX_FILE) continue;
      data = await fs.readFile(full);
    } catch {
      continue;
    }
    if (data.includes(0)) continue;
    const lines = data.toString("utf8").split("\n");
    let perFile = 0;
    for (let i = 0; i < lines.length && perFile < 50; i++) {
      re.lastIndex = 0;
      const m = re.exec(lines[i]);
      if (!m) continue;
      if (results.length >= budget()) return { results, truncated: true };
      results.push({ path: file, line: i + 1, column: m.index + 1, preview: preview(lines[i]) });
      perFile++;
    }
  }
  return { results, truncated };
}

// --- design documents -------------------------------------------------------------------------------
async function designMatches(file, options, limit) {
  let doc;
  try {
    const stat = await fs.stat(file);
    if (stat.size > 20 * 1024 * 1024) return [];
    doc = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
  if (!doc || !Array.isArray(doc.pages)) return [];
  const re = matcher(options),
    out = [];
  const test = (value) => {
    if (typeof value !== "string" || !value) return null;
    re.lastIndex = 0;
    const m = re.exec(value);
    if (!m) return null;
    const start = Math.max(0, m.index - 40);
    return (start ? "…" : "") + value.slice(start, m.index + m[0].length + 80).replace(/\s+/g, " ");
  };
  for (const page of doc.pages) {
    const pageHit = test(page?.name);
    if (pageHit)
      out.push({
        pageId: page.id,
        page: page.name,
        nodeId: null,
        name: page.name,
        match: pageHit,
        kind: "page",
      });
    for (const node of Array.isArray(page?.nodes) ? page.nodes : []) {
      if (out.length >= limit) return out;
      const hit = test(node?.text) || test(node?.name);
      if (hit)
        out.push({
          pageId: page.id,
          page: page.name,
          nodeId: node.id,
          name: node.name || node.type,
          match: hit,
          kind: test(node?.text) ? "text" : "layer",
        });
    }
  }
  return out;
}

async function searchProjects(input = {}, { ripgrepPath } = {}) {
  const options = validate(input);
  const rg =
    input.engine === "node" ? null : ripgrepPath !== undefined ? ripgrepPath : await findRipgrep();
  const engine = rg ? "ripgrep" : "node";
  const results = [],
    design = [],
    errors = [];
  let truncated = false;
  const budget = () => options.limit - results.length;
  for (const project of options.projects) {
    let root;
    try {
      root = await fs.realpath(project.root);
      if (!(await fs.stat(root)).isDirectory()) throw Error();
    } catch {
      errors.push({ project: project.name || project.root, error: "Folder is missing" });
      continue;
    }
    const tag = {
      projectId: project.id || null,
      project: project.name || path.basename(root),
      root,
    };
    if (budget() > 0) {
      const found = rg
        ? await ripgrep(rg, root, options, budget)
        : await nodeSearch(root, options, budget);
      if (found.error) errors.push({ project: tag.project, error: found.error });
      truncated = truncated || found.truncated;
      for (const r of found.results) results.push({ ...tag, ...r });
    } else truncated = true;
    if (input.designFiles !== false) {
      for (const file of (await listFiles(root))
        .filter((f) => f.endsWith(".verynize.json"))
        .slice(0, 200)) {
        if (design.length >= options.limit) {
          truncated = true;
          break;
        }
        for (const hit of await designMatches(
          path.join(root, file),
          options,
          options.limit - design.length,
        ))
          design.push({ ...tag, path: file, ...hit });
      }
    }
  }
  for (const file of Array.isArray(input.extraDesignFiles)
    ? input.extraDesignFiles.slice(0, 200)
    : []) {
    if (typeof file !== "string" || !path.isAbsolute(file) || !file.endsWith(".verynize.json"))
      continue;
    if (design.some((d) => path.join(d.root, d.path) === file)) continue;
    for (const hit of await designMatches(file, options, options.limit - design.length))
      design.push({
        projectId: null,
        project: "Design files",
        root: path.dirname(file),
        path: path.basename(file),
        ...hit,
      });
  }
  // ripgrep: which binary ran ("bundled" = @vscode/ripgrep, "system" = rg on PATH); null for the Node walker.
  const rgSource = rg ? (/[\\/]@vscode[\\/]ripgrep/.test(rg) ? "bundled" : "system") : null;
  return { engine, ripgrep: rgSource, results, design, truncated, errors };
}

/** IPC: `projectSearch` over registered repositories; `projectSearchOpen` reveals/opens one result. */
function registerProjectSearch(handle, { registry, shell } = {}) {
  handle("projectSearch", async (options = {}) => {
    const projects = (await registry.list()).map((r) => ({ id: r.id, name: r.name, root: r.root }));
    const only = Array.isArray(options.projectIds)
      ? projects.filter((p) => options.projectIds.includes(p.id))
      : projects;
    return searchProjects({ ...options, projects: only });
  });
  handle("projectSearchOpen", async ({ root, path: relative, reveal } = {}) => {
    const resolved = await registry.resolveRoot(root);
    if (
      typeof relative !== "string" ||
      !relative ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((p) => p === ".." || p === "")
    )
      throw Error("Invalid file");
    const target = path.join(resolved.root, relative);
    const real = await fs.realpath(target);
    if (!real.startsWith(resolved.root + path.sep)) throw Error("That file is outside the project");
    if (reveal) {
      shell.showItemInFolder(real);
      return { revealed: true };
    }
    const error = await shell.openPath(real);
    if (error) throw Error(error);
    return { opened: true };
  });
}

module.exports = {
  searchProjects,
  findRipgrep,
  bundledRipgrep,
  gitignoreMatcher,
  listFiles,
  designMatches,
  registerProjectSearch,
};
