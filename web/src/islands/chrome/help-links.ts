// External destinations for the `?` help menu. Verynize has no docs, contact, community, changelog, feedback or
// diagnostics destination yet, so these are PLACEHOLDERS on the reserved `.example` domain (RFC 2606): every item is
// enabled but leads nowhere real. Replace each URL before release; a null value disables its item again. They open
// through the desktop's validated `openExternal` (HTTP/HTTPS only).
// TODO(help-links): replace the placeholder URLs.
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

// What's new entries listed above "View all" (Wonder T5-help: a title over a date, newest first). PLACEHOLDER: one
// entry pointing at the placeholder changelog until Verynize publishes release notes.
// TODO(help-links): replace with real release-note entries.
export type WhatsNewEntry = { id: string; title: string; date: string; url: string };
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "0.15",
    title: "What's new in Verynize 0.15",
    date: "October 31",
    url: "https://verynize.example/changelog/0.15",
  },
];

export function openExternal(url: string) {
  const desktop = (
    window as unknown as { desktop?: { openExternal?: (url: string) => Promise<unknown> } }
  ).desktop;
  if (desktop?.openExternal) void desktop.openExternal(url).catch(() => undefined);
  else window.open(url, "_blank", "noopener,noreferrer");
}
