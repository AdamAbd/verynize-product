import { useEffect } from "react";
import { CheckIcon, ChevronsUpDownIcon, LogInIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/icons";
import {
  authRequest,
  cloudAccount,
  isPersonal,
  openSignIn,
  organizationsChanged,
  useActiveOrganization,
  useOrganizations,
  type Organization,
} from "@/lib/cloud-account";
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

const slugFor = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "team"
  }-${Math.random().toString(36).slice(2, 6)}`;

/** Ask for an organization name, create it and make it the active workspace. */
export async function createOrganization() {
  const name = (await window.askText?.("New organization name", ""))?.trim();
  if (!name) return null;
  try {
    const created = await authRequest<Organization>("/organization/create", {
      name: name.slice(0, 80),
      slug: slugFor(name),
    });
    await organizationsChanged();
    cloudAccount()?.setActiveOrganization(created.id);
    toast(`Created ${created.name}`);
    return created;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Workspace switcher (design/wonder/07): the active workspace with its kind badge → menu of the
 * account's organizations (personal first), "Create organization" and members. Signed out, it shows
 * the local workspace and a sign-in entry. Rooms shared from the Share panel go to the active one.
 */
export function WorkspaceSwitcher({ name }: { name: string }) {
  const { account, organizations } = useOrganizations();
  const activeId = useActiveOrganization();
  const active = organizations.find((org) => org.id === activeId) ?? organizations[0] ?? null;
  const signedIn = !!account?.emailAccount;
  // A stored workspace the account no longer belongs to falls back to the personal one.
  useEffect(() => {
    if (organizations.length && !organizations.some((org) => org.id === activeId))
      cloudAccount()?.setActiveOrganization(organizations[0].id);
  }, [organizations, activeId]);
  const label = active
    ? isPersonal(active)
      ? account!.account.displayName || name
      : active.name
    : name;
  const kind = !active
    ? signedIn
      ? "Personal"
      : "Local"
    : isPersonal(active)
      ? "Personal"
      : "Team";

  return (
    <MenuRoot modal={false}>
      <MenuTrigger asChild>
        <button
          id="workspace-profile"
          type="button"
          data-organization={active?.id ?? ""}
          className="-ml-1.5 flex h-8 min-w-0 items-center gap-2 rounded-lg px-1.5 text-lg text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <Avatar name={label} />
          <span className="truncate">{label}</span>
          <Badge className="ml-1">{kind}</Badge>
          <ChevronsUpDownIcon className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-64 bg-background" id="workspace-menu">
        {signedIn ? (
          <>
            <MenuLabel className="-mt-1 truncate pt-0 pb-0.5">{account!.account.email}</MenuLabel>
            {organizations.map((org) => {
              const personal = isPersonal(org);
              const title = personal ? account!.account.displayName || name : org.name;
              return (
                <MenuItem
                  key={org.id}
                  data-workspace={org.id}
                  onSelect={() => cloudAccount()?.setActiveOrganization(org.id)}
                >
                  <Avatar name={title} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  <Badge>{personal ? "Personal" : "Team"}</Badge>
                  <CheckIcon
                    className={cn("text-foreground", org.id !== active?.id && "invisible")}
                  />
                </MenuItem>
              );
            })}
            <MenuSeparator />
            <MenuItem id="workspace-create" onSelect={() => void createOrganization()}>
              <PlusIcon />
              Create organization
            </MenuItem>
            <MenuItem id="workspace-members" onSelect={() => window.appSettings?.open("members")}>
              <UsersIcon className="size-3.5" />
              Members & invitations
            </MenuItem>
          </>
        ) : (
          <>
            <MenuLabel className="-mt-1 pt-0 pb-0.5">This device</MenuLabel>
            <MenuItem onSelect={() => window.appSettings?.open("account")}>
              <Avatar name={name} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <Badge>Local</Badge>
              <CheckIcon className="text-foreground" />
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="workspace-sign-in" onSelect={openSignIn}>
              <LogInIcon className="size-3.5" />
              Sign in to share and collaborate
            </MenuItem>
            <MenuItem onSelect={openSignIn}>
              <PlusIcon />
              Create organization
            </MenuItem>
          </>
        )}
      </MenuContent>
    </MenuRoot>
  );
}
