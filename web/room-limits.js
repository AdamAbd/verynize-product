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
  const DOCUMENT_BYTES = 20 * MiB;
  const PAGE_BYTES = DOCUMENT_BYTES;
  const META_BYTES = 2 * MiB;
  // Whole-document requests (create, legacy snapshot writes) and socket messages carry up to a
  // whole document plus their envelope.
  const REQUEST_BYTES = DOCUMENT_BYTES + MiB;
  const MESSAGE_BYTES = REQUEST_BYTES;
  const encoder = new TextEncoder();
  const bytes = (value) =>
    encoder.encode(typeof value === "string" ? value : JSON.stringify(value)).length;
  // Leave room for message type, batch number and future envelope fields.
  function batchOps(ops) {
    const batches = [];
    let batch = [],
      size = 2;
    for (const op of ops) {
      const length = bytes(op) + 1;
      if (length > MESSAGE_BYTES - 65536) return null;
      if (batch.length && (batch.length >= 4000 || size + length > MESSAGE_BYTES - 65536)) {
        batches.push(batch);
        batch = [];
        size = 2;
      }
      batch.push(op);
      size += length;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  scope.VerynizeRoomLimits = Object.freeze({
    batchOps,
    PAGE_BYTES,
    DOCUMENT_BYTES,
    META_BYTES,
    REQUEST_BYTES,
    MESSAGE_BYTES,
    bytes,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
