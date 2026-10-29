// Window chrome (03/11/22/29): 40px bar, traffic-light inset, sidebar + chat toggles, Files tab, document tab,
// new file, search and the design/code mode switch. The bar drags the window; controls opt out (no-drag).
import { useRef, type KeyboardEvent } from "react";
import { Braces, File, LayoutGrid, MessageSquare, Palette, Search } from "lucide-react";
import { PanelLeftIcon, PlusIcon } from "@/components/icons";
import { activePage, legacy, legacySet, useBodyClass, useDesign } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { run } from "./legacy";
import { toggleBodyClass, useDialogOpen } from "./hooks";
import { Tip } from "./tip";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4";
const tab =
  "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-transparent pr-2.5 pl-2 text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0";
const tabActive = "border-tab-edge bg-input text-foreground hover:text-foreground";

export function TitleBar() {
  const doc = useDesign();
  const filesView = useBodyClass("files-view");
  const chatOpen = useBodyClass("agent-chat-open");
  const leftCollapsed = useBodyClass("left-collapsed");
  const codeMode = useDialogOpen("project-dialog");
  const nameRef = useRef<HTMLInputElement>(null);
  const page = doc ? activePage(doc) : null;

  const commitName = () => {
    const input = nameRef.current;
    const original = legacy<HTMLInputElement>("document-name");
    if (!input || !original) return;
    const value = input.value.trim() || "Untitled";
    if (value === doc?.name) {
      input.value = value;
      return;
    }
    legacySet(original, value);
  };
  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      event.currentTarget.value = doc?.name ?? "";
      event.currentTarget.blur();
    }
    event.stopPropagation();
  };

  return (
    <div
      role="banner"
      data-chrome-bar=""
      className={cn(
        "relative z-40 flex h-chrome shrink-0 items-center border-b border-divider bg-background pr-2 text-xs select-none",
        chatOpen ? "pl-chat" : "pl-traffic",
      )}
    >
      {!chatOpen && (
        <>
          <Tip label={leftCollapsed ? "Show sidebar" : "Hide sidebar"} side="bottom">
            <button
              type="button"
              id="chrome-sidebar"
              aria-label="Toggle sidebar"
              aria-pressed={!leftCollapsed}
              className={cn(iconButton, "ml-0.5")}
              onClick={() => toggleBodyClass("left-collapsed")}
            >
              <PanelLeftIcon />
            </button>
          </Tip>
          <Tip label="Chat" shortcut="⌘L" side="bottom">
            <button
              type="button"
              id="shell-chat"
              aria-label="Open agent chat"
              aria-pressed={chatOpen}
              className={cn(iconButton, "ml-0.5", chatOpen && "bg-accent text-foreground")}
              onClick={() => {
                const workspace = window.agentWorkspace as { openChat?: () => void; closeChat?: () => void } | undefined;
                if (document.body.classList.contains("agent-chat-open")) workspace?.closeChat?.();
                else workspace?.openChat?.();
              }}
            >
              <MessageSquare />
            </button>
          </Tip>
          <span aria-hidden="true" className="ml-1.5 h-4 w-px shrink-0 bg-divider" />
        </>
      )}

      <nav aria-label="Open files" className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          id="files-home"
          aria-current={filesView ? "page" : undefined}
          className={cn(tab, "ml-2.5", filesView && tabActive)}
          onClick={() => run("files-home")}
        >
          <LayoutGrid />
          Files
        </button>

        <div
          data-document-tab=""
          aria-current={filesView ? undefined : "page"}
          className={cn(tab, "min-w-0 shrink gap-0 pr-2.5", !filesView && tabActive)}
          onClick={() => {
            if (filesView) (window.fileLibrary as { showEditor?: () => void } | undefined)?.showEditor?.();
          }}
        >
          <File className="mr-1.5" />
          <input
            ref={nameRef}
            id="document-name"
            aria-label="Document name"
            defaultValue={doc?.name ?? "Untitled"}
            spellCheck={false}
            onBlur={commitName}
            onKeyDown={onNameKey}
            className="field-sizing-content h-5 max-w-tab-name min-w-6 truncate rounded-sm bg-transparent text-xs text-inherit outline-none focus:bg-background focus:text-foreground focus:ring-1 focus:ring-ring"
          />
          {page ? <span className="min-w-0 truncate">&nbsp;-&nbsp;{page.name}</span> : null}
        </div>

        <Tip label="New file" side="bottom">
          <button
            type="button"
            id="shell-new-file"
            aria-label="New file"
            className={cn(iconButton, "[&_svg]:size-3.5")}
            onClick={() => run("shell-new-file")}
          >
            <PlusIcon />
          </button>
        </Tip>
      </nav>

      <div className="min-w-4 flex-1 self-stretch" />

      <Tip label="Search" shortcut="⌘K" side="bottom">
        <button type="button" id="shell-search" aria-label="Search files" className={iconButton} onClick={() => run("shell-search")}>
          <Search />
        </button>
      </Tip>
      <div role="radiogroup" aria-label="Mode" className="ml-1 flex h-7 shrink-0 items-center rounded-full bg-muted p-0.5">
        <Tip label="Design" side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={!codeMode}
            aria-label="Design"
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-foreground-3 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
              !codeMode && "bg-accent text-foreground",
            )}
            onClick={() => {
              const dialog = document.getElementById("project-dialog") as HTMLDialogElement | null;
              if (dialog?.open) dialog.close();
            }}
          >
            <Palette />
          </button>
        </Tip>
        <Tip label="Code" side="bottom">
          <button
            type="button"
            role="radio"
            aria-checked={codeMode}
            aria-label="Code"
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-foreground-3 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
              codeMode && "bg-accent text-foreground",
            )}
            onClick={() => (window.agentWorkspace as { openProject?: () => void } | undefined)?.openProject?.()}
          >
            <Braces />
          </button>
        </Tip>
      </div>
    </div>
  );
}
