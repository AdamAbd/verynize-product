// Room assets: images stored once in the ASSETS_BUCKET R2 bucket and referenced from the room
// document by URL, so collaborators receive a short URL operation instead of a data URI.
// Metadata lives in D1 (`room_asset`, cloud/migrations/0004_room_assets.sql). API and the read
// authorization model: cloud/README.md, "Room assets".
//
//   POST /api/rooms/:id/assets {contentType,size,sha256}   editor → {id,url,uploadUrl,method,expiresAt}
//   PUT  /api/rooms/:id/assets/:assetId?expires&signature   signed upload of the raw bytes
//   GET  /api/rooms/:id/assets/:assetId?sig=…               signed read (what documents store)
//   GET  /api/rooms/:id/assets/:assetId                     room viewer (capability or session)
import { and, count, eq } from "drizzle-orm";
import { database } from "./db.js";
import { roomAsset } from "./schema.js";
import {
  atLeast,
  bytesHex,
  corsHeaders,
  fail,
  json,
  readBytes,
  readJson,
  sameDigest,
} from "./http.js";

export const MAX_ASSET = 20 * 1024 * 1024;
export const MAX_ASSETS_PER_ROOM = 2000;
export const UPLOAD_TTL = 10 * 60 * 1000;
// SVG is refused: it can carry script and is kept as an embedded data URI in documents instead.
export const ASSET_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

/** The content type the bytes really are (magic numbers), or null. */
export function sniffImage(bytes) {
  const at = (offset, text) =>
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (bytes.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (bytes.length >= 16 && at(4, "ftyp")) {
    // ISO-BMFF: major brand at 8, compatible brands from 16 up to the end of the ftyp box.
    const boxSize = Math.min(
      bytes.length,
      (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3],
    );
    for (let offset = 8; offset + 4 <= boxSize; offset += offset === 8 ? 8 : 4)
      if (at(offset, "avif") || at(offset, "avis")) return "image/avif";
  }
  return null;
}

let cachedKey = null;
async function signingKey(env) {
  const secret = env.ASSET_SIGNING_SECRET;
  if (typeof secret !== "string" || secret.length < 16)
    fail(503, "Room assets are not configured on this server");
  if (cachedKey?.secret !== secret)
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    };
  return cachedKey.key;
}
async function sign(env, ...parts) {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await signingKey(env),
    new TextEncoder().encode(["verynize-room-asset-v1", ...parts].join("\n")),
  );
  return Array.from(new Uint8Array(mac), (n) => n.toString(16).padStart(2, "0")).join("");
}
const readSignature = (env, roomId, assetId) => sign(env, "read", roomId, assetId);
const uploadSignature = (env, row, expires) =>
  sign(
    env,
    "put",
    row.roomId,
    row.id,
    row.sha256,
    String(row.size),
    row.contentType,
    String(expires),
  );

const objectKey = (row) => `rooms/${row.roomId}/${row.sha256}`;
const assetPath = (roomId, assetId) => `/api/rooms/${roomId}/assets/${assetId}`;
/** The stable, signed read URL stored in documents (see "Room assets" in cloud/README.md). */
async function readUrl(env, origin, row) {
  return `${origin}${assetPath(row.roomId, row.id)}?sig=${await readSignature(env, row.roomId, row.id)}`;
}
const describe = async (env, origin, row) => ({
  id: row.id,
  url: await readUrl(env, origin, row),
  contentType: row.contentType,
  size: row.size,
  sha256: row.sha256,
});

function configured(env) {
  if (!env.ASSETS_BUCKET || !env.DB) fail(503, "Room assets are not configured on this server");
}
const find = (env, roomId, assetId) =>
  database(env)
    .select()
    .from(roomAsset)
    .where(and(eq(roomAsset.roomId, roomId), eq(roomAsset.id, assetId)))
    .get();

/** POST /api/rooms/:id/assets: register an upload (or find the room's copy of these bytes). */
async function createAsset(request, env, url, roomId, access) {
  const { role, account } = await access();
  if (!role) fail(401, "Unauthorized");
  if (!atLeast(role, "editor")) fail(403, `This needs the editor role; you are a ${role}`);
  const data = await readJson(request, 16 * 1024);
  const contentType = String(data.contentType || "").toLowerCase();
  if (!ASSET_TYPES[contentType])
    fail(415, "Only PNG, JPEG, WebP, GIF and AVIF images can be uploaded");
  if (!Number.isSafeInteger(data.size) || data.size < 1 || data.size > MAX_ASSET)
    fail(413, `Images must be between 1 byte and ${MAX_ASSET / 1024 / 1024} MB`);
  const sha256 = String(data.sha256 || "").toLowerCase();
  if (!SHA256.test(sha256)) fail(400, "sha256 must be 64 hex characters");
  const db = database(env);
  let row = await db
    .select()
    .from(roomAsset)
    .where(and(eq(roomAsset.roomId, roomId), eq(roomAsset.sha256, sha256)))
    .get();
  if (row?.status === "ready")
    return json({ ...(await describe(env, url.origin, row)), existing: true });
  if (row) {
    // A pending registration of the same bytes: take the new declaration and issue a fresh URL.
    if (row.size !== data.size || row.contentType !== contentType)
      await db
        .update(roomAsset)
        .set({ size: data.size, contentType })
        .where(eq(roomAsset.id, row.id));
    row = { ...row, size: data.size, contentType };
  } else {
    const [{ total }] = await db
      .select({ total: count() })
      .from(roomAsset)
      .where(eq(roomAsset.roomId, roomId));
    if (total >= MAX_ASSETS_PER_ROOM) fail(507, "This room has reached its image limit");
    row = {
      id: crypto.randomUUID(),
      roomId,
      sha256,
      size: data.size,
      contentType,
      status: "pending",
      createdBy: account?.id || null,
      createdAt: Date.now(),
      uploadedAt: null,
    };
    await db.insert(roomAsset).values(row).onConflictDoNothing();
    // A concurrent registration of the same bytes wins; use its row.
    row = await db
      .select()
      .from(roomAsset)
      .where(and(eq(roomAsset.roomId, roomId), eq(roomAsset.sha256, sha256)))
      .get();
    if (row.status === "ready")
      return json({ ...(await describe(env, url.origin, row)), existing: true });
  }
  const expires = Date.now() + UPLOAD_TTL;
  const signature = await uploadSignature(env, row, expires);
  return json(
    {
      ...(await describe(env, url.origin, row)),
      existing: false,
      method: "PUT",
      uploadUrl: `${url.origin}${assetPath(roomId, row.id)}?expires=${expires}&signature=${signature}`,
      expiresAt: expires,
    },
    201,
  );
}

/** PUT <uploadUrl>: the raw bytes, checked against the registration. */
async function uploadAsset(request, env, url, roomId, assetId) {
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") || "";
  if (!Number.isSafeInteger(expires) || !SIGNATURE.test(signature))
    fail(403, "Upload URL is invalid");
  const row = await find(env, roomId, assetId);
  if (!row) fail(403, "Upload URL is invalid");
  if (!sameDigest(signature, await uploadSignature(env, row, expires)))
    fail(403, "Upload URL is invalid");
  if (expires < Date.now()) fail(403, "Upload URL has expired; register the image again");
  if (expires > Date.now() + UPLOAD_TTL + 60_000) fail(403, "Upload URL is invalid");
  if (row.status === "ready") {
    await request.body?.cancel();
    return json({ ...(await describe(env, url.origin, row)), existing: true });
  }
  const bytes = await readBytes(request, row.size);
  if (bytes.byteLength !== row.size)
    fail(400, `Expected ${row.size} bytes, received ${bytes.byteLength}`);
  if ((await bytesHex(bytes)) !== row.sha256) fail(400, "The uploaded bytes do not match sha256");
  const sniffed = sniffImage(bytes);
  if (sniffed !== row.contentType)
    fail(
      415,
      `The uploaded bytes are ${sniffed || "not a supported image"}, not ${row.contentType}`,
    );
  await env.ASSETS_BUCKET.put(objectKey(row), bytes, {
    httpMetadata: { contentType: row.contentType },
    sha256: row.sha256,
    customMetadata: { roomId, assetId },
  });
  const uploadedAt = Date.now();
  await database(env)
    .update(roomAsset)
    .set({ status: "ready", uploadedAt })
    .where(eq(roomAsset.id, row.id));
  return json({ ...(await describe(env, url.origin, row)), existing: false });
}

/** GET|HEAD: a signed read URL, or room viewer access through headers. */
async function serveAsset(request, env, url, roomId, assetId, access) {
  const sig = url.searchParams.get("sig");
  if (sig !== null) {
    if (!SIGNATURE.test(sig) || !sameDigest(sig, await readSignature(env, roomId, assetId)))
      fail(403, "Image URL is invalid");
  } else if (!(await access()).role) fail(401, "Unauthorized");
  const row = await find(env, roomId, assetId);
  if (!row || row.status !== "ready") fail(404, "Image not found");
  const etag = `"${row.sha256}"`;
  const headers = new Headers({
    ...corsHeaders,
    "content-type": row.contentType,
    "x-content-type-options": "nosniff",
    // Private: browsers keep the bytes (the URL is immutable), shared caches do not.
    "cache-control": "private, max-age=31536000, immutable",
    etag,
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": `inline; filename="${row.id}.${ASSET_TYPES[row.contentType]}"`,
    "cross-origin-resource-policy": "cross-origin",
    "referrer-policy": "no-referrer",
  });
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  const object = await env.ASSETS_BUCKET.get(objectKey(row));
  if (!object) fail(404, "Image not found");
  headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

/**
 * Route /api/rooms/:id/assets[/:assetId]. `access()` resolves the caller's room role through the
 * room (`{role, account}`; role is null without access) and is only called when needed.
 */
export async function handleRoomAssets(request, env, url, roomId, assetId, access) {
  configured(env);
  if (!assetId && request.method === "POST") return createAsset(request, env, url, roomId, access);
  if (assetId && request.method === "PUT") return uploadAsset(request, env, url, roomId, assetId);
  if (assetId && ["GET", "HEAD"].includes(request.method))
    return serveAsset(request, env, url, roomId, assetId, access);
  return json({ error: "Not found" }, 404);
}
