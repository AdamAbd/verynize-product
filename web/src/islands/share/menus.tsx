// Role and visibility menus of the Share popover (Wonder SI2-roles, SV1-menu). Every role is free in Verynize, so
// Editor and Admin carry no Pro badge (deliberate difference, CONTRACT.md).
import { DropdownMenu } from "radix-ui";
import { Check, ChevronDown, Eye, Lock } from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import type { InviteRole, Visibility } from "./api";

export const ROLE_LABEL: Record<InviteRole, string> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
};
const ROLES: InviteRole[] = ["viewer", "editor", "admin"];

export function RoleMenu({
  role,
  onRoleChange,
  disabled,
}: {
  role: InviteRole;
  onRoleChange: (role: InviteRole) => void;
  disabled: boolean;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label="Member role"
        disabled={disabled}
        className="flex h-7 w-20 shrink-0 items-center justify-between rounded-md bg-input pr-2 pl-2.5 text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 data-[state=open]:bg-accent"
      >
        {ROLE_LABEL[role]}
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer()}>
        <DropdownMenu.Content
          id="share-role-menu"
          align="start"
          alignOffset={-19}
          sideOffset={4}
          className="z-50 w-share-role-menu rounded-2xl bg-background p-1.5 text-sm text-foreground shadow-share outline-none"
        >
          <DropdownMenu.RadioGroup
            value={role}
            onValueChange={(value) => onRoleChange(value as InviteRole)}
          >
            {ROLES.map((value) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                data-role={value}
                className="flex h-7.25 cursor-default items-center justify-between rounded-lg px-2.5 outline-none select-none data-highlighted:bg-muted"
              >
                {ROLE_LABEL[value]}
                <DropdownMenu.ItemIndicator>
                  <Check className="size-3.5" aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export const VISIBILITY_TEXT: Record<Visibility, { title: string; menu: string; detail: string }> =
  {
    private: { title: "Private", menu: "Private", detail: "Only members can access" },
    public: {
      title: "Anyone with the link",
      menu: "Public",
      detail: "Publicly available to everyone",
    },
  };

export function VisibilityMenu({
  visibility,
  onSelect,
  disabled,
  reason,
  avatar,
}: {
  visibility: Visibility;
  onSelect: (visibility: Visibility) => void;
  disabled: boolean;
  /** Why the trigger is disabled (shown as its description). */
  reason?: string;
  avatar: React.ReactNode;
}) {
  const text = VISIBILITY_TEXT[visibility];
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        id="share-visibility"
        aria-label={`${text.menu} visibility`}
        data-visibility={visibility}
        disabled={disabled}
        title={disabled ? reason : undefined}
        className="-mx-1.5 mt-1.75 flex h-12 items-center gap-3 rounded-lg px-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {avatar}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-4.5 text-foreground">{text.title}</span>
          <span className="truncate text-sm leading-4.5 text-share-muted">
            {disabled && reason ? reason : text.detail}
          </span>
        </span>
        {!disabled && (
          <ChevronDown className="mr-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portalContainer()}>
        <DropdownMenu.Content
          id="share-visibility-menu"
          align="start"
          sideOffset={3}
          className="z-50 w-share-visibility rounded-xl bg-background p-1 text-sm shadow-share outline-none"
        >
          <DropdownMenu.RadioGroup
            value={visibility}
            onValueChange={(value) => onSelect(value as Visibility)}
          >
            {(["private", "public"] as const).map((value) => {
              const Icon = value === "private" ? Lock : Eye;
              return (
                <DropdownMenu.RadioItem
                  key={value}
                  value={value}
                  data-visibility-option={value}
                  className="flex h-11 cursor-default items-center gap-2.5 rounded-md px-2.5 outline-none select-none data-highlighted:bg-muted"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="leading-4.5 text-foreground">
                      {VISIBILITY_TEXT[value].menu}
                    </span>
                    <span className="leading-4.5 text-share-muted">
                      {VISIBILITY_TEXT[value].detail}
                    </span>
                  </span>
                  <DropdownMenu.ItemIndicator>
                    <Check className={cn("size-3.5 text-foreground")} aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
