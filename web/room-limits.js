// Size limits of shared design rooms, in UTF-8 bytes of JSON. One definition for the
// collaboration Worker (imported through cloud/limits.js) and the renderer (classic script:
// globalThis.VerynizeRoomLimits), so warnings in the editor match what the server enforces.
//
// Rooms store each page separately (cloud/room-store.js): a page holds its properties and nodes,
// the document metadata (name, variables, styles, page order, other top-level fields) is kept
// apart, and the whole document matches the 20 MiB a desktop file allows.
(function (scope) {
  "use strict";
  const MiB = 1024 * 1024;
  const PAGE_BYTES = 2 * MiB;
  const DOCUMENT_BYTES = 20 * MiB;
  const META_BYTES = 2 * MiB;
  // Whole-document requests (create, legacy snapshot writes) and socket messages carry up to a
  // whole document plus their envelope.
  const REQUEST_BYTES = DOCUMENT_BYTES + MiB;
  const MESSAGE_BYTES = REQUEST_BYTES;
  const encoder = new TextEncoder();
  const bytes = (value) =>
    encoder.encode(typeof value === "string" ? value : JSON.stringify(value)).length;
  scope.VerynizeRoomLimits = Object.freeze({
    PAGE_BYTES,
    DOCUMENT_BYTES,
    META_BYTES,
    REQUEST_BYTES,
    MESSAGE_BYTES,
    bytes,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
