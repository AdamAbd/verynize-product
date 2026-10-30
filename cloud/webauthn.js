// WebAuthn (passkey) registration and assertion verification with WebCrypto.
// Supports ES256 (-7), EdDSA/Ed25519 (-8) and RS256 (-257) credentials. Attestation statements
// are not evaluated (the server requests attestation "none" and makes no device claims).
import { rpcFail } from "./http.js";

export const ALGORITHMS = [-7, -8, -257];
const encoder = new TextEncoder();

export function toBase64url(bytes) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) || value.length > 200000)
    rpcFail(400, "Invalid base64url value");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const text = atob(padded);
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const equalBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Minimal CBOR decoder (RFC 8949 subset used by WebAuthn). Returns {value, offset}. */
export function decodeCbor(bytes, start = 0, depth = 0) {
  if (depth > 16) rpcFail(400, "CBOR nesting too deep");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  const need = (n) => {
    if (offset + n > bytes.length) rpcFail(400, "Truncated CBOR");
  };
  need(1);
  const initial = bytes[offset++];
  const major = initial >> 5,
    info = initial & 31;
  let length;
  if (info < 24) length = info;
  else if (info === 24) {
    need(1);
    length = bytes[offset];
    offset += 1;
  } else if (info === 25) {
    need(2);
    length = view.getUint16(offset);
    offset += 2;
  } else if (info === 26) {
    need(4);
    length = view.getUint32(offset);
    offset += 4;
  } else if (info === 27) {
    need(8);
    const big = view.getBigUint64(offset);
    offset += 8;
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) rpcFail(400, "CBOR integer too large");
    length = Number(big);
  } else rpcFail(400, "Unsupported CBOR encoding");
  switch (major) {
    case 0:
      return { value: length, offset };
    case 1:
      return { value: -1 - length, offset };
    case 2:
      need(length);
      return { value: bytes.slice(offset, offset + length), offset: offset + length };
    case 3:
      need(length);
      return {
        value: new TextDecoder().decode(bytes.subarray(offset, offset + length)),
        offset: offset + length,
      };
    case 4: {
      if (length > 1000) rpcFail(400, "CBOR array too long");
      const items = [];
      for (let i = 0; i < length; i++) {
        const item = decodeCbor(bytes, offset, depth + 1);
        items.push(item.value);
        offset = item.offset;
      }
      return { value: items, offset };
    }
    case 5: {
      if (length > 1000) rpcFail(400, "CBOR map too long");
      const map = new Map();
      for (let i = 0; i < length; i++) {
        const key = decodeCbor(bytes, offset, depth + 1);
        const value = decodeCbor(bytes, key.offset, depth + 1);
        map.set(key.value, value.value);
        offset = value.offset;
      }
      return { value: map, offset };
    }
    case 7:
      if (info === 20) return { value: false, offset };
      if (info === 21) return { value: true, offset };
      if (info === 22) return { value: null, offset };
      rpcFail(400, "Unsupported CBOR simple value");
  }
  rpcFail(400, "Unsupported CBOR type");
}

function parseAuthData(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37)
    rpcFail(400, "Authenticator data is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[32];
  const result = {
    rpIdHash: bytes.slice(0, 32),
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    signCount: view.getUint32(33),
  };
  if (flags & 0x40) {
    if (bytes.length < 55) rpcFail(400, "Attested credential data is truncated");
    const idLength = view.getUint16(53);
    if (55 + idLength > bytes.length || idLength > 1023) rpcFail(400, "Credential id is invalid");
    result.credentialId = bytes.slice(55, 55 + idLength);
    const key = decodeCbor(bytes, 55 + idLength);
    result.publicKey = key.value;
  }
  return result;
}

/** COSE public key → {alg, jwk}. */
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) rpcFail(400, "Public key is not a COSE map");
  const kty = cose.get(1),
    alg = cose.get(3);
  const b64 = (value) => {
    if (!(value instanceof Uint8Array)) rpcFail(400, "Malformed COSE key");
    return toBase64url(value);
  };
  if (kty === 2 && alg === -7 && cose.get(-1) === 1)
    return { alg, jwk: { kty: "EC", crv: "P-256", x: b64(cose.get(-2)), y: b64(cose.get(-3)) } };
  if (kty === 1 && alg === -8 && cose.get(-1) === 6)
    return { alg, jwk: { kty: "OKP", crv: "Ed25519", x: b64(cose.get(-2)) } };
  if (kty === 3 && alg === -257)
    return { alg, jwk: { kty: "RSA", n: b64(cose.get(-1)), e: b64(cose.get(-2)) } };
  rpcFail(400, "Unsupported passkey algorithm");
}

function importKey({ alg, jwk }) {
  if (alg === -7)
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
  if (alg === -8)
    return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** DER ECDSA signature (SEQUENCE of two INTEGERs) → raw 64-byte r||s used by WebCrypto. */
function derToRaw(der) {
  const read = (offset) => {
    if (der[offset] !== 0x02) rpcFail(400, "Malformed signature");
    const length = der[offset + 1];
    let value = der.slice(offset + 2, offset + 2 + length);
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) rpcFail(400, "Malformed signature");
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return { value: padded, next: offset + 2 + length };
  };
  if (der[0] !== 0x30 || der.length < 8) rpcFail(400, "Malformed signature");
  const r = read(2),
    s = read(r.next);
  const raw = new Uint8Array(64);
  raw.set(r.value, 0);
  raw.set(s.value, 32);
  return raw;
}

function checkClientData(bytes, { type, challenge, origin }) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    rpcFail(400, "Client data is not JSON");
  }
  if (data.type !== type) rpcFail(400, "Unexpected ceremony type");
  if (data.challenge !== challenge) rpcFail(400, "Challenge mismatch");
  if (data.origin !== origin) rpcFail(400, "Origin mismatch");
  if (data.crossOrigin === true) rpcFail(400, "Cross-origin ceremonies are not accepted");
}

/** Verify a registration response; returns the credential to store. */
export async function verifyRegistration({ credential, challenge, origin, rpId }) {
  const response = credential?.response;
  if (!response || typeof credential.id !== "string") rpcFail(400, "Missing credential");
  const clientData = fromBase64url(response.clientDataJSON);
  checkClientData(clientData, { type: "webauthn.create", challenge, origin });
  const attestation = decodeCbor(fromBase64url(response.attestationObject)).value;
  if (!(attestation instanceof Map) || typeof attestation.get("fmt") !== "string")
    rpcFail(400, "Malformed attestation");
  const auth = parseAuthData(attestation.get("authData"));
  if (!equalBytes(auth.rpIdHash, await sha256(encoder.encode(rpId))))
    rpcFail(400, "Passkey belongs to another site");
  if (!auth.userPresent) rpcFail(400, "User presence was not confirmed");
  if (!auth.credentialId || !auth.publicKey) rpcFail(400, "No credential in response");
  if (toBase64url(auth.credentialId) !== credential.id) rpcFail(400, "Credential id mismatch");
  const key = coseToJwk(auth.publicKey);
  await importKey(key);
  return {
    credentialId: credential.id,
    alg: key.alg,
    jwk: key.jwk,
    signCount: auth.signCount,
    userVerified: auth.userVerified,
  };
}

/** Verify an assertion against a stored credential; returns the new signature counter. */
export async function verifyAssertion({ credential, stored, challenge, origin, rpId }) {
  const response = credential?.response;
  if (!response) rpcFail(400, "Missing assertion");
  const clientData = fromBase64url(response.clientDataJSON);
  checkClientData(clientData, { type: "webauthn.get", challenge, origin });
  const authBytes = fromBase64url(response.authenticatorData);
  const auth = parseAuthData(authBytes);
  if (!equalBytes(auth.rpIdHash, await sha256(encoder.encode(rpId))))
    rpcFail(400, "Passkey belongs to another site");
  if (!auth.userPresent) rpcFail(400, "User presence was not confirmed");
  const signed = new Uint8Array(authBytes.length + 32);
  signed.set(authBytes, 0);
  signed.set(await sha256(clientData), authBytes.length);
  let signature = fromBase64url(response.signature);
  const key = await importKey({ alg: stored.alg, jwk: stored.jwk });
  let algorithm = { name: "RSASSA-PKCS1-v1_5" };
  if (stored.alg === -7) {
    algorithm = { name: "ECDSA", hash: "SHA-256" };
    signature = derToRaw(signature);
  } else if (stored.alg === -8) algorithm = { name: "Ed25519" };
  if (!(await crypto.subtle.verify(algorithm, key, signature, signed)))
    rpcFail(401, "Passkey signature is invalid");
  // A counter that does not advance (when either side uses counters) signals a cloned authenticator.
  if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount)
    rpcFail(401, "Passkey counter did not advance; the authenticator may be cloned");
  return { signCount: auth.signCount, userVerified: auth.userVerified };
}
