import { FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileActions, type FileActionHandlers } from "./file-actions";
import { hook, library, relativeDay, type LibraryFile, type LibraryFolder } from "./library";
import { Thumbnail } from "./thumbnail";
import { Avatar, Badge } from "./workspace-switcher";

type ViewProps = {
  files: LibraryFile[];
  folders: LibraryFolder[];
  shownFolders: LibraryFolder[];
  allFiles: LibraryFile[];
  owner: string;
  handlers: FileActionHandlers;
};

const open = (file: LibraryFile) => void library().open(file.id);
const enter = (folder: LibraryFolder) => library().setFolder(folder.id);
const countIn = (files: LibraryFile[], folder: LibraryFolder) =>
  files.filter((f) => f.folder === folder.id && !f.archived).length;

/* ---------- Grid (design/wonder/03): 285 × 236 cards, 174px thumbnail ---------- */
export function FileGrid({ files, folders, shownFolders, allFiles, owner, handlers }: ViewProps) {
  return (
    <div className="flex flex-col gap-6">
      {shownFolders.length > 0 && (
        <div className="grid grid-cols-(--home-grid-cols) gap-6">
          {shownFolders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => enter(folder)}
              className="flex h-14 min-w-0 items-center gap-3 rounded-lg border border-card-border bg-card px-3 text-left outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground-2">
                {folder.name}
              </span>
              <span className="text-sm text-muted-foreground">{countIn(allFiles, folder)}</span>
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="grid grid-cols-(--home-grid-cols) gap-6">
          {files.map((file) => (
            <article
              key={file.id}
              data-file-id={file.id}
              className={cn(
                hook("file-card"),
                "group relative flex h-59 min-w-0 flex-col overflow-hidden rounded-lg border border-card-border bg-card",
              )}
            >
              <button
                type="button"
                aria-label={`Open ${file.name}`}
                onClick={() => open(file)}
                className={cn(
                  hook("file-open"),
                  "flex min-h-0 flex-1 flex-col bg-transparent p-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                <Thumbnail
                  file={file}
                  className="h-43.5 w-full shrink-0 border-b border-card-border"
                />
                <span className="flex flex-col px-3 pt-2.5">
                  <strong className="truncate pr-7 text-sm font-normal text-foreground-2">
                    {file.name}
                  </strong>
                  <span className="mt-0.5 flex h-5 items-center gap-1.5 text-sm text-muted-foreground">
                    <Avatar name={owner} className="size-4 text-2xs" />
                    Personal
                    {file.publication && <Badge className="ml-1">Public</Badge>}
                  </span>
                </span>
              </button>
              <FileActions
                file={file}
                folders={folders}
                handlers={handlers}
                className="absolute right-2 bottom-7"
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- List (design/wonder/04): Name / Visibility / Active users / Last edited at ---------- */
export function FileList({ files, folders, shownFolders, allFiles, handlers }: ViewProps) {
  const row = "grid h-14 grid-cols-(--home-list-cols) items-center";
  return (
    <div className="flex flex-col">
      <div className={cn(row, "h-5 text-sm text-muted-foreground")} role="presentation">
        <span>Name</span>
        <span>Visibility</span>
        <span>Active users</span>
        <span>Last edited at</span>
      </div>
      <div className="mt-1.5 flex flex-col">
        {shownFolders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => enter(folder)}
            className={cn(
              row,
              "-mx-2 rounded-lg px-2 text-left outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md border border-card-border bg-card">
                <FolderIcon className="size-4 text-muted-foreground" />
              </span>
              <span className="truncate text-sm text-foreground-2">{folder.name}</span>
            </span>
            <span className="text-sm text-muted-foreground">Folder</span>
            <span />
            <span className="text-sm text-muted-foreground">{countIn(allFiles, folder)} files</span>
          </button>
        ))}
        {files.map((file) => (
          <article
            key={file.id}
            data-file-id={file.id}
            className={cn(hook("file-card"), "group relative -mx-2 rounded-lg px-2 hover:bg-muted")}
          >
            <button
              type="button"
              aria-label={`Open ${file.name}`}
              onClick={() => open(file)}
              className={cn(
                hook("file-open"),
                row,
                "w-full bg-transparent p-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Thumbnail
                  file={file}
                  compact
                  className="h-9 w-14 shrink-0 rounded-md border border-card-border"
                />
                <strong className="truncate text-sm font-normal text-foreground-2">
                  {file.name}
                </strong>
              </span>
              <span className="flex">
                <span className="flex h-5 items-center rounded-md border border-edge bg-muted px-1.5 text-sm text-foreground-2">
                  {file.publication ? "Public" : "Private"}
                </span>
              </span>
              <span />
              <span className="text-sm text-foreground-2">{relativeDay(file.updated)}</span>
            </button>
            <FileActions
              file={file}
              folders={folders}
              handlers={handlers}
              className="absolute top-1/2 right-2 -translate-y-1/2"
            />
          </article>
        ))}
      </div>
    </div>
  );
}
