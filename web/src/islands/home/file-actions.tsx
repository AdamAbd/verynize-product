import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  PencilIcon,
} from "lucide-react";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "./menu";
import { cn } from "@/lib/utils";
import { hook, library, type LibraryFile, type LibraryFolder } from "./library";

export type FileActionHandlers = {
  rename(file: LibraryFile): void;
  newFolderFor(file: LibraryFile): void;
};

/** Card / row action menu: Rename, Duplicate, Move to folder, Archive / Restore. */
export function FileActions({
  file,
  folders,
  handlers,
  className,
}: {
  file: LibraryFile;
  folders: LibraryFolder[];
  handlers: FileActionHandlers;
  className?: string;
}) {
  const lib = library();
  return (
    <MenuRoot modal={false}>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${file.name}`}
          className={cn(
            hook("file-actions"),
            "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:opacity-100",
            className,
          )}
        >
          <EllipsisIcon className="size-4" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="w-44">
        <MenuItem onSelect={() => handlers.rename(file)}>
          <PencilIcon />
          Rename
        </MenuItem>
        <MenuItem onSelect={() => lib.duplicate(file.id)}>
          <CopyIcon />
          Duplicate
        </MenuItem>
        <MenuSub>
          <MenuSubTrigger>
            <FolderInputIcon />
            Move to folder
          </MenuSubTrigger>
          <MenuSubContent className="w-44">
            <MenuItem onSelect={() => lib.move(file.id, null)}>
              <FolderIcon />
              <span className="flex-1">Files</span>
              {!file.folder && <CheckIcon />}
            </MenuItem>
            {folders.map((folder) => (
              <MenuItem key={folder.id} onSelect={() => lib.move(file.id, folder.id)}>
                <FolderIcon />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                {file.folder === folder.id && <CheckIcon />}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => handlers.newFolderFor(file)}>
              <FolderPlusIcon />
              New folder…
            </MenuItem>
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        <MenuItem onSelect={() => lib.setArchived(file.id, !file.archived)}>
          {file.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {file.archived ? "Restore" : "Archive"}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
