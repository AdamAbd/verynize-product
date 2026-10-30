// Photographic image generation through a configurable HTTP provider. Two adapters:
//   openai — an OpenAI-compatible Images API: POST {baseURL}/images/generations with
//            {model, prompt, n: 1, size}; the response's data[0].b64_json (or data[0].url) is the image.
//   http   — a generic endpoint: POST {baseURL} with {prompt, model, width, height}; it answers with
//            raw image bytes (image/png|jpeg|webp) or JSON carrying b64_json / image / url.
// The API key is only ever placed in the Authorization header. Error text from the provider is
// stripped of the key before it is surfaced, and nothing here logs. The decoded output is checked to
// be a real PNG/JPEG/WebP (magic bytes + dimensions) before it becomes an image layer.
export const PROVIDERS = ["openai", "http"];
export const SIZES = ["1024x1024", "1536x1024", "1024x1536", "512x512", "256x256"];
const MAX_IMAGE = 15 * 1024 * 1024;
const TIMEOUT_MS = 120000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Normalised provider settings, or an Error describing the first invalid field. */
export function normalizeSettings(input = {}) {
  const provider = input.provider ?? "openai";
  if (!PROVIDERS.includes(provider))
    throw new Error("Provider must be OpenAI-compatible or generic HTTP");
  const raw = String(
    input.baseURL ?? (provider === "openai" ? "https://api.openai.com/v1" : ""),
  ).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter the provider base URL, such as https://api.openai.com/v1");
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error("The base URL cannot contain credentials, a query or a fragment");
  // Keys never travel in clear text to another machine: plain http is only for loopback servers.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    throw new Error("Use an https base URL (plain http is allowed for localhost only)");
  const model = String(input.model ?? (provider === "openai" ? "gpt-image-1" : "")).trim();
  if (model.length > 200 || /[\s"'<>]/.test(model)) throw new Error("Invalid model name");
  const size = String(input.size ?? "1024x1024");
  if (!SIZES.includes(size)) throw new Error("Unsupported image size");
  return { provider, baseURL: url.href.replace(/\/+$/, ""), model, size };
}

/** Image type and pixel size from the first bytes; null when the bytes are not PNG, JPEG or WebP. */
export function inspectImage(bytes) {
  const b = Buffer.from(bytes);
  if (
    b.length > 24 &&
    b.readUInt32BE(0) === 0x89504e47 &&
    b.readUInt32BE(4) === 0x0d0a1a0a &&
    b.toString("latin1", 12, 16) === "IHDR"
  )
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1],
        length = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { mime: "image/jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + length;
    }
    return null;
  }
  if (
    b.length > 30 &&
    b.toString("latin1", 0, 4) === "RIFF" &&
    b.toString("latin1", 8, 12) === "WEBP"
  ) {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8X")
      return {
        mime: "image/webp",
        width: 1 + b.readUIntLE(24, 3),
        height: 1 + b.readUIntLE(27, 3),
      };
    if (kind === "VP8L") {
      const v = b.readUInt32LE(21);
      return { mime: "image/webp", width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) };
    }
    if (kind === "VP8 ")
      return {
        mime: "image/webp",
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
      };
  }
  return null;
}

/** Replace every occurrence of the secret (and its Bearer form) in provider-supplied text. */
export function redact(text, secret) {
  let out = String(text ?? "");
  if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

async function readBody(response, limit = MAX_IMAGE) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit) throw new Error("Provider response exceeds 15 MB");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) {
      await response.body.cancel?.().catch(() => {});
      throw new Error("Provider response exceeds 15 MB");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function providerError(status, body, secret) {
  let detail = "";
  try {
    const json = JSON.parse(body);
    detail = json?.error?.message || json?.error || json?.message || "";
  } catch {
    detail = body;
  }
  detail = redact(
    String(typeof detail === "string" ? detail : JSON.stringify(detail))
      .replace(/\s+/g, " ")
      .slice(0, 300),
    secret,
  );
  const hint =
    status === 401 || status === 403
      ? "check the API key"
      : status === 429
        ? "rate limited or out of quota"
        : status >= 500
          ? "provider unavailable"
          : "request rejected";
  return new Error(`Image provider returned ${status} (${hint})${detail ? ": " + detail : ""}`);
}

function pickPayload(json) {
  const item = Array.isArray(json?.data)
    ? json.data[0]
    : Array.isArray(json?.images)
      ? json.images[0]
      : json;
  if (!item || typeof item !== "object") return null;
  const b64 = item.b64_json ?? item.base64 ?? item.image;
  if (typeof b64 === "string" && b64)
    return { b64: b64.replace(/^data:image\/[\w+.-]+;base64,/, "") };
  if (typeof item.url === "string") return { url: item.url };
  return null;
}

/**
 * Generate one image. options: {settings, apiKey, prompt, signal, fetch}. Resolves
 * {src: data URL, mime, width, height, provider, model}.
 */
export async function generateImage({
  settings,
  apiKey = "",
  prompt,
  signal,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const s = normalizeSettings(settings);
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000)
    throw new Error("Describe the image in under 4000 characters");
  if (s.provider === "openai" && !apiKey)
    throw new Error("Add an API key for the OpenAI-compatible provider");
  const [width, height] = s.size.split("x").map(Number);
  const endpoint = s.provider === "openai" ? s.baseURL + "/images/generations" : s.baseURL;
  const body =
    s.provider === "openai"
      ? { model: s.model, prompt: prompt.trim(), n: 1, size: s.size }
      : { prompt: prompt.trim(), model: s.model, width, height };
  const headers = {
    "content-type": "application/json",
    accept: "application/json, image/png, image/jpeg, image/webp",
  };
  if (apiKey) headers.authorization = "Bearer " + apiKey;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw new Error("Image generation canceled");
    if (timeout.aborted) throw new Error("Image generation timed out");
    throw new Error(
      "Unable to reach the image provider: " + redact(error.cause?.code || error.message, apiKey),
    );
  }
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok)
    throw providerError(
      response.status,
      (await readBody(response, 64 * 1024).catch(() => Buffer.alloc(0))).toString("utf8"),
      apiKey,
    );
  let bytes;
  if (type.startsWith("image/")) bytes = await readBody(response);
  else {
    let json;
    try {
      json = JSON.parse((await readBody(response)).toString("utf8"));
    } catch {
      throw new Error("Image provider returned an unreadable response");
    }
    const payload = pickPayload(json);
    if (!payload) throw new Error("Image provider response did not contain an image");
    if (payload.b64) bytes = Buffer.from(payload.b64, "base64");
    else {
      // Hosted result URL: fetched without the API key, https (or loopback http) only.
      const target = new URL(payload.url);
      if (
        !(
          target.protocol === "https:" ||
          (target.protocol === "http:" && LOOPBACK.has(target.hostname))
        )
      )
        throw new Error("Image provider returned an insecure image URL");
      const download = await fetchImpl(target.href, { signal: combined, redirect: "follow" });
      if (!download.ok) throw new Error("Image download returned " + download.status);
      bytes = await readBody(download);
    }
  }
  if (bytes.length > MAX_IMAGE) throw new Error("Generated image exceeds 15 MB");
  const info = inspectImage(bytes);
  if (!info || !info.width || !info.height)
    throw new Error("Image provider did not return a PNG, JPEG or WebP image");
  return {
    src: `data:${info.mime};base64,${bytes.toString("base64")}`,
    mime: info.mime,
    width: info.width,
    height: info.height,
    provider: s.provider,
    model: s.model,
  };
}
