// Node-side entry for the shared document schema. The implementation lives in web/document-core.js (a classic
// script so the canvas can load it with a <script> tag, like web/node-style.js and web/shaders.js); importing it
// here registers globalThis.VerynizeDocument, which this module re-exports for design-store.mjs and tests.
// The validator calls into BetterNodeStyle and BetterShaders, so those load first.
import "./node-style.mjs";
import "./shaders.mjs";
import "../web/document-core.js";

const api = globalThis.VerynizeDocument;
export const {
  validateDocument,
  normalizeDocument,
  resolveAliases,
  prepareDocument,
  documentProblems,
  validateAliases,
  isRoomAssetUrl,
  checkVariableValue,
  variableKind,
  NODE_TYPES,
  LAYOUTS,
  VARIABLE_TYPES,
  VARIABLE_NAME,
  BINDABLE,
  RESERVED_NAMES,
} = api;
export default api;
