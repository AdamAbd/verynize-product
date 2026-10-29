import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { library, type LibraryFile } from "./library";

/** Fits the legacy miniature (makeThumbnail in wonder-shell.js) into the box, centred on the page content. */
export function Thumbnail({
  file,
  className,
  compact = false,
}: {
  file: LibraryFile;
  className?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const doc = file.document;
    const page = doc.pages.find((p) => p.id === doc.activePage) ?? doc.pages[0];
    const roots = (page?.nodes ?? []).filter((n) => !n.parentId).slice(0, 35);
    const legacy = library().thumbnail(file.id);
    const artboard = legacy?.querySelector<HTMLElement>(".thumbnail-artboard");
    if (!artboard || !roots.length) {
      setEmpty(true);
      box.replaceChildren();
      return;
    }
    setEmpty(false);
    const minX = Math.min(...roots.map((n) => n.x));
    const minY = Math.min(...roots.map((n) => n.y));
    const maxX = Math.max(...roots.map((n) => n.x + n.w));
    const maxY = Math.max(...roots.map((n) => n.y + n.h));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    // Drop the legacy class so wonder-shell/parity thumbnail CSS cannot leak in; place the artboard ourselves.
    artboard.className = "";
    Object.assign(artboard.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `${maxX}px`,
      height: `${maxY}px`,
      transformOrigin: "0 0",
      background: "transparent",
      pointerEvents: "none",
    });
    const fit = () => {
      const pad = compact ? 4 : 20;
      const scale = Math.min(
        (box.clientWidth - pad * 2) / width,
        (box.clientHeight - pad * 2) / height,
        compact ? 1 : 2,
      );
      const tx = (box.clientWidth - width * scale) / 2 - minX * scale;
      const ty = (box.clientHeight - height * scale) / 2 - minY * scale;
      artboard.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    box.replaceChildren(artboard);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [file, compact]);

  return (
    <div className={cn("relative overflow-hidden bg-background", className)}>
      <div ref={ref} className="absolute inset-0" aria-hidden="true" />
      {empty && <EmptyMark compact={compact} />}
    </div>
  );
}

/* Faint outlined app mark, like Wonder's empty file thumbnail. */
function EmptyMark({ compact }: { compact: boolean }) {
  return (
    <svg
      viewBox="0 0 120 84"
      aria-hidden="true"
      className={cn(
        "absolute left-1/2 -translate-x-1/2 fill-none stroke-edge",
        compact ? "bottom-0 h-6 w-9 stroke-2" : "bottom-0 h-36 w-52",
      )}
    >
      <path d="M8 84C3 66 2 44 6 30 10 14 24 4 38 8c8 2 14 8 16 14 4-8 10-14 18-14 8 0 14 6 18 14 2-6 8-12 16-14 14-4 28 6 32 22 4 14 3 36-2 54" />
      <ellipse cx="44" cy="66" rx="8" ry="16" />
      <ellipse cx="76" cy="66" rx="8" ry="16" />
    </svg>
  );
}
