const { onWindowClosed } = require("./window-cleanup.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { app, safeStorage } = require("electron");
const { pathToFileURL } = require("node:url");
const exec = require("node:util").promisify(execFile);
const agents = require("./agents.cjs");
function registerGeneration(handle, parent) {
  let active = null;
  onWindowClosed(parent, () => {
    active?.cancel();
    imageGenerator.cancel(parent);
  });
  handle("generateVector", async (options) => {
    if (active) throw Error("A vector is already being generated");
    if (
      !options ||
      !["claude", "codex"].includes(options.agent) ||
      typeof options.prompt !== "string" ||
      !options.prompt.trim() ||
      options.prompt.length > 4000
    )
      throw Error("Choose an agent and a prompt under 4000 characters");
    const provider = (await agents.discover()).find((a) => a.id === options.agent && a.available);
    if (!provider) throw Error("Selected agent CLI is not installed");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "better-vector-"));
    try {
      await exec("git", ["init", root]);
      const svg = await new Promise((resolve, reject) => {
        let output = "",
          done = false,
          timer;
        const finish = (error, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          error ? reject(error) : resolve(value);
        };
        active = agents.start(
          provider.path,
          provider.id,
          "Create one original standalone SVG illustration for the following request. Return only the SVG markup, starting with <svg and ending with </svg>. Use a viewBox of 0 0 512 512. Use vector shapes, paths and text only. No external references, images, scripts, foreignObject, event handlers, or tools. Do not read or change any files. Request: " +
            options.prompt,
          root,
          (event) => {
            if (event.type === "stdout") {
              output += event.text;
              if (output.length > 2 * 1024 * 1024) {
                active?.cancel();
                finish(Error("Generated SVG exceeded 2 MB"));
              }
            }
            if (event.type === "error") finish(Error(event.text));
            if (event.type === "exit") {
              if (event.code !== 0) {
                finish(Error("Agent generation failed; check CLI account and permissions"));
                return;
              }
              const match = output.match(/<svg\b[\s\S]*?<\/svg>/i);
              if (!match)
                finish(Error("Agent did not return SVG; try a more specific illustration prompt"));
              else finish(null, match[0]);
            }
          },
        );
        timer = setTimeout(() => {
          active?.cancel();
          finish(Error("Vector generation timed out"));
        }, 90000);
      });
      return { svg };
    } finally {
      active = null;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  handle("cancelGeneration", () => {
    active?.cancel();
    imageGenerator.cancel(parent);
    return true;
  });
  handle("imageProviderGet", () => imageGenerator.get());
  handle("imageProviderSet", (options) => imageGenerator.set(options));
  handle("generateImage", (options) => imageGenerator.generate(options, parent));
}

// One service shared by all windows and MCP. Only ciphertext is persisted.
function createImageGenerator() {
  const settingsFile = () => path.join(app.getPath("userData"), "image-provider.json");
  const sessionKeys = {};
  const imageAborts = new Map();
  const mcpAttempts = [];
  let queue = Promise.resolve();
  const load = () =>
    import(pathToFileURL(path.join(__dirname, "../integrations/image-provider.mjs")).href);
  const secure = () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  async function save(settings) {
    await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
    const temp = settingsFile() + "." + process.pid + ".tmp";
    await fs.writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    await fs.rename(temp, settingsFile());
  }
  async function read() {
    let raw = {};
    try {
      raw = JSON.parse(await fs.readFile(settingsFile(), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        await fs.copyFile(settingsFile(), settingsFile() + ".bak");
      }
    }
    const engine = await load();
    const saved = engine.migrateSettings(raw);
    if (raw?.version !== 2) await save(saved);
    return saved;
  }
  function key(saved, vendor) {
    if (saved.keys[vendor] && secure()) {
      try {
        return safeStorage.decryptString(Buffer.from(saved.keys[vendor], "base64"));
      } catch {
        return "";
      }
    }
    return sessionKeys[vendor] || "";
  }
  async function publicSettings(saved) {
    const engine = await load();
    const keys = Object.fromEntries(
      ["openai", "google", "custom"].map((v) => {
        const hasKey = !!key(saved, v);
        return [
          v,
          { hasKey, keyStorage: hasKey ? (saved.keys[v] ? "keychain" : "session") : "none" },
        ];
      }),
    );
    return {
      defaultProvider: saved.defaultProvider,
      providers: engine.IMAGE_PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        vendor: p.vendor,
        model: p.vendor === "custom" ? saved.custom.model : p.model,
        hasKey: keys[p.vendor].hasKey,
        available:
          keys[p.vendor].hasKey || (p.vendor === "custom" && saved.custom.provider === "http"),
      })),
      keys,
      custom: saved.custom,
      secureStorage: secure(),
      ...saved.custom,
      ...keys.custom,
      configured:
        saved.defaultProvider === "custom" ||
        keys[engine.IMAGE_PROVIDERS.find((p) => p.id === saved.defaultProvider).vendor].hasKey,
    };
  }
  function locked(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }
  return {
    get: () => locked(async () => publicSettings(await read())),
    set: (options = {}) =>
      locked(async () => {
        if (!options || typeof options !== "object") throw Error("Provider settings are required");
        const engine = await load(),
          saved = await read();
        const legacy = Object.fromEntries(
          ["provider", "baseURL", "model", "size"]
            .filter((k) => options[k] !== undefined)
            .map((k) => [k, options[k]]),
        );
        const vendor = options.vendor || "custom";
        if (!["openai", "google", "custom"].includes(vendor)) throw Error("Unknown key vendor");
        if (
          options.defaultProvider &&
          !engine.IMAGE_PROVIDERS.some((p) => p.id === options.defaultProvider)
        )
          throw Error("Unknown image provider");
        if (options.custom || Object.keys(legacy).length) {
          const custom = engine.normalizeSettings({
            ...saved.custom,
            ...options.custom,
            ...legacy,
          });
          if (!["openai", "http"].includes(custom.provider)) throw Error("Invalid custom adapter");
        }
        const next = engine.migrateSettings({
          ...saved,
          defaultProvider:
            options.defaultProvider ??
            (Object.keys(legacy).length ? "custom" : saved.defaultProvider),
          custom: { ...saved.custom, ...options.custom, ...legacy },
        });
        if (
          options.apiKey !== undefined &&
          (typeof options.apiKey !== "string" ||
            options.apiKey.length > 4096 ||
            /\s/.test(options.apiKey))
        )
          throw Error("Invalid API key");
        if (options.clearKey) {
          delete next.keys[vendor];
          delete sessionKeys[vendor];
        }
        if (options.apiKey) {
          if (secure()) {
            next.keys[vendor] = safeStorage.encryptString(options.apiKey).toString("base64");
            delete sessionKeys[vendor];
          } else {
            delete next.keys[vendor];
            sessionKeys[vendor] = options.apiKey;
          }
        }
        await save(next);
        return publicSettings(next);
      }),
    cancel: (caller = "mcp") => imageAborts.get(caller)?.abort(),
    generate: async (options = {}, caller = "mcp") => {
      if (imageAborts.has(caller)) throw Error("An image is already being generated");
      if (caller === "mcp") {
        const now = Date.now();
        while (mcpAttempts.length && mcpAttempts[0] <= now - 3600000) mcpAttempts.shift();
        if (mcpAttempts.length >= 5)
          throw Error("Paid image generation limit reached (5 attempts per hour)");
        mcpAttempts.push(now);
      }
      const imageAbort = new AbortController();
      imageAborts.set(caller, imageAbort);
      const signal = imageAbort.signal;
      try {
        const saved = await locked(read),
          engine = await load();
        const id = options.provider || saved.defaultProvider;
        const entry = engine.IMAGE_PROVIDERS.find((p) => p.id === id);
        if (!entry) throw Error("Unknown image provider");
        // Test-only loopback overrides are never accepted through renderer IPC.
        const overrides = {};
        for (const vendor of ["google", "openai"]) {
          const raw = process.env["VERYNIZE_TEST_IMAGE_" + vendor.toUpperCase() + "_URL"];
          if (raw && !app.isPackaged) {
            const url = new URL(raw);
            if (
              url.protocol !== "http:" ||
              !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
            )
              throw Error("Image test override must be loopback HTTP");
            overrides[vendor] = raw;
          }
        }
        return await engine.generateImage({
          settings: {
            ...engine.providerSettings(saved, id, overrides),
            ...(options.size ? { size: options.size } : {}),
          },
          apiKey: key(saved, entry.vendor),
          prompt: options.prompt,
          signal,
        });
      } finally {
        imageAborts.delete(caller);
      }
    },
  };
}
const imageGenerator = createImageGenerator();
module.exports = { registerGeneration, imageGenerator };
