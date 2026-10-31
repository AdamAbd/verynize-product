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

export function openExternal(url: string) {
  const desktop = (
    window as unknown as { desktop?: { openExternal?: (url: string) => Promise<unknown> } }
  ).desktop;
  if (desktop?.openExternal) void desktop.openExternal(url).catch(() => undefined);
  else window.open(url, "_blank", "noopener,noreferrer");
}
