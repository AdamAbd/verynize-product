// Image nodes may reference room asset URLs (cloud/assets.js) instead of embedding data URIs.
// validateDocument is the shared schema (web/document-core.js), used by the canvas too; it accepts only the exact asset URL form.
import test from "node:test";
import assert from "node:assert/strict";
import { isRoomAssetUrl, validateDocument } from "./design-store.mjs";

const ROOM = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ASSET = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SIG = "a".repeat(64);
const doc = (src) => ({
  version: 2,
  name: "Assets",
  tokens: {},
  pages: [
    {
      id: "p",
      name: "P",
      nodes: [{ id: "i", type: "image", name: "Image", x: 0, y: 0, w: 10, h: 10, src }],
    },
  ],
});

test("room asset URLs are accepted as image sources", () => {
  for (const url of [
    `https://verynize.example/api/rooms/${ROOM}/assets/${ASSET}?sig=${SIG}`,
    `https://verynize.example/api/rooms/${ROOM}/assets/${ASSET}`,
    `http://127.0.0.1:8787/api/rooms/${ROOM}/assets/${ASSET}?sig=${SIG}`,
  ]) {
    assert.equal(isRoomAssetUrl(url), true, url);
    assert.doesNotThrow(() => validateDocument(doc(url)));
  }
});

test("other URLs stay rejected", () => {
  for (const url of [
    `http://verynize.example/api/rooms/${ROOM}/assets/${ASSET}`,
    `https://user:pass@verynize.example/api/rooms/${ROOM}/assets/${ASSET}`,
    `https://verynize.example/api/rooms/${ROOM}/assets/${ASSET}?sig=${SIG}&x=1`,
    `https://verynize.example/api/rooms/${ROOM}/assets/${ASSET}#x`,
    `https://verynize.example/api/rooms/${ROOM}/assets/../../evil`,
    `https://verynize.example/api/rooms/${ROOM}/assets/${ASSET}/extra`,
    `https://verynize.example/image.png`,
    `javascript:alert(1)`,
    `https://verynize.example/api/rooms/${ROOM}/assets/${ASSET}?sig=${SIG}`.toUpperCase(),
  ]) {
    assert.equal(isRoomAssetUrl(url), false, url);
    assert.throws(() => validateDocument(doc(url)), /embedded image or a room asset URL/);
  }
  assert.doesNotThrow(() => validateDocument(doc("data:image/png;base64,AAAA")));
});
