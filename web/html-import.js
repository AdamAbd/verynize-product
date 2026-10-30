// Import HTML dialog (desktop): pasted markup or a chosen .html file goes through the main-process
// importer (desktop/html-import.cjs -> integrations/codec-html.mjs): stylesheets relative to the file,
// the CSS cascade for the chosen viewport, :root variables. The browser build keeps the in-page importer.
(() => {
  const native = window.desktop;
  const apply = document.getElementById("apply"),
    source = document.getElementById("source"),
    status = document.getElementById("status"),
    modal = document.getElementById("modal");
  if (!native?.importHtml || !apply || !source || !modal) return;
  const VIEWPORTS = [
    ["1440x900", "Desktop · 1440"],
    ["1280x800", "Laptop · 1280"],
    ["768x1024", "Tablet · 768"],
    ["390x844", "Phone · 390"],
  ];
  const bar = document.createElement("div");
  bar.id = "html-import-options";
  bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0";
  const viewport = document.createElement("select");
  viewport.id = "import-viewport";
  viewport.setAttribute("aria-label", "Import viewport");
  for (const [value, label] of VIEWPORTS) viewport.append(new Option(label, value));
  const remoteLabel = document.createElement("label");
  const remote = document.createElement("input");
  remote.type = "checkbox";
  remote.id = "import-remote";
  remoteLabel.append(remote, " Load remote stylesheets");
  const pick = document.createElement("button");
  pick.id = "import-file";
  pick.type = "button";
  pick.textContent = "Choose HTML file…";
  bar.append(viewport, remoteLabel, pick);
  apply.before(bar);
  source.placeholder =
    "Paste HTML (with <style> or Tailwind classes), or choose a file to resolve its stylesheets";
  // Show the options only in import mode (the dialog doubles as the responsive preview).
  new MutationObserver(() => {
    bar.hidden = apply.hidden;
  }).observe(apply, { attributes: true, attributeFilter: ["hidden"] });
  bar.hidden = apply.hidden;

  const options = () => {
    const [width, height] = viewport.value.split("x").map(Number);
    const doc = window.design.getDocument();
    return {
      document: doc,
      pageId: doc.activePage,
      viewport: { width, height },
      allowRemote: remote.checked,
    };
  };
  // Import notes (CSS without a canvas equivalent) stay readable after the dialog closes.
  const notice = (message, notes) => {
    let el = document.getElementById("import-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "import-notice";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:560px;padding:8px 12px;border-radius:8px;background:#1f1f24;color:#f4f4f5;font:12px/1.4 system-ui;z-index:1000;box-shadow:0 4px 16px #0006;cursor:pointer";
      el.onclick = () => el.remove();
      document.body.append(el);
    }
    el.textContent = message;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.remove(), notes ? 12000 : 4000);
  };
  let busy = false;
  const run = async (task) => {
    if (busy) return;
    busy = true;
    apply.disabled = pick.disabled = true;
    status.textContent = "Importing…";
    try {
      const result = await task();
      if (!result) {
        status.textContent = "";
        return;
      }
      window.design.loadDocument(result.document);
      window.design.setSelection?.(result.rootIds || []);
      const notes = result.warnings?.length || 0;
      const message = `Imported ${result.stats?.elements ?? ""} elements${result.file ? ` from ${result.file}` : ""}${notes ? ` · ${notes} note${notes === 1 ? "" : "s"}: ${result.warnings.slice(0, 3).join(" · ")}` : ""}`;
      status.textContent = message;
      modal.dataset.imported = String(result.rootIds?.length || 0);
      modal.close();
      notice(message, notes);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      apply.disabled = pick.disabled = false;
    }
  };
  // Replaces the in-page importer while the desktop bridge is available.
  apply.onclick = () => run(() => native.importHtml({ ...options(), html: source.value }));
  pick.onclick = () => run(() => native.importHtmlFile(options()));
})();
