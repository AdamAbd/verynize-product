(() => {
  // Generate dialog: agent-authored SVG illustrations (installed Codex/Claude CLI) or photographic images
  // from a configured image model provider (desktop/generate.cjs, integrations/image-provider.mjs).
  const host = document.createElement("section");
  host.innerHTML = `<dialog id="generate-dialog"><header><strong>Generate image</strong><button id="generate-close">Close</button></header>
<label>Engine<select id="generate-engine"><option value="vector">Local agent · vector illustration</option><option value="image">Image model · photographic</option></select></label>
<p id="generate-engine-note">Uses your installed local agent and its existing account to create an SVG illustration.</p>
<label data-engine="vector">Agent<select id="generate-agent"><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
<fieldset id="generate-image-settings" data-engine="image" hidden><legend>Image provider</legend>
<label>Provider<select id="image-provider"><option value="openai">OpenAI-compatible images API</option><option value="http">Generic HTTP endpoint</option></select></label>
<label>Base URL<input id="image-base-url" type="url" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false"></label>
<label>Model<input id="image-model" placeholder="gpt-image-1" autocomplete="off" spellcheck="false"></label>
<label>Size<select id="image-size"><option value="1024x1024">1024 × 1024</option><option value="1536x1024">1536 × 1024 landscape</option><option value="1024x1536">1024 × 1536 portrait</option><option value="512x512">512 × 512</option><option value="256x256">256 × 256</option></select></label>
<label>API key<input id="image-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Not set"></label>
<p id="image-key-state"></p>
<div><button id="image-save" type="button">Save provider</button><button id="image-clear-key" type="button">Remove key</button></div>
</fieldset>
<label>Prompt<textarea id="generate-prompt" maxlength="4000" placeholder="A playful geometric mountain landscape in violet and cream"></textarea></label>
<label data-engine="vector">Insert as<select id="generate-format"><option value="svg">Editable-size SVG image</option><option value="png">PNG image</option></select></label>
<div><button id="generate-run">Generate and insert</button><button id="generate-stop" disabled>Stop</button></div><p id="generate-status" role="status"></p></dialog>`;
  document.body.append(host);
  const $ = (id) => document.getElementById(id),
    button = document.createElement("button");
  button.id = "generate-art";
  button.textContent = "✧ Generate illustration";
  document.querySelector("#image").parentElement.after(button);
  const status = (text) => {
    $("generate-status").textContent = text;
  };
  const engine = () => $("generate-engine").value;
  function showEngine() {
    for (const el of host.querySelectorAll("[data-engine]"))
      el.hidden = el.dataset.engine !== engine();
    $("generate-engine-note").textContent =
      engine() === "image"
        ? "Sends the prompt to the image model provider below and inserts the returned photo as an image layer. The API key is stored in the macOS Keychain and never shown again."
        : "Uses your installed local agent and its existing account to create an SVG illustration.";
  }
  function keyState(settings) {
    $("image-api-key").value = "";
    $("image-api-key").placeholder = settings.hasKey
      ? "Saved — enter a new key to replace it"
      : "Not set";
    $("image-key-state").textContent = settings.hasKey
      ? settings.keyStorage === "keychain"
        ? "API key stored securely in the system keychain."
        : "API key kept for this session only (secure storage unavailable)."
      : settings.provider === "http"
        ? "No API key (optional for generic endpoints)."
        : "No API key saved.";
  }
  async function loadSettings() {
    if (!window.verynizePlatform.can("imageGeneration")) return;
    try {
      const settings = await window.desktop.imageProvider.get();
      $("image-provider").value = settings.provider;
      $("image-model").value = settings.model;
      $("image-size").value = settings.size;
      $("image-base-url").value =
        settings.configured || settings.provider === "openai" ? settings.baseURL : "";
      keyState(settings);
    } catch (e) {
      status(e.message);
    }
  }
  async function saveSettings() {
    const key = $("image-api-key").value;
    const settings = await window.desktop.imageProvider.set({
      provider: $("image-provider").value,
      baseURL: $("image-base-url").value,
      model: $("image-model").value,
      size: $("image-size").value,
      ...(key ? { apiKey: key } : {}),
    });
    keyState(settings);
    return settings;
  }
  button.onclick = () => {
    $("generate-dialog").showModal();
    showEngine();
    void loadSettings();
  };
  $("generate-close").onclick = () => {
    $("image-api-key").value = "";
    $("generate-dialog").close();
  };
  $("generate-dialog").addEventListener("close", () => {
    $("image-api-key").value = "";
  });
  $("generate-engine").onchange = showEngine;
  $("image-provider").onchange = () => {
    if ($("image-provider").value === "openai" && !$("image-base-url").value)
      $("image-base-url").value = "https://api.openai.com/v1";
  };
  $("image-save").onclick = async () => {
    try {
      await saveSettings();
      status("Image provider saved.");
    } catch (e) {
      status(e.message);
    }
  };
  $("image-clear-key").onclick = async () => {
    try {
      keyState(await window.desktop.imageProvider.set({ clearKey: true }));
      status("API key removed.");
    } catch (e) {
      status(e.message);
    }
  };

  function sanitize(source) {
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
    if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg")
      throw Error("Invalid SVG response");
    const allowed = new Set([
      "svg",
      "g",
      "path",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polyline",
      "polygon",
      "text",
      "tspan",
      "defs",
      "linearGradient",
      "radialGradient",
      "stop",
      "clipPath",
      "mask",
      "title",
      "desc",
    ]);
    for (const el of [...parsed.querySelectorAll("*")]) {
      if (!allowed.has(el.localName)) {
        el.remove();
        continue;
      }
      for (const attr of [...el.attributes])
        if (
          /^on/i.test(attr.name) ||
          /href|src/i.test(attr.name) ||
          (/url\(/i.test(attr.value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value))
        )
          el.removeAttribute(attr.name);
    }
    parsed.documentElement.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    parsed.documentElement.setAttribute("width", "512");
    parsed.documentElement.setAttribute("height", "512");
    return new XMLSerializer().serializeToString(parsed.documentElement);
  }
  function insertImage(name, src, width, height) {
    const scale = Math.min(1, 512 / Math.max(width, height));
    const doc = window.design.getDocument(),
      id = crypto.randomUUID();
    doc.pages
      .find((p) => p.id === doc.activePage)
      .nodes.push({
        id,
        type: "image",
        name: name.slice(0, 60),
        x: 80,
        y: 80,
        w: Math.max(1, Math.round(width * scale)),
        h: Math.max(1, Math.round(height * scale)),
        parentId: null,
        src,
        color: "#ffffff",
        fontSize: 24,
        radius: 0,
        text: "",
      });
    window.design.setDocument(doc);
    window.design.setSelection?.([id]);
  }
  async function generateVector(prompt) {
    const result = await window.desktop.generateVector({
      agent: $("generate-agent").value,
      prompt,
    });
    const svg = sanitize(result.svg);
    let src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    if ($("generate-format").value === "png") {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error("Unable to render SVG"));
        image.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      canvas.getContext("2d").drawImage(image, 0, 0);
      src = canvas.toDataURL("image/png");
    }
    insertImage(prompt, src, 512, 512);
    return "Illustration inserted";
  }
  async function generatePhoto(prompt) {
    if ($("image-api-key").value || $("image-base-url").value) await saveSettings();
    const result = await window.desktop.imageProvider.generate({
      prompt,
      size: $("image-size").value,
    });
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(result.src))
      throw Error("Provider returned an unsupported image");
    insertImage(prompt, result.src, result.width, result.height);
    return `Image inserted (${result.width}×${result.height}${result.model ? ", " + result.model : ""})`;
  }
  $("generate-run").onclick = async () => {
    if (!window.verynizePlatform.can("imageGeneration")) {
      status("Open the desktop app to generate images.");
      return;
    }
    const prompt = $("generate-prompt").value.trim();
    if (!prompt) {
      status(
        engine() === "image" ? "Describe the image first." : "Describe an illustration first.",
      );
      return;
    }
    $("generate-run").disabled = true;
    $("generate-stop").disabled = false;
    status("Generating…");
    try {
      status(engine() === "image" ? await generatePhoto(prompt) : await generateVector(prompt));
    } catch (e) {
      status(e.message);
    } finally {
      $("generate-run").disabled = false;
      $("generate-stop").disabled = true;
    }
  };
  $("generate-stop").onclick = () => window.desktop?.cancelGeneration();
  window.sanitizeGeneratedSVG = sanitize;
})();
