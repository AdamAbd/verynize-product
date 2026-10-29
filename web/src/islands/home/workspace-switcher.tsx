import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from "./menu";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-tint text-2xs font-semibold text-primary-text",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "P"}
    </span>
  );
}

export function Badge({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-4 shrink-0 items-center rounded-sm bg-muted px-2 text-2xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Workspace switcher (design/wonder/07): avatar, workspace name, "Personal" badge, chevrons → menu. */
export function WorkspaceSwitcher({ name }: { name: string }) {
  const openAccount = () => window.appSettings?.open("account");
  return (
    <MenuRoot modal={false}>
      <MenuTrigger asChild>
        <button
          id="workspace-profile"
          type="button"
          className="-ml-1.5 flex h-8 min-w-0 items-center gap-2 rounded-lg px-1.5 text-lg text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <Avatar name={name} />
          <span className="truncate">{name}</span>
          <Badge className="ml-1">Personal</Badge>
          <ChevronsUpDownIcon className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-56 bg-background">
        <MenuLabel className="-mt-1 pt-0 pb-0.5">This device</MenuLabel>
        <MenuItem onSelect={openAccount}>
          <Avatar name={name} className="size-4" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <Badge>Local</Badge>
          <CheckIcon className="text-foreground" />
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={openAccount}>
          <PlusIcon />
          Create organization
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
