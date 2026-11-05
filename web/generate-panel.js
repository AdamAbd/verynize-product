(() => {
  // Generate dialog: agent-authored SVG illustrations (installed Codex/Claude CLI) or photographic images
  // from a configured image model provider (desktop/generate.cjs, integrations/image-provider.mjs).
  const host = document.createElement("section");
  host.innerHTML = `<dialog id="generate-dialog"><header><strong>Generate image</strong><button id="generate-close">Close</button></header>
<label>Engine<select id="generate-engine"><option value="vector">Local agent · vector illustration</option><option value="image">Image model · photographic</option></select></label>
<p id="generate-engine-note">Uses your installed local agent and its existing account to create an SVG illustration.</p>
<label data-engine="vector">Agent<select id="generate-agent"><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
<fieldset id="generate-image-settings" data-engine="image" hidden><legend>Image provider</legend>
<label>Image model<select id="generate-image-provider"><option value="custom">Custom endpoint</option></select></label>
<div id="generate-custom-settings">
<label>Provider<select id="image-provider"><option value="openai">OpenAI-compatible images API</option><option value="http">Generic HTTP endpoint</option></select></label>
<label>Base URL<input id="image-base-url" type="url" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false"></label>
<label>Model<input id="image-model" placeholder="gpt-image-2" autocomplete="off" spellcheck="false"></label>
<label>Size<select id="image-size"><option value="1024x1024">1024 × 1024</option><option value="1536x1024">1536 × 1024 landscape</option><option value="1024x1536">1024 × 1536 portrait</option></select></label>
<label>API key<input id="image-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Not set"></label>
<p id="image-key-state"></p>
<div><button id="image-save" type="button">Save provider</button><button id="image-clear-key" type="button">Remove key</button></div>
</div>
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
        ? "Uses the selected image provider. Fills a selected rectangle or frame, or inserts an image in view. Manage vendor keys in Settings → Import & generation."
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
  let catalog = [];
  const customSelected = () =>
    !catalog.length ||
    catalog.find((p) => p.id === $("generate-image-provider").value)?.vendor === "custom";
  function showProvider() {
    $("generate-custom-settings").hidden = !customSelected();
  }
  $("generate-image-provider").onchange = showProvider;
  async function loadSettings() {
    if (!window.verynizePlatform.can("imageGeneration")) return;
    $("generate-run").disabled = true;
    $("generate-image-settings").disabled = true;
    try {
      const snapshot = await window.verynizePlatform.desktop.imageProvider.get();
      catalog = snapshot.providers || [];
      const options = catalog.length ? catalog : [{ id: "custom", label: "Custom endpoint" }];
      $("generate-image-provider").replaceChildren(
        ...options.map((p) => new Option(p.label, p.id)),
      );
      $("generate-image-provider").value = snapshot.defaultProvider || "custom";
      showProvider();
      const settings = { ...snapshot, ...snapshot.custom, ...snapshot.keys?.custom };
      $("image-provider").value = settings.provider;
      $("image-model").value = settings.model;
      $("image-size").value = settings.size;
      $("image-base-url").value =
        snapshot.custom || settings.configured || settings.provider === "openai"
          ? settings.baseURL
          : "";
      keyState(settings);
    } catch (e) {
      status(e.message);
    } finally {
      $("generate-run").disabled = false;
      $("generate-image-settings").disabled = false;
    }
  }
  async function saveSettings() {
    const key = $("image-api-key").value.trim();
    const custom = {
      provider: $("image-provider").value,
      baseURL: $("image-base-url").value,
      model: $("image-model").value,
      size: $("image-size").value,
    };
    $("image-api-key").value = "";
    const settings = await window.verynizePlatform.desktop.imageProvider.set({
      ...(catalog.length ? { vendor: "custom", custom } : custom),
      ...(key ? { apiKey: key } : {}),
    });
    keyState({ ...settings, ...settings.keys?.custom });
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
      const settings = await window.verynizePlatform.desktop.imageProvider.set({
        clearKey: true,
        ...(catalog.length ? { vendor: "custom" } : {}),
      });
      keyState({ ...settings, ...settings.keys?.custom });
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
  async function insertImage(name, src, fillTarget = false) {
    const blob = await (await fetch(src)).blob();
    const image = await window.imageUpload.prepare(blob);
    const design = window.design;
    const doc = design.getDocument();
    const selection = design.getSelection();
    const target =
      selection.length === 1 &&
      doc.pages.find((p) => p.id === doc.activePage).nodes.find((n) => n.id === selection[0]);
    if (fillTarget && target && window.VerynizeDocument.IMAGE_FILL_TYPES.includes(target.type)) {
      design.updateNodes([target.id], {
        fills: [
          {
            type: "image",
            src: image.src,
            fit: "cover",
            imageWidth: image.pixelWidth,
            imageHeight: image.pixelHeight,
          },
        ],
      });
      return;
    }
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale)),
      h = Math.max(1, Math.round(image.height * scale));
    const rect = $("canvas-wrap").getBoundingClientRect();
    const center = design.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    design.addNode("image", {
      name: name.slice(0, 60),
      src: image.src,
      w,
      h,
      x: center.x - w / 2,
      y: center.y - h / 2,
      parentId: null,
    });
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
    await insertImage(prompt, src);
    return "Illustration inserted";
  }
  async function generatePhoto(prompt) {
    if (customSelected() && ($("image-api-key").value || $("image-base-url").value))
      await saveSettings();
    const result = await window.desktop.imageProvider.generate({
      prompt,
      ...(catalog.length ? { provider: $("generate-image-provider").value } : {}),
      ...(customSelected() ? { size: $("image-size").value } : {}),
    });
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(result.src))
      throw Error("Provider returned an unsupported image");
    await insertImage(prompt, result.src, true);
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
