// Room asset storage on Node: the subset of the R2 bucket API cloud/assets.js uses
// (put/get/head/delete; objects with body, size, httpMetadata, customMetadata).
//
// - FileBlobStore: files under a directory, written atomically (temporary file + rename), with
//   metadata in a JSON sidecar.
// - S3BlobStore: any S3-compatible service (AWS S3, MinIO, R2, B2) through signed fetch requests,
//   path-style URLs.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const KEY = /^[A-Za-z0-9!_.*'()/-]{1,1024}$/;
function checkKey(key) {
  if (
    typeof key !== "string" ||
    !KEY.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new TypeError("Invalid object key");
  return key;
}
const toBytes = async (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array(await new Response(value).arrayBuffer());
};

function blobObject({ key, size, etag, uploaded, httpMetadata, customMetadata }, body) {
  const object = {
    key,
    size,
    etag,
    httpEtag: `"${etag}"`,
    uploaded: new Date(uploaded),
    httpMetadata,
    customMetadata,
  };
  if (body) {
    object.body = body;
    object.arrayBuffer = () => new Response(body).arrayBuffer();
    object.text = () => new Response(body).text();
  }
  return object;
}

export class FileBlobStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
  }
  #paths(key) {
    const file = path.join(this.directory, checkKey(key));
    return { file, meta: `${file}.meta.json` };
  }
  async put(key, value, options = {}) {
    const bytes = await toBytes(value);
    const etag = crypto.createHash("md5").update(bytes).digest("hex");
    if (
      options.sha256 &&
      crypto.createHash("sha256").update(bytes).digest("hex") !== options.sha256
    )
      throw new Error("put: the sha256 checksum does not match the body");
    const { file, meta } = this.#paths(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const info = {
      key,
      size: bytes.byteLength,
      etag,
      uploaded: Date.now(),
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    };
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    const handle = await fsp.open(temp, "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temp, file);
    await fsp.writeFile(`${meta}.tmp`, JSON.stringify(info));
    await fsp.rename(`${meta}.tmp`, meta);
    return blobObject(info);
  }
  async #info(key) {
    try {
      return JSON.parse(await fsp.readFile(this.#paths(key).meta, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async head(key) {
    const info = await this.#info(key);
    return info && blobObject(info);
  }
  async get(key) {
    const info = await this.#info(key);
    if (!info) return null;
    return blobObject(info, Readable.toWeb(fs.createReadStream(this.#paths(key).file)));
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const { file, meta } = this.#paths(key);
      await fsp.rm(meta, { force: true });
      await fsp.rm(file, { force: true });
    }
  }
}

export class S3BlobStore {
  /** @param {{endpoint: string, bucket: string, region?: string, accessKeyId: string, secretAccessKey: string}} config */
  constructor({ endpoint, bucket, region = "auto", accessKeyId, secretAccessKey }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
      throw new Error(
        "S3 storage needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
      );
    this.base = `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/`;
    this.credentials = { accessKeyId, secretAccessKey, region, service: "s3" };
  }
  get client() {
    this.signer ||= import("aws4fetch").then(({ AwsClient }) => new AwsClient(this.credentials));
    return this.signer;
  }
  #url(key) {
    return this.base + checkKey(key).split("/").map(encodeURIComponent).join("/");
  }
  async #send(key, init) {
    return (await this.client).fetch(this.#url(key), init);
  }
  #object(key, response, body) {
    const customMetadata = {};
    for (const [name, value] of response.headers)
      if (name.startsWith("x-amz-meta-")) customMetadata[name.slice(11)] = value;
    return blobObject(
      {
        key,
        size: Number(response.headers.get("content-length") || 0),
        etag: (response.headers.get("etag") || "").replace(/"/g, ""),
        uploaded: Date.parse(response.headers.get("last-modified") || "") || Date.now(),
        httpMetadata: { contentType: response.headers.get("content-type") || undefined },
        customMetadata,
      },
      body,
    );
  }
  async put(key, value, options = {}) {
    const bytes = await toBytes(value);
    const headers = {
      "content-type": options.httpMetadata?.contentType || "application/octet-stream",
    };
    if (options.sha256)
      headers["x-amz-checksum-sha256"] = Buffer.from(options.sha256, "hex").toString("base64");
    for (const [name, value] of Object.entries(options.customMetadata || {}))
      headers[`x-amz-meta-${name.toLowerCase()}`] = String(value);
    const response = await this.#send(key, { method: "PUT", headers, body: bytes });
    if (!response.ok) throw new Error(`S3 put failed with status ${response.status}`);
    return blobObject({
      key,
      size: bytes.byteLength,
      etag: (response.headers.get("etag") || "").replace(/"/g, ""),
      uploaded: Date.now(),
      httpMetadata: { contentType: headers["content-type"] },
      customMetadata: options.customMetadata || {},
    });
  }
  async head(key) {
    const response = await this.#send(key, { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 head failed with status ${response.status}`);
    return this.#object(key, response);
  }
  async get(key) {
    const response = await this.#send(key, { method: "GET" });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) throw new Error(`S3 get failed with status ${response.status}`);
    return this.#object(key, response, response.body);
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const response = await this.#send(key, { method: "DELETE" });
      if (!response.ok && response.status !== 404)
        throw new Error(`S3 delete failed with status ${response.status}`);
    }
  }
}
