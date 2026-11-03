// The primary shortcut modifier for Playwright key presses: Cmd on macOS, Ctrl elsewhere (the app reads
// `mod` the same way, from navigator.platform: web/canvas-interactions.js, web/src/islands/chrome/shortcuts.ts).
// `mod('KeyZ')` → 'Meta+KeyZ' on macOS, 'Control+KeyZ' on Linux. MOD_LABEL is the keycap the UI draws for `mod`
// where it is platform-aware (shortcut drawer, command palette).
const MAC = process.platform === "darwin";
const MOD = MAC ? "Meta" : "Control";
const MOD_LABEL = MAC ? "⌘" : "Ctrl";
const mod = (key) => `${MOD}+${key}`;

module.exports = { MAC, MOD, MOD_LABEL, mod };
