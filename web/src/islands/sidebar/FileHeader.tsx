// 40px file header: app menu trigger (menu rendered by the chrome island), file name, visibility, collapse.
import { useState } from "react";
import { Globe, Lock } from "lucide-react";
import { legacy, legacySet } from "@/lib/bridge";
import { runLegacy } from "./legacy";
import { useDocSummary } from "./hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconButton, InlineRename } from "./parts";
import { contract } from "./contract";
import { LogoIcon, PanelLeftIcon } from "@/components/icons";

function openAppMenu(anchor: HTMLElement) {
  window.dispatchEvent(new CustomEvent("bd:open-app-menu", { detail: { anchor } }));
}

/** Rename the document through the legacy `#document-name` field (undoable, persists like a user edit). */
function renameDocument(name: string) {
  legacySet(legacy<HTMLInputElement>("document-name"), name);
}

/** Live cloud room state from the legacy share panel (cloud-panel.js); otherwise the file is private. */
function isShared() {
  const cloud = (window as unknown as { cloudWorkspace?: { isConnected?: () => boolean } }).cloudWorkspace;
  return Boolean(cloud?.isConnected?.());
}

export function FileHeader({ onCollapse }: { onCollapse: () => void }) {
  const doc = useDocSummary();
  const [renaming, setRenaming] = useState(false);
  const name = doc.name || "Untitled";
  const shared = isShared();
  const visibilityLabel = shared ? "Shared file · Share settings" : "Private file · Share";

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-divider pr-3 pl-1.5">
      <button
        type="button"
        aria-label="Main menu"
        aria-haspopup="menu"
        className={cn(
          contract("app-menu-trigger"),
          "inline-flex size-6.5 shrink-0 items-center justify-center rounded-md bg-transparent text-foreground hover:bg-muted",
        )}
        onClick={(e) => {
          e.stopPropagation();
          openAppMenu(e.currentTarget);
        }}
      >
        <LogoIcon className="size-4" />
      </button>
      <div className="ml-1.75 flex min-w-0 flex-1 items-center">
        {renaming ? (
          <InlineRename
            value={name}
            label="File name"
            onCommit={renameDocument}
            onDone={() => setRenaming(false)}
            className="-ml-1.5"
          />
        ) : (
          <span
            id="bd-sidebar-file-name"
            title="Double-click to rename"
            className="truncate text-xs text-foreground select-none"
            onDoubleClick={() => setRenaming(true)}
          >
            {name}
          </span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={visibilityLabel}
            className="ml-2 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-input text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => runLegacy("cloud-toggle")}
          >
            {shared ? <Globe className="size-3" /> : <Lock className="size-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{shared ? "Shared · Share settings" : "Private · Share"}</TooltipContent>
      </Tooltip>
      <IconButton label="Hide sidebar" className="ml-2.75 text-muted-foreground" onClick={onCollapse}>
        <PanelLeftIcon className="size-4" />
      </IconButton>
    </div>
  );
}
