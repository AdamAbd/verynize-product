// Node-side entry for the shader preset catalog. The implementation lives in web/shaders.js (a classic script the
// canvas and exported HTML load); importing it registers globalThis.BetterShaders, re-exported here.
import "../web/shaders.js";

const api = globalThis.BetterShaders;
export const {
  PRESETS,
  presetIds,
  COLOR_ROLES,
  PARAM_KEYS,
  presetOf,
  validate: shaderError,
  resolve: resolveShader,
  paramsAttr,
} = api;
export default api;

/** JSX attributes for a shader node: preset/speed/intensity plus data-shader-colors / data-shader-params (JSON). */
export function shaderJsxAttrs(node, escapeAttr) {
  const out = [
    `preset="${escapeAttr(node.shaderPreset || "aurora")}"`,
    `speed={${node.shaderSpeed ?? 1}}`,
    `intensity={${node.shaderIntensity ?? 1}}`,
  ];
  if (node.shaderColors && typeof node.shaderColors === "object")
    out.push(`data-shader-colors="${escapeAttr(JSON.stringify(node.shaderColors))}"`);
  if (node.shaderParams && typeof node.shaderParams === "object")
    out.push(`data-shader-params="${escapeAttr(JSON.stringify(node.shaderParams))}"`);
  return out;
}

const parseJson = (raw, label) => {
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new Error(`${label} must be JSON`);
  }
};

/**
 * Apply shader attributes parsed from JSX to a shader node. Unknown presets are ignored (as before); speed and
 * intensity are clamped; data-shader-colors / data-shader-params are validated (an empty value removes them).
 */
export function applyShaderAttrs(node, attrs) {
  if (presetIds.includes(attrs.preset)) node.shaderPreset = attrs.preset;
  if (Number.isFinite(attrs.speed)) node.shaderSpeed = Math.min(5, Math.max(0, attrs.speed));
  if (Number.isFinite(attrs.intensity))
    node.shaderIntensity = Math.min(2, Math.max(0, attrs.intensity));
  for (const [attr, key, label] of [
    ["data-shader-colors", "shaderColors", "data-shader-colors"],
    ["data-shader-params", "shaderParams", "data-shader-params"],
  ]) {
    if (!Object.hasOwn(attrs, attr)) continue;
    const raw = attrs[attr];
    if (raw === "" || raw === false) {
      delete node[key];
      continue;
    }
    const value = parseJson(raw, label);
    const error = shaderError({ [key]: value });
    if (error) throw new Error(error);
    node[key] = value;
  }
}
