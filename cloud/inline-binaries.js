// Inline binaries in room documents. Binary data (images, fonts, video) is stored as room assets
// in R2 (cloud/assets.js) and documents keep only the asset URL; web/storage-limits.js decides
// which data: URLs count (larger than INLINE_LIMIT_BYTES, a binary type; SVG up to
// SVG_INLINE_LIMIT_BYTES stays inline). This module:
//
// - extracts them on the Worker side of every write that carries whole values: room creation,
//   snapshot writes (PUT /api/rooms/:id), HTTP operation batches (POST /api/rooms/:id/ops) and
//   hosted MCP / model API edits (cloud/design-backend.js), after the editor role is known;
// - migrates rooms created before this rule, lazily when they are opened (socket or snapshot
//   read): the large data: URLs become assets through one server batch (DesignRoom.migrateInline);
// - gives the room a synchronous backstop (inlineProblem/screenOps) for writes that reach it
//   directly, i.e. WebSocket batches: those operations are rejected with a clear reason, because
//   clients upload binaries first (web/cloud-assets.js).
//
// Servers without room assets (no R2 bucket or signing secret) keep the previous behaviour:
// nothing is extracted or rejected.
import "../web/room-limits.js";
import "../web/storage-limits.js";
import "../web/cloud-ops.js";
import { assetsConfigured, storeAsset } from "./assets.js";
import { fail } from "./http.js";

const Limits = globalThis.VerynizeStorageLimits;
const Ops = globalThis.VerynizeOps;
const KiB = (bytes) => `${Math.round(bytes / 1024)} KB`;
// Cheap pre-check on stored JSON text: a data: URL of a binary family at least INLINE_LIMIT long.
const LARGE_INLINE_TEXT = new RegExp(
  `"data:(?:image|font|video|audio|application)/[^"]{${Limits.INLINE_LIMIT_BYTES - 16}}`,
);
export const mayHoldInline = (text) => typeof text === "string" && LARGE_INLINE_TEXT.test(text);

/**
 * True when asset URLs on this origin pass the document schema (isRoomAssetUrl in
 * web/document-core.js): https, or http on loopback. Elsewhere binaries stay inline.
 */
export function assetOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

/** {mime, bytes} of a data: URL (base64 or percent-encoded). */
export function decodeDataUrl(value) {
  const data = Limits.parseDataUrl(value);
  if (!data) fail(400, "Invalid data URL");
  const body = value.slice(data.offset);
  if (!data.base64) {
    let text;
    try {
      text = decodeURIComponent(body);
    } catch {
      fail(400, "Invalid data URL encoding");
    }
    return { mime: data.mime, bytes: new TextEncoder().encode(text) };
  }
  const clean = body.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) fail(400, "Invalid base64 in a data URL");
  if (typeof Uint8Array.fromBase64 === "function")
    return { mime: data.mime, bytes: Uint8Array.fromBase64(clean) };
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime: data.mime, bytes };
}

const rejectMessage = (item) =>
  item.kind === "reject"
    ? `Embedded ${item.mime} data larger than ${KiB(Limits.INLINE_LIMIT_BYTES)} cannot be stored in a shared file`
    : `Inline ${item.mime} data larger than ${KiB(Limits.INLINE_LIMIT_BYTES)} cannot be stored in a room; upload it as a room asset first`;

/**
 * Store the large inline binaries of a JSON value as assets of `roomId` and return the value with
 * their asset URLs: {value, extracted}. The caller has checked that the account may edit the
 * room (or is creating it). Fails with 413 for binaries over the asset limit or of a type rooms
 * cannot store, and 415 when the bytes are not what the data: URL declares.
 */
export async function extractInline(env, origin, roomId, value, accountId) {
  if (!assetsConfigured(env) || !assetOrigin(origin)) return { value, extracted: 0 };
  const found = Limits.inlineBinaries(value);
  if (!found.length) return { value, extracted: 0 };
  const refused = found.find((item) => item.kind === "reject");
  if (refused) fail(413, rejectMessage(refused));
  const urls = new Map();
  for (const item of found) {
    if (urls.has(item.value)) continue;
    const { mime, bytes } = decodeDataUrl(item.value);
    const asset = await storeAsset(env, origin, roomId, bytes, mime, accountId);
    urls.set(item.value, asset.url);
  }
  return {
    value: Limits.mapBinaries(value, (text) => urls.get(text) ?? text),
    extracted: urls.size,
  };
}

/** The reason a value may not be stored in a room as it is (a large inline binary), or null. */
export function inlineProblem(env, value) {
  if (!assetsConfigured(env)) return null;
  const [first] = Limits.inlineBinaries(value);
  return first ? rejectMessage(first) : null;
}
/** Throws 413 when a value holds a large inline binary (room creation and snapshot writes). */
export function rejectInline(env, value) {
  const problem = inlineProblem(env, value);
  if (problem) fail(413, problem);
}
/**
 * Split a batch into operations the room may apply and rejected ones ({index, reason}, the
 * shape VerynizeOps.apply reports), for batches that reach the room without extraction.
 */
export function screenOps(env, ops) {
  if (!assetsConfigured(env) || !Array.isArray(ops)) return { ops, rejected: [] };
  const kept = [],
    rejected = [];
  ops.forEach((op, index) => {
    const reason = op?.t === "text" ? null : inlineProblem(env, op?.value);
    if (reason) rejected.push({ index, reason });
    else kept.push(op);
  });
  return { ops: kept, rejected };
}

/**
 * Lazy migration of a room that still stores large inline binaries (rooms created before room
 * assets covered every binary): extracts them and applies the URL swap as one server batch. Cheap
 * when there is nothing to do (the room answers from a regex over its stored text, once per
 * revision). `pages` limits it to the pages a lazy client loads (cloud/rooms.js inlineSnapshot);
 * null covers the whole document. Never throws: a failed migration leaves the room as it was and
 * is retried on the next open.
 */
export async function migrateRoomInline(env, origin, roomId, stub, pages = null) {
  if (!assetsConfigured(env) || typeof stub.inlineSnapshot !== "function") return null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await stub.inlineSnapshot(pages);
      if (!state) return null;
      const { value, extracted } = await extractInline(env, origin, roomId, state.document, null);
      if (!extracted) return null;
      const ops = Ops.diff(state.document, value);
      const result = await stub.migrateInline({ baseRevision: state.revision, ops });
      if (!result?.conflict) return { extracted, revision: result.revision };
    }
  } catch (error) {
    console.warn(`Room ${roomId}: inline binaries were not migrated: ${error.message}`);
  }
  return null;
}
