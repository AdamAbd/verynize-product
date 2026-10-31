// Boots the desktop renderer (web/index.html) inside the Start document, in the browser only.
//
// The shell is generated from web/index.html at build time (web-start/build/legacy-web.mjs), so the
// markup and script order stay those of the desktop page. Order of work:
// 1. stylesheets, awaited, so legacy scripts measure a styled layout;
// 2. body markup, inserted before Start's own nodes as direct <body> children (legacy CSS and
//    selectors expect that);
// 3. scripts in document order (`async = false` keeps execution ordered while fetching in
//    parallel);
// 4. a DOMContentLoaded event. A parsed page fires it after its scripts; legacy listeners
//    registered during startup (cloud-panel.js reconnects the open file's room on it) need it.
import shell from "virtual:verynize/legacy-shell";

let booted: Promise<void> | undefined;

/** Starts the legacy editor once per page. Later calls return the same promise. */
export function bootLegacyEditor(): Promise<void> {
  booted ??= run();
  return booted;
}

const loaded = (element: HTMLLinkElement | HTMLScriptElement, label: string) =>
  new Promise<void>((resolve, reject) => {
    element.addEventListener("load", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error(`Failed to load ${label}`)), {
      once: true,
    });
  });

async function run() {
  const root = document.documentElement;
  root.dataset.legacyEditor = "booting";
  if (shell.title) document.title = shell.title;

  const styles: Promise<void>[] = [];
  for (const style of shell.styles) {
    if (style.href === undefined) {
      const element = document.createElement("style");
      element.textContent = style.text ?? "";
      document.head.append(element);
      continue;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = style.href;
    styles.push(loaded(link, style.href).catch((error: Error) => console.error(error.message)));
    document.head.append(link);
  }
  await Promise.all(styles);

  for (const [name, value] of Object.entries(shell.bodyAttributes))
    document.body.setAttribute(name, value);
  const template = document.createElement("template");
  template.innerHTML = shell.bodyHtml;
  document.body.prepend(template.content);

  let last: Promise<void> = Promise.resolve();
  for (const script of shell.scripts) {
    const element = document.createElement("script");
    for (const [name, value] of Object.entries(script.attrs)) element.setAttribute(name, value);
    element.async = false;
    if (script.text !== undefined) {
      // Inserted inline scripts run immediately, so wait for the scripts before them.
      await last;
      element.text = script.text;
    } else
      last = loaded(element, script.attrs.src ?? "script").catch((error: Error) =>
        console.error(error.message),
      );
    document.body.append(element);
  }
  // Ordered scripts run in insertion order, so the last one loading means all have run.
  await last;
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  root.dataset.legacyEditor = "ready";
}
