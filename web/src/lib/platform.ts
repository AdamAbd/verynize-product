// What this runtime can do: the typed view of `window.verynizePlatform` (web/platform.js). Islands import
// `platform` / `can` from here instead of probing `window.desktop`; legacy scripts read `window.verynizePlatform`
// (same object). The import below registers it when the page did not load web/platform.js first (an island built
// alone, another host page); it never replaces an existing one.
import "../../platform.js";
import type { DesktopApi } from "./desktop-api";

export type { DesktopApi } from "./desktop-api";

/** Capability names; tests/platform-contract.cjs checks them against CAPABILITY_METHODS in web/platform.js. */
export const CAPABILITIES = [
  "projects",
  "git",
  "designFiles",
  "agents",
  "agentAccounts",
  "terminal",
  "devServer",
  "livePreview",
  "rasterExport",
  "codeExport",
  "imageGeneration",
  "figma",
  "htmlImport",
  "templatePacks",
  "webCapture",
  "publishApps",
  "passkeyWindow",
  "localFonts",
  "notifications",
  "externalLinks",
  "agentBridge",
  "onboarding",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Platform = {
  readonly kind: "desktop" | "web";
  /** `window.desktop` (desktop/preload.cjs), null in the plain web build. */
  readonly desktop: DesktopApi | null;
  readonly capabilities: Readonly<Record<Capability, boolean>>;
  can(capability: Capability): boolean;
  /** Preload methods behind each capability (dotted paths). */
  readonly CAPABILITY_METHODS: Readonly<Record<Capability, readonly string[]>>;
};

declare global {
  var verynizePlatform: Platform;
}

export const platform: Platform = globalThis.verynizePlatform;
export const can = (capability: Capability) => platform.can(capability);
/** The desktop bridge, or null outside the desktop app. */
export const desktopApi = () => platform.desktop;
