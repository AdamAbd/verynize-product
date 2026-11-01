// The settings sections a /settings/<section> URL can name, shared by the shell router (desktop) and the Start
// settings route (web). Unknown sections show, and canonicalize to, the default one.
import type { SectionId } from "@/islands/settings/api";

export const SETTINGS_SECTIONS: readonly SectionId[] = [
  "account",
  "preferences",
  "agents",
  "accounts",
  "tools",
  "projects",
  "usage",
  "models",
  "connections",
  "memory",
  "members",
  "permissions",
];
export const DEFAULT_SETTINGS_SECTION: SectionId = "preferences";
export const isSettingsSection = (value: unknown): value is SectionId =>
  SETTINGS_SECTIONS.includes(value as SectionId);
/** The section a URL segment stands for (`undefined` for bare /settings). */
export const settingsSection = (value: unknown): SectionId =>
  isSettingsSection(value) ? value : DEFAULT_SETTINGS_SECTION;
