// External destinations for the `?` help menu. The repository has no docs, contact, community or changelog URL yet,
// so these stay null and their menu items render disabled (in Wonder's order). Fill a URL in to enable an item; it
// opens through the desktop's validated `openExternal` (HTTP/HTTPS only).
export const HELP_LINKS: Record<"docs" | "contact" | "discord" | "whatsNew", string | null> = {
  docs: null,
  contact: null,
  discord: null,
  whatsNew: null,
};

export function openExternal(url: string) {
  const desktop = (
    window as unknown as { desktop?: { openExternal?: (url: string) => Promise<unknown> } }
  ).desktop;
  if (desktop?.openExternal) void desktop.openExternal(url).catch(() => undefined);
  else window.open(url, "_blank", "noopener,noreferrer");
}
