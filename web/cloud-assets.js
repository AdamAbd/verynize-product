// Room assets on the client: while connected to a room with edit access, embedded images (data
// URIs) on the open page are uploaded once to the room's R2 asset store (cloud/assets.js) and
// their src is replaced by the asset URL through window.design.updateNodes, so collaborators
// receive a short URL operation instead of the image bytes. web/cloud-panel.js asks hold() before
// sending local operations, and hold() defers them until the uploads settle. SVG data URIs stay
// embedded (the server refuses SVG). Exports call inlineHtml() to turn asset URLs back into data
// URIs for the offline renderer. API: cloud/README.md, "Room assets".
(() => {
  const UPLOADABLE = /^data:(image\/(?:png|jpeg|webp|gif));base64,/i;
  const MAX_BYTES = 20 * 1024 * 1024;
  const TIMEOUT = 60_000;
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const ASSET_PATH = new RegExp(`^/api/rooms/(${UUID})/assets/${UUID}$`);
  const ASSET_IN_TEXT = new RegExp(
    `https?://[A-Za-z0-9.:\\[\\]-]+/api/rooms/${UUID}/assets/${UUID}(?:\\?sig=[0-9a-f]{64})?`,
    "g",
  );

  /** The same URL check as isRoomAssetUrl in web/document-core.js (the document schema). */
  function isAssetUrl(value) {
    if (typeof value !== "string" || value.length > 512) return false;
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      url.href === value &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      ASSET_PATH.test(url.pathname) &&
      /^(\?sig=[0-9a-f]{64})?$/.test(url.search)
    );
  }

  // Uploads per room and source: {status: 'uploading'|'done'|'failed', url?, error?}.
  const entries = new Map();
  // Asset URL → data URI, for exports and offline rendering of images this client has seen.
  const inline = new Map();
  // Callbacks of web/cloud-panel.js waiting for the held uploads (see hold()).
  let waiters = [];
  let settleTimer = null;
  let lastError = "";

  /** The connected room, when this client may edit it. */
  function editableRoom() {
    const workspace = window.cloudWorkspace;
    if (!workspace?.isConnected?.() || !["editor", "owner"].includes(workspace.role?.()))
      return null;
    return workspace.room?.() || null;
  }
  const keyOf = (room, src) => `${room.server}|${room.id}|${src}`;
  /** Uploadable embedded images on the open page (updateNodes reaches only that page). */
  function embeddedImages(doc) {
    const page = doc?.pages?.find?.((p) => p.id === doc.activePage);
    return (page?.nodes || []).filter(
      (n) => n.type === "image" && typeof n.src === "string" && UPLOADABLE.test(n.src),
    );
  }
  const hex = (buffer) =>
    Array.from(new Uint8Array(buffer), (n) => n.toString(16).padStart(2, "0")).join("");

  async function upload(room, src) {
    const contentType = UPLOADABLE.exec(src)[1].toLowerCase();
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw Error("Image is larger than 20 MB");
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const asset = await window.cloudWorkspace.request(`/api/rooms/${room.id}/assets`, {
        method: "POST",
        body: JSON.stringify({ contentType, size: bytes.byteLength, sha256 }),
        signal: controller.signal,
      });
      if (asset.uploadUrl) {
        const response = await fetch(asset.uploadUrl, {
          method: asset.method || "PUT",
          headers: { "Content-Type": contentType },
          body: bytes,
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw Error(data.error || `Upload failed (${response.status})`);
        }
      }
      if (!isAssetUrl(asset.url)) throw Error("The server returned an invalid image URL");
      inline.set(asset.url, src);
      return asset.url;
    } finally {
      clearTimeout(timer);
    }
  }

  function start(room, src) {
    const key = keyOf(room, src);
    let entry = entries.get(key);
    if (entry) return entry;
    entry = { status: "uploading" };
    entries.set(key, entry);
    upload(room, src).then(
      (url) => {
        entry.status = "done";
        entry.url = url;
        settleSoon();
      },
      (error) => {
        entry.status = "failed";
        entry.error = error.message;
        lastError = error.message;
        console.warn("Room image upload failed; the image stays embedded:", error.message);
        settleSoon();
      },
    );
    return entry;
  }
  const uploading = () => [...entries.values()].some((entry) => entry.status === "uploading");
  function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 0);
  }

  /** Once nothing uploads: swap uploaded sources for their URLs, then release held changes. */
  function settle() {
    if (uploading()) return;
    const resume = waiters;
    waiters = [];
    const room = editableRoom();
    if (room && window.design?.getDocument) {
      const bySource = new Map();
      for (const node of embeddedImages(window.design.getDocument())) {
        const entry = entries.get(keyOf(room, node.src));
        if (entry?.status !== "done") continue;
        if (!bySource.has(node.src)) bySource.set(node.src, { url: entry.url, ids: [] });
        bySource.get(node.src).ids.push(node.id);
      }
      for (const [src, { url, ids }] of bySource)
        try {
          window.design.updateNodes(ids, (node) => (node.src === src ? { src: url } : {}));
        } catch (error) {
          lastError = error.message;
        }
    }
    for (const fn of resume)
      try {
        fn();
      } catch (error) {
        console.warn(error);
      }
  }

  /**
   * Called by web/cloud-panel.js before it sends local operations. Returns true (and calls
   * `resume` later) when the document has embedded images that are uploading or ready to swap.
   */
  function hold(doc, resume) {
    const room = editableRoom();
    if (!room) return false;
    const pending = embeddedImages(doc)
      .map((node) => start(room, node.src))
      .filter((entry) => entry.status !== "failed");
    if (!pending.length) return false;
    if (resume) waiters.push(resume);
    if (!uploading()) settleSoon();
    return true;
  }
  /** True while web/cloud-panel.js waits for uploads (it then defers applying remote state). */
  const holding = () => waiters.length > 0;

  /** Upload embedded images already in the document (on connect, page switch or remote edits). */
  function sweep() {
    const room = editableRoom();
    if (!room || !window.design?.getDocument) return;
    const images = embeddedImages(window.design.getDocument());
    for (const node of images) start(room, node.src);
    if (images.length && !uploading()) settleSoon();
  }

  async function dataUri(url) {
    if (inline.has(url)) return inline.get(url);
    const response = await fetch(url);
    if (!response.ok) throw Error(`Image request failed (${response.status})`);
    const blob = await response.blob();
    const value = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    inline.set(url, value);
    return value;
  }
  /** Replace room asset URLs in exported HTML with data URIs (left unchanged when unreachable). */
  async function inlineHtml(html) {
    if (typeof html !== "string") return html;
    const urls = [...new Set(html.match(ASSET_IN_TEXT) || [])].filter(isAssetUrl);
    let result = html;
    for (const url of urls)
      try {
        result = result.split(url).join(await dataUri(url));
      } catch (error) {
        console.warn("Room image could not be inlined:", error.message);
      }
    return result;
  }

  // Sweep when the document changes and when the connection or role changes.
  let sweepTimer = null;
  const sweepSoon = () => {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 50);
  };
  window.design?.subscribe?.(sweepSoon);
  let lastState = "";
  setInterval(() => {
    const room = editableRoom();
    const state = room ? `${room.server}|${room.id}` : "";
    if (state !== lastState) {
      lastState = state;
      if (room) sweepSoon();
    }
  }, 1000);

  window.cloudAssets = {
    isAssetUrl,
    hold,
    holding,
    sweep,
    inlineHtml,
    status: () => ({
      uploading: [...entries.values()].filter((entry) => entry.status === "uploading").length,
      uploaded: [...entries.values()].filter((entry) => entry.status === "done").length,
      failed: [...entries.values()].filter((entry) => entry.status === "failed").length,
      lastError,
    }),
  };
})();
