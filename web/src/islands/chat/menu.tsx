// Wonder chat menus (29–35): 13px rows, 24px items, #1c1c1c surface. Local wrappers around Radix DropdownMenu
// so the shared shadcn component keeps its editor density.
import type { ComponentProps } from "react";
import { DropdownMenu as Menu } from "radix-ui";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";

export const ChatMenu = Menu.Root;
export const ChatMenuTrigger = Menu.Trigger;
export const ChatMenuSub = Menu.Sub;
export const ChatMenuGroup = Menu.Group;

const surface =
  "z-50 overflow-x-hidden overflow-y-auto rounded-xl border border-card-border bg-background p-1 text-sm text-foreground-2 shadow-menu outline-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";

export function ChatMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal container={portalContainer()}>
      <Menu.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(surface, "max-h-(--radix-dropdown-menu-content-available-height)", className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function ChatMenuSubContent({ className, ...props }: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal container={portalContainer()}>
      <Menu.SubContent sideOffset={6} alignOffset={-5} collisionPadding={8} className={cn(surface, className)} {...props} />
    </Menu.Portal>
  );
}

const row =
  "relative flex h-6 cursor-default items-center gap-2 rounded-md px-2 outline-hidden select-none focus:bg-muted data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted-foreground";

export function ChatMenuItem({ className, checked, ...props }: ComponentProps<typeof Menu.Item> & { checked?: boolean }) {
  return (
    <Menu.Item className={cn(row, className)} {...props}>
      {props.children}
      {checked && <CheckIcon className="ml-auto size-3.5 text-foreground-2" />}
    </Menu.Item>
  );
}

export function ChatMenuRadioItem({ className, children, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(row, className)} {...props}>
      {children}
      <Menu.ItemIndicator className="ml-auto">
        <CheckIcon className="size-3.5 text-foreground-2" />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
}

export const ChatMenuRadioGroup = Menu.RadioGroup;

export function ChatMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(row, className)} {...props}>
      {children}
      <Menu.ItemIndicator className="ml-auto">
        <CheckIcon className="size-3.5 text-foreground-2" />
      </Menu.ItemIndicator>
    </Menu.CheckboxItem>
  );
}

export function ChatMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger className={cn(row, "data-[state=open]:bg-muted", className)} {...props}>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <ChevronRightIcon className="size-3 text-muted-foreground" />
    </Menu.SubTrigger>
  );
}

export function ChatMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("flex h-6 items-center px-2 text-sm text-muted-foreground", className)} {...props} />;
}

export function ChatMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
