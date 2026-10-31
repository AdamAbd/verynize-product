// External destinations for the `?` help menu. Verynize has no docs, contact, community, changelog, feedback or
// diagnostics destination yet, so these are PLACEHOLDERS on the reserved `.example` domain (RFC 2606): every item is
// enabled but leads nowhere real. Replace each URL before release; a null value disables its item again. They open
// through the desktop's validated `openExternal` (HTTP/HTTPS only).
// TODO(help-links): replace the placeholder URLs.
import { can, platform } from "@/lib/platform";
export const HELP_LINKS: Record<
  "docs" | "feedback" | "contact" | "discord" | "diagnostics" | "whatsNew",
  string | null
> = {
  docs: "https://verynize.example/docs",
  feedback: "https://verynize.example/feedback",
  contact: "https://verynize.example/contact",
  discord: "https://verynize.example/discord",
  diagnostics: "https://verynize.example/support/diagnostics",
  whatsNew: "https://verynize.example/changelog",
};

// What's new entries listed above "View all" (Wonder T5-help: a short title over a date, newest first, e.g.
// "Wonder Capture / August 18"). PLACEHOLDER: one entry for the current release pointing at the placeholder
// changelog until Verynize publishes release notes.
// TODO(help-links): replace with real release-note entries.
export type WhatsNewEntry = { id: string; title: string; date: string; url: string };
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "0.17",
    title: "Verynize 0.17",
    date: "October 31",
    url: "https://verynize.example/changelog/0.17",
  },
];

export function openExternal(url: string) {
  if (can("externalLinks")) void platform.desktop?.openExternal(url).catch(() => undefined);
  else window.open(url, "_blank", "noopener,noreferrer");
}
