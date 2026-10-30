// Arbitrary web page capture. The page loads in a hidden window with its own in-memory session
// partition (no cookies or cache shared with the editor or other captures), no Node integration, a
// sandboxed renderer and no preload; page scripts run so client-rendered pages paint. Permission
// prompts, popups, downloads and non-http(s) navigation are refused. Cross-origin images, CSS
// backgrounds and @font-face fonts are fetched through that same session and embedded as data URLs
// (desktop/capture-core.cjs). Two calls: `probe` returns a screenshot plus element boxes for the
// renderer's region picker; `captureRemote` returns the design document of a region.
const { BrowserWindow } = require("electron");
const crypto = require("node:crypto");
const { onWindowClosed } = require("./window-cleanup.cjs");
const {
  snapshotDocument,
  pageBoxes,
  probeInteractions,
  finishSnapshot,
  validRegion,
} = require("./capture-core.cjs");

function remoteURL(value) {
  if (typeof value !== "string" || value.length > 4096) throw Error("Enter a web page URL");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw Error("Enter a full web page URL, such as https://example.com");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw Error("Only http and https pages without embedded credentials can be captured");
  return url.href;
}

const settle = (webContents) =>
  webContents.executeJavaScript(`Promise.race([
  (async()=>{try{await document.fonts.ready}catch{}await Promise.all([...document.images].filter(i=>!i.complete).map(i=>new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})(),
  new Promise(r=>setTimeout(r,4000))]).then(()=>true)`);

async function openCaptureWindow(url, width, height) {
  const partition = "capture-remote-" + crypto.randomUUID(); // no "persist:" prefix: in-memory only
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    title: "Web page capture",
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: true,
      webSecurity: true,
      backgroundThrottling: false,
      offscreen: false,
      spellcheck: false,
    },
  });
  const ses = window.webContents.session;
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    let allow = false;
    try {
      allow = ["http:", "https:", "data:", "blob:", "about:"].includes(
        new URL(details.url).protocol,
      );
    } catch {
      /* malformed */
    }
    callback({ cancel: !allow });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const restrict = (event, next) => {
    try {
      remoteURL(next);
    } catch {
      event.preventDefault();
    }
  };
  window.webContents.on("will-navigate", restrict);
  window.webContents.on("will-redirect", restrict);
  let timer,
    timedOut = false;
  try {
    await Promise.race([
      window.loadURL(url),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(Error("The page did not finish loading within 20 seconds"));
        }, 20000);
      }),
    ]);
  } catch (error) {
    // A page whose subresources never finish still painted; capture what is there.
    if (!(timedOut && window.webContents.getURL())) {
      window.destroy();
      throw Error("Unable to load page: " + error.message.replace(/\s+/g, " ").slice(0, 200));
    }
  } finally {
    clearTimeout(timer);
  }
  await settle(window.webContents);
  return window;
}

function registerRemoteCapture(handle, parent) {
  const windows = new Set();
  onWindowClosed(parent, () => {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
  });
  async function withPage(options, task) {
    if (!options || typeof options !== "object") throw Error("Capture options are required");
    const url = remoteURL(options.url);
    const width = Math.max(320, Math.min(1920, Math.round(Number(options.width) || 1280)));
    const height = Math.max(320, Math.min(1400, Math.round(Number(options.height) || 800)));
    if (windows.size >= 2) throw Error("A web page capture is already running");
    const window = await openCaptureWindow(url, width, height);
    windows.add(window);
    try {
      return await task(window, { url, width, height });
    } finally {
      windows.delete(window);
      if (!window.isDestroyed()) window.destroy();
    }
  }
  // Screenshot and element boxes for the interactive region picker.
  handle("captureRemoteProbe", (options) =>
    withPage(options, async (window) => {
      const info = await window.webContents.executeJavaScript("(" + pageBoxes.toString() + ")()");
      let image = await window.webContents.capturePage();
      if (image.isEmpty()) {
        const debug = window.webContents.debugger;
        debug.attach("1.3");
        try {
          const { data } = await debug.sendCommand("Page.captureScreenshot", { format: "png" });
          return {
            ...info,
            url: window.webContents.getURL(),
            screenshot: "data:image/png;base64," + data,
          };
        } finally {
          debug.detach();
        }
      }
      const size = image.getSize();
      if (size.width !== info.width)
        image = image.resize({ width: info.width, height: info.height });
      return { ...info, url: window.webContents.getURL(), screenshot: image.toDataURL() };
    }),
  );
  handle("captureRemote", (options) =>
    withPage(options, async (window, { width, height }) => {
      const viewport = await window.webContents.executeJavaScript(
        "({width:innerWidth,height:innerHeight})",
      );
      const region = options.region || null;
      if (region && !validRegion(region, viewport.width, viewport.height))
        throw Error("Capture region must lie inside the " + width + "×" + height + " viewport");
      const snapshot = await window.webContents.executeJavaScript(
        "(" + snapshotDocument.toString() + ")(" + JSON.stringify(region) + ",{keep:true})",
      );
      if (options.interactions !== false) await probeInteractions(window.webContents, snapshot);
      const ses = window.webContents.session;
      const page = window.webContents.getURL();
      return finishSnapshot(snapshot, {
        origin: new URL(page).origin,
        crossOrigin: true,
        fetcher: (url, init) => ses.fetch(url, { ...init, credentials: "omit" }),
      });
    }),
  );
}

module.exports = { registerRemoteCapture, remoteURL };
