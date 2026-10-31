// Screen templates for live preview frames (preview audit PF4/PF6, design/wonder/preview-audit/wonder/PF4-presets.png).
// The names and viewport sizes are the labels Wonder lists in its Screen template dropdown, in the same order; they
// are viewport presets, not claims about real devices. `window.previewPresets` exposes the list to the legacy
// renderer (web/live-preview.js reads the default size when it creates a preview frame).

export type PreviewKind = "phone" | "tablet" | "laptop" | "desktop" | "tv";
export type PreviewPreset = {
  name: string;
  w: number;
  h: number;
  kind: PreviewKind;
  default?: true;
};

export const PREVIEW_PRESETS: readonly PreviewPreset[] = [
  { name: "iPhone 17", w: 402, h: 874, kind: "phone" },
  { name: "iPhone 18 Pro", w: 402, h: 874, kind: "phone" },
  { name: "iPhone Air", w: 420, h: 912, kind: "phone" },
  { name: "iPhone 18 Pro Max", w: 440, h: 956, kind: "phone" },
  { name: "iPhone Duo Folded", w: 466, h: 678, kind: "phone" },
  { name: "iPhone Duo Open", w: 626, h: 890, kind: "phone" },
  { name: 'iPad Air 11"', w: 820, h: 1180, kind: "tablet" },
  { name: 'iPad Mini 8.3"', w: 744, h: 1133, kind: "tablet" },
  { name: "MacBook Air", w: 1280, h: 832, kind: "laptop" },
  { name: 'MacBook Pro 14"', w: 1512, h: 982, kind: "laptop", default: true },
  { name: 'MacBook Pro 16"', w: 1728, h: 1117, kind: "laptop" },
  { name: "Desktop", w: 1920, h: 1080, kind: "desktop" },
  { name: "TV", w: 3840, h: 2160, kind: "tv" },
];

export const DEFAULT_PREVIEW_PRESET = PREVIEW_PRESETS.find((p) => p.default)!;

const fits = (p: PreviewPreset, w: number, h: number) =>
  (p.w === w && p.h === h) || (p.w === h && p.h === w);

/**
 * The template a frame of `w × h` shows: the stored template when it still fits (either orientation, so two templates
 * with the same size stay distinguishable), else the first template of that size, else null ("Custom").
 */
export function matchPreset(w: number, h: number, stored?: unknown): PreviewPreset | null {
  const named = PREVIEW_PRESETS.find((p) => p.name === stored);
  if (named && fits(named, w, h)) return named;
  return PREVIEW_PRESETS.find((p) => fits(p, w, h)) ?? null;
}

(window as unknown as { previewPresets?: readonly PreviewPreset[] }).previewPresets =
  PREVIEW_PRESETS;
