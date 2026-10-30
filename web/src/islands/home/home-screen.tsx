import { useMemo, useState } from "react";
import {
  ArchiveIcon,
  FileIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  LayoutListIcon,
  SearchIcon,
} from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { useBodyClass } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { mergeCloudFiles, useCloudRooms } from "./cloud-files";
import { FileGrid, FileList } from "./file-views";
import type { FileActionHandlers } from "./file-actions";
import {
  hook,
  library,
  useLibrary,
  useWorkspaceName,
  visibleFiles,
  type Filter,
  type LibraryFile,
} from "./library";
import { HomeButton } from "./menu";
import { NameDialog, type NameRequest } from "./name-dialog";
import { WorkspaceSwitcher } from "./workspace-switcher";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "public", label: "Public" },
  { id: "private", label: "Private" },
  { id: "archived", label: "Archived" },
];

export function HomeScreen() {
  const open = useBodyClass("files-view");
  const { files: all, folders, folder } = useLibrary(open);
  const owner = useWorkspaceName();
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState(false);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<NameRequest | null>(null);

  const lib = library();
  const { rooms } = useCloudRooms(open);
  const files = useMemo(
    () => visibleFiles(mergeCloudFiles(all, rooms), filter, folder, query),
    [all, rooms, filter, folder, query],
  );
  const shownFolders = filter !== "archived" && !query.trim() && !folder ? folders : [];
  const currentFolder = folders.find((f) => f.id === folder);

  const newFolder = (then?: (id: string) => void) =>
    setDialog({
      title: "New folder",
      label: "Folder name",
      value: "",
      placeholder: "Folder name",
      submit: "Create",
      onSubmit: (name) => {
        const id = lib.createFolder(name);
        if (id) then?.(id);
      },
    });
  const handlers: FileActionHandlers = {
    rename: (file: LibraryFile) =>
      setDialog({
        title: "Rename file",
        label: "File name",
        value: file.name,
        submit: "Rename",
        onSubmit: (name) => lib.rename(file.id, name),
      }),
    newFolderFor: (file: LibraryFile) => newFolder((id) => lib.move(file.id, id)),
  };

  const empty = !files.length && !shownFolders.length;
  const View = list ? FileList : FileGrid;

  return (
    <div className="mx-auto flex max-w-7xl flex-col px-8 pt-8 pb-16 text-sm">
      {/* Heading: workspace / Files [/ folder] · New folder · New file */}
      <div className="flex h-8 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center">
          <WorkspaceSwitcher name={owner} />
          <span className="mx-2 text-lg text-subtle-foreground" aria-hidden="true">
            /
          </span>
          {currentFolder ? (
            <>
              <button
                type="button"
                onClick={() => lib.setFolder(null)}
                className="rounded-md px-1 text-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                Files
              </button>
              <span id="folder-breadcrumb" className="flex min-w-0 items-center">
                <span className="mx-2 text-lg text-subtle-foreground" aria-hidden="true">
                  /
                </span>
                <h1 className="truncate text-lg text-foreground">{currentFolder.name}</h1>
              </span>
            </>
          ) : (
            <h1 className="px-1 text-lg text-foreground">Files</h1>
          )}
        </div>
        <HomeButton id="library-new-folder" onClick={() => newFolder()}>
          <FolderPlusIcon />
          New folder
        </HomeButton>
        <HomeButton
          id="library-new-file"
          variant="primary"
          className="-ml-0.5"
          onClick={() => void lib.create()}
        >
          <PlusIcon />
          New file
        </HomeButton>
      </div>

      {/* Filter bar */}
      <div className="mt-8 flex h-7 items-center gap-2">
        <div role="group" aria-label="Filter files" className="flex h-7 rounded-md bg-muted">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              data-filter={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "h-7 rounded-md px-2.5 text-sm text-muted-foreground outline-none hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring",
                filter === id && "bg-accent text-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div role="group" aria-label="Layout" className="flex h-7 rounded-md bg-muted">
          <button
            id="library-grid"
            type="button"
            aria-label="Grid view"
            aria-pressed={!list}
            onClick={() => setList(false)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
              !list && "bg-accent text-foreground",
            )}
          >
            <LayoutGridIcon className="size-3.5" />
          </button>
          <button
            id="library-list"
            type="button"
            aria-label="List view"
            aria-pressed={list}
            onClick={() => setList(true)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
              list && "bg-accent text-foreground",
            )}
          >
            <LayoutListIcon className="size-3.5" />
          </button>
        </div>
        <label className="relative flex h-7 w-76 shrink items-center">
          <SearchIcon className="pointer-events-none absolute left-2 size-3.5 text-subtle-foreground" />
          <input
            id="library-search"
            type="search"
            aria-label="Search designs"
            placeholder="Search..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            className="h-7 w-full rounded-md border border-card-border bg-card pr-2 pl-7 text-sm text-foreground outline-none focus-visible:border-edge"
          />
        </label>
      </div>

      {/* Files. `#library-files` keeps the legacy contract: class is exactly "list" in list view. */}
      <div id="library-files" className={list ? hook("list") : undefined}>
        <div className="mt-12">
          {empty ? (
            <EmptyState filter={filter} query={query} inFolder={!!folder} />
          ) : (
            <View
              files={files}
              folders={folders}
              shownFolders={shownFolders}
              allFiles={all}
              owner={owner}
              handlers={handlers}
            />
          )}
        </div>
      </div>

      <NameDialog request={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function EmptyState({
  filter,
  query,
  inFolder,
}: {
  filter: Filter;
  query: string;
  inFolder: boolean;
}) {
  const Icon = filter === "archived" && !query ? ArchiveIcon : FileIcon;
  const text = query.trim()
    ? "No matching files or layers"
    : filter === "archived"
      ? "Archived files will appear here"
      : filter === "public"
        ? "Published files will appear here"
        : inFolder
          ? "This folder is empty"
          : "Create a file to start designing";
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <Icon className="size-8 text-subtle-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
      {!query.trim() && filter !== "archived" && filter !== "public" && (
        <HomeButton onClick={() => void library().create()}>
          <PlusIcon />
          New file
        </HomeButton>
      )}
    </div>
  );
}
