// "Pages" section: add page (`#add-page`, taken over from the legacy panel), page rows, rename/delete.
import { useRef } from "react";
import { File } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { design } from "@/lib/bridge";
import { useDocSummary, type PageInfo } from "./hooks";
import { PageRowMenu, RowMenuRoot, RowMenuTrigger } from "../context-menu/RowMenus";
import { cn } from "@/lib/utils";
import { IconButton, SectionHeader } from "./parts";
import { runLegacy, useTakeOver } from "./legacy";
import { contract } from "./contract";

/** Legacy rename/delete act on the active page, so activate the row's page first. */
function withPage(id: string, command: "rename-page" | "delete-page") {
  design().setActivePage(id);
  runLegacy(command);
}

function PageRow({ page, active, canDelete }: { page: PageInfo; active: boolean; canDelete: boolean }) {
  return (
    <RowMenuRoot>
      <RowMenuTrigger asChild>
        <button
          type="button"
          data-page-id={page.id}
          aria-current={active ? "page" : undefined}
          className={cn(
            contract("page-row", active && "active"),
            "flex h-7.5 w-full shrink-0 items-center rounded-md bg-transparent pr-3 pl-5.75 text-left text-xs text-foreground-2 hover:bg-muted",
            active && "bg-row hover:bg-row",
          )}
          onClick={() => design().setActivePage(page.id)}
          onDoubleClick={() => withPage(page.id, "rename-page")}
        >
          <File className="size-4 shrink-0 text-foreground" />
          <span className="ml-2.5 truncate">{page.name}</span>
        </button>
      </RowMenuTrigger>
      <PageRowMenu
        canDelete={canDelete}
        onRename={() => withPage(page.id, "rename-page")}
        onDelete={() => withPage(page.id, "delete-page")}
      />
    </RowMenuRoot>
  );
}

export function PagesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const doc = useDocSummary();
  const addRef = useRef<HTMLButtonElement>(null);
  useTakeOver("add-page", addRef);

  return (
    <section aria-label="Pages" className="shrink-0 border-b border-divider">
      <SectionHeader title="Pages" open={open} onToggle={onToggle} controls="bd-page-list">
        <IconButton ref={addRef} label="Add page" onClick={() => runLegacy("add-page")}>
          <PlusIcon className="size-4" />
        </IconButton>
      </SectionHeader>
      <div id="bd-page-list" hidden={!open} className="flex flex-col gap-0.5 px-1.5 pb-1.5">
        {doc.pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            active={page.id === doc.activePage}
            canDelete={doc.pages.length > 1}
          />
        ))}
      </div>
    </section>
  );
}
