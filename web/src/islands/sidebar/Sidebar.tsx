// Left sidebar (contents of aside#layer-panel): file header, Pages, Layers.
import { useEffect, useState } from "react";
import { useBodyClass } from "@/lib/bridge";
import { FileHeader } from "./FileHeader";
import { PagesSection } from "./PagesSection";
import { LayersSection } from "./LayersSection";

const STORAGE_KEY = "bd-sidebar-sections";

function loadSections(): { pages: boolean; layers: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved.pages === "boolean" && typeof saved.layers === "boolean") return saved;
  } catch {
    /* ignore corrupt preference */
  }
  return { pages: true, layers: true };
}

export function Sidebar() {
  const collapsed = useBodyClass("left-collapsed");
  const chatOpen = useBodyClass("agent-chat-open");
  const [sections, setSections] = useState(loadSections);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sections));
    } catch {
      /* storage full: the preference is cosmetic */
    }
  }, [sections]);

  // Stay mounted while hidden: `#layer-search` / `#add-page` must exist for legacy code and tests.
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-xs text-foreground-2" hidden={collapsed || chatOpen}>
      <FileHeader onCollapse={() => document.body.classList.add("left-collapsed")} />
      <PagesSection open={sections.pages} onToggle={() => setSections((s) => ({ ...s, pages: !s.pages }))} />
      <LayersSection open={sections.layers} onToggle={() => setSections((s) => ({ ...s, layers: !s.layers }))} />
    </div>
  );
}
