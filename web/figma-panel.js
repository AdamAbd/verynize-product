// Figma import panel (Insert › Import Figma, Settings › Connections › Figma).
//   - Paste: copying layers in Figma puts a binary scene into text/html; the canvas paste handler asks
//     window.figmaPaste to convert it (main process) and pastes the result like in-app layers.
//   - File: "Open .fig file…" or dropping a .fig file on the canvas imports it as a new document.
//     .pen files are vendor-encrypted and are refused with an explanation.
//   - Link: REST import with a transient personal access token or the connected Figma account.
//   - Account: OAuth client ID (optional secret, loopback redirect port), Connect / Disconnect.
(() => {
  const host = document.createElement("section");
  host.innerHTML = `<dialog id="figma-dialog" aria-labelledby="figma-title"><header><strong id="figma-title">Import from Figma</strong><button id="figma-close" type="button">Close</button></header>
<p class="figma-hint">Copy layers in Figma, then paste them on the canvas with ⌘V. You can also drop a .fig file on the canvas.</p>
<div class="figma-row"><button id="figma-file" type="button">Open .fig file…</button></div>
<h3>From a link</h3>
<label>Figma design URL<input id="figma-url" type="url" placeholder="https://www.figma.com/design/…?node-id=…"></label>
<label class="figma-check" id="figma-account-choice" hidden style="display:none"><input id="figma-use-account" type="checkbox" checked> Use my connected Figma account</label>
<label id="figma-token-field">Personal access token<input id="figma-token" type="password" autocomplete="off"></label>
<p class="figma-hint">A personal access token needs file_content:read permission. It is used for this request only and is not saved.</p>
<button id="figma-run" type="button">Import into a new document</button>
<h3>Figma account</h3>
<p class="figma-hint">Connect with your own Figma OAuth app. Register <code id="figma-redirect">http://127.0.0.1:47615/figma/callback</code> as its redirect URL.</p>
<label>Client ID<input id="figma-client-id" autocomplete="off" spellcheck="false"></label>
<label>Client secret (only if your app requires one)<input id="figma-client-secret" type="password" autocomplete="off" placeholder="Not saved yet"></label>
<label>Redirect port<input id="figma-port" type="number" min="1024" max="65535" step="1"></label>
<div class="figma-row"><button id="figma-oauth-save" type="button">Save</button><button id="figma-connect" type="button">Connect account</button><button id="figma-disconnect" type="button" hidden style="display:none">Disconnect</button></div>
<p id="figma-account-status" role="status"></p>
<pre id="figma-status" role="status"></pre></dialog>`;
  document.body.append(host);
  const $ = (id) => document.getElementById(id),
    desktop = () => window.desktop;
  // Dialog styles (settings island) outrank [hidden], so hide inline as well.
  const show = (id, visible) => {
    const el = $(id);
    el.hidden = !visible;
    el.style.display = visible ? "" : "none";
  };
  const button = document.createElement("button");
  button.id = "figma-import";
  button.textContent = "Import Figma";
  document.getElementById("generate-art").after(button);
  const report = (title, warnings) => {
    $("figma-status").textContent =
      title +
      "\n" +
      (warnings?.length ? warnings.join("\n") : "Supported properties imported without warnings.");
  };
  const footer = (message) => {
    const f = document.querySelector("#workspace footer") || document.querySelector("footer");
    if (f) f.textContent = message;
  };

  async function openDocument(document) {
    if (window.fileLibrary?.createFromDocument) {
      await window.fileLibrary.createFromDocument(document);
      return true;
    }
    if (
      !window.confirm(
        "Replace the current design with the Figma import? Save current work first if needed.",
      )
    )
      return false;
    await window.documentLifecycle?.prepareSwitch();
    window.design.setDocument(document);
    return true;
  }

  // ---------- account ----------
  let account = null;
  async function refreshAccount() {
    if (!desktop()?.figmaOAuth) {
      $("figma-account-status").textContent = "Open the desktop app to connect a Figma account.";
      return;
    }
    try {
      account = await desktop().figmaOAuth.status();
    } catch (error) {
      $("figma-account-status").textContent = error.message;
      return;
    }
    if (document.activeElement !== $("figma-client-id"))
      $("figma-client-id").value = account.clientId;
    if (document.activeElement !== $("figma-port")) $("figma-port").value = String(account.port);
    $("figma-client-secret").placeholder = account.hasClientSecret ? "Saved securely" : "Not saved";
    $("figma-redirect").textContent = account.redirectUri;
    show("figma-disconnect", account.connected);
    $("figma-connect").textContent = account.connected ? "Reconnect" : "Connect account";
    show("figma-account-choice", account.connected);
    show("figma-token-field", !(account.connected && $("figma-use-account").checked));
    $("figma-account-status").textContent = account.pending
      ? "Waiting for Figma in your browser…"
      : account.connected
        ? `Connected${account.userId ? ` (user ${account.userId})` : ""}.`
        : account.clientId
          ? "Not connected."
          : "Add a client ID to connect.";
  }
  async function saveAccount() {
    const options = {
      clientId: $("figma-client-id").value.trim(),
      port: Number($("figma-port").value) || undefined,
    };
    if ($("figma-client-secret").value) options.clientSecret = $("figma-client-secret").value;
    await desktop().figmaOAuth.configure(options);
    $("figma-client-secret").value = "";
  }
  const busy = (id, fn) => async () => {
    const el = $(id);
    el.disabled = true;
    try {
      await fn();
    } catch (error) {
      $("figma-account-status").textContent = error.message;
    } finally {
      el.disabled = false;
    }
  };
  $("figma-oauth-save").onclick = busy("figma-oauth-save", async () => {
    await saveAccount();
    await refreshAccount();
  });
  $("figma-connect").onclick = busy("figma-connect", async () => {
    await saveAccount();
    $("figma-account-status").textContent = "Waiting for Figma in your browser…";
    await desktop().figmaOAuth.connect();
    await refreshAccount();
  });
  $("figma-disconnect").onclick = busy("figma-disconnect", async () => {
    await desktop().figmaOAuth.disconnect();
    await refreshAccount();
  });
  $("figma-use-account").onchange = () =>
    show("figma-token-field", !(account?.connected && $("figma-use-account").checked));

  // ---------- dialog ----------
  button.onclick = () => {
    $("figma-dialog").showModal();
    refreshAccount();
  };
  $("figma-close").onclick = () => {
    $("figma-token").value = "";
    $("figma-client-secret").value = "";
    desktop()?.figmaOAuth?.cancel();
    $("figma-dialog").close();
  };
  $("figma-run").onclick = async () => {
    if (!desktop()) {
      $("figma-status").textContent = "Open the desktop app to import from Figma.";
      return;
    }
    $("figma-run").disabled = true;
    $("figma-status").textContent = "Importing…";
    try {
      const useAccount = !!account?.connected && $("figma-use-account").checked;
      const result = await desktop().importFigma(
        useAccount
          ? { url: $("figma-url").value, useAccount: true }
          : { url: $("figma-url").value, token: $("figma-token").value },
      );
      if (await openDocument(result.document)) report("Imported.", result.warnings);
      else $("figma-status").textContent = "";
    } catch (error) {
      $("figma-status").textContent = error.message;
    } finally {
      $("figma-token").value = "";
      $("figma-run").disabled = false;
    }
  };
  $("figma-file").onclick = async () => {
    if (!desktop()?.figmaFileOpen) {
      $("figma-status").textContent = "Open the desktop app to import .fig files.";
      return;
    }
    $("figma-file").disabled = true;
    try {
      const result = await desktop().figmaFileOpen();
      if (result && (await openDocument(result.document)))
        report(`Imported ${result.document.name}.`, result.warnings);
    } catch (error) {
      $("figma-status").textContent = error.message;
    } finally {
      $("figma-file").disabled = false;
    }
  };

  // ---------- drop a .fig / .pen file on the canvas ----------
  const FILE = /\.(fig|pen)$/i,
    MAX = 200 * 1024 * 1024;
  const overCanvas = (e) => !!e.target?.closest?.("#workspace");
  window.addEventListener("dragover", (e) => {
    if (
      e.defaultPrevented ||
      !overCanvas(e) ||
      ![...(e.dataTransfer?.types || [])].includes("Files")
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", async (e) => {
    if (e.defaultPrevented || !overCanvas(e)) return;
    const file = [...(e.dataTransfer?.files || [])].find((f) => FILE.test(f.name));
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault(); // never let the window navigate to a dropped file
    if (!file) return;
    if (!desktop()?.figmaFile) {
      footer("Open the desktop app to import Figma files.");
      return;
    }
    if (file.size > MAX) {
      footer("The file exceeds 200 MB.");
      return;
    }
    footer(`Importing ${file.name}…`);
    try {
      const result = await desktop().figmaFile({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (await openDocument(result.document)) {
        footer(
          `Imported ${file.name}${result.warnings.length ? ` · ${result.warnings.length} note${result.warnings.length === 1 ? "" : "s"}` : ""}`,
        );
        window.figmaPaste.lastWarnings = result.warnings;
      }
    } catch (error) {
      footer(error.message);
      window.figmaPaste.lastError = error.message;
    }
  });

  // ---------- clipboard (called by the canvas paste handler) ----------
  window.figmaPaste = {
    lastWarnings: [],
    lastError: "",
    accepts: (html) =>
      typeof html === "string" && html.includes("(figma)") && html.includes("(/figma)"),
    async convert(html) {
      this.lastError = "";
      if (!desktop()?.figmaClipboard) {
        footer("Open the desktop app to paste Figma layers.");
        return null;
      }
      footer("Converting Figma layers…");
      try {
        const { warnings, ...data } = await desktop().figmaClipboard(html);
        this.lastWarnings = warnings;
        footer(
          `Pasted ${data.nodes.length} Figma layer${data.nodes.length === 1 ? "" : "s"}${warnings.length ? ` · ${warnings.length} note${warnings.length === 1 ? "" : "s"}: ${warnings[0]}` : ""}`,
        );
        return data;
      } catch (error) {
        this.lastError = error.message;
        footer(error.message);
        return null;
      }
    },
  };
})();
