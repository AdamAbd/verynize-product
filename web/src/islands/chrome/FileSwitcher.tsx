// File switcher ("Search files...", opened by the title bar + and the file tab menu's New Tab): a New file row,
// the open file's preview frames (Previews: frame name, "<worktree> · <status>") and the library's files by last
// edit (Recents, with thumbnails). Same surface as the ⌘K palette; ↓ ↑ move, ↵ opens and closes, Esc closes.
import { useMemo, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Command as Cmdk } from "cmdk";
import { AppWindow, Search } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { library, type LibraryFile } from "../home/library";
import { Thumbnail } from "../home/thumbnail";
import { Keycap } from "./CommandPalette";
import { openFileTab } from "./file-tabs";
import { run } from "./legacy";
import { open as openPreviewTab, previewFrames, type PreviewTabStatus } from "./preview-tab/store";
import { setPanelOpen, usePanelOpen } from "./shortcuts";

const RECENT_LIMIT = 8;
const STATUS: Record<PreviewTabStatus, string> = {
  running: "Running",
  starting: "Starting",
  stopped: "Stopped",
  error: "Error",
};

export const openFileSwitcher = () => setPanelOpen("files", true);

export function FileSwitcher() {
  return usePanelOpen("files") ? <Switcher /> : null;
}

const row =
  "flex cursor-default items-center gap-3 rounded-lg px-3 text-base text-foreground-2 outline-none select-none data-[selected=true]:bg-command-palette-highlight";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Cmdk.Group value={title} data-switcher-section={title}>
      <div className="flex h-palette-heading items-end px-3 pb-2 text-xs text-subtle-foreground">
        {title}
      </div>
      {children}
    </Cmdk.Group>
  );
}

function Switcher() {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const files = useMemo(
    () =>
      library()
        .list()
        .filter((file: LibraryFile) => !file.archived && !file.invalid)
        .sort((a, b) => b.updated - a.updated),
    [],
  );
  const previews = useMemo(previewFrames, []);
  const close = () => setPanelOpen("files", false);
  // After the dialog has closed and returned focus, so the editor sees the normal focus state.
  const choose = (action: () => void) => {
    close();
    requestAnimationFrame(action);
  };
  const recents = searching ? files : files.slice(0, RECENT_LIMIT);
  return (
    <Dialog.Root open onOpenChange={(value) => setPanelOpen("files", value)}>
      <Dialog.Portal container={portalContainer()}>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-command-palette-scrim" />
        <Dialog.Content
          id="file-switcher"
          className="fixed top-palette-top left-1/2 z-50 flex max-h-palette-height w-palette -translate-x-1/2 flex-col overflow-hidden rounded-palette bg-command-palette text-base text-foreground-2 shadow-palette outline-none"
        >
          <Dialog.Title className="sr-only">Search files</Dialog.Title>
          <Dialog.Description className="sr-only">
            Open a file or a preview, or start a new file
          </Dialog.Description>
          <Cmdk className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-palette-input shrink-0 items-center gap-2 px-2.5 shadow-palette-input">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <Cmdk.Input
                id="file-switcher-input"
                value={query}
                onValueChange={setQuery}
                placeholder="Search files..."
                className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground-2 outline-none placeholder:text-subtle-foreground"
              />
            </div>
            <Cmdk.List className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
              <Cmdk.Empty className="py-6 text-center text-muted-foreground">No files</Cmdk.Empty>
              <Cmdk.Item
                value="new file"
                data-switcher-new=""
                onSelect={() => choose(() => run("shell-new-file"))}
                className={cn(row, "h-8")}
              >
                <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">New file</span>
                <span className="ml-auto shrink-0 truncate text-muted-foreground">
                  Start a design file
                </span>
              </Cmdk.Item>
              {previews.length ? (
                <Section title="Previews">
                  {previews.map((preview) => (
                    <Cmdk.Item
                      key={preview.frameId}
                      value={`${preview.title} ${preview.name} preview:${preview.frameId}`}
                      data-switcher-preview={preview.frameId}
                      onSelect={() => choose(() => openPreviewTab(preview.frameId))}
                      className={cn(row, "h-8")}
                    >
                      <AppWindow className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{preview.title}</span>
                      <span className="ml-auto shrink-0 truncate text-muted-foreground">
                        {preview.name} · {STATUS[preview.status]}
                      </span>
                    </Cmdk.Item>
                  ))}
                </Section>
              ) : null}
              {recents.length ? (
                <Section title={searching ? "Files" : "Recents"}>
                  {recents.map((file) => (
                    <Cmdk.Item
                      key={file.id}
                      value={`${file.name} file:${file.id}`}
                      data-switcher-file={file.id}
                      onSelect={() => choose(() => openFileTab(file.id))}
                      className={cn(row, "h-10 px-1")}
                    >
                      <Thumbnail
                        file={file}
                        compact
                        className="h-7 w-11 shrink-0 rounded-sm border border-command-palette-edge"
                      />
                      <span data-switcher-name="" className="min-w-0 truncate">
                        {file.name}
                      </span>
                    </Cmdk.Item>
                  ))}
                </Section>
              ) : null}
            </Cmdk.List>
            <div className="flex h-palette-footer shrink-0 items-center justify-end gap-4 bg-command-palette-footer px-5 text-base text-subtle-foreground shadow-palette-footer">
              <span className="flex items-center gap-1.5">
                Navigate
                <Keycap footer>↓</Keycap>
                <Keycap footer>↑</Keycap>
              </span>
              <span className="h-4 w-px bg-command-palette-edge" />
              <span className="flex items-center gap-1.5">
                Open
                <Keycap footer>↵</Keycap>
              </span>
              <span className="h-4 w-px bg-command-palette-edge" />
              <span className="flex items-center gap-1.5">
                Close
                <Keycap footer>Esc</Keycap>
              </span>
            </div>
          </Cmdk>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
