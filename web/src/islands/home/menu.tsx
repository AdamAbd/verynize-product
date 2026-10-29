// Home-local menu + button primitives (Wonder's Files screen uses 13px menus and buttons, the shared
// shadcn components are tuned for the 12px editor). Built on Radix so keyboard/ARIA behaviour is unchanged.
import type { ComponentProps } from "react";
import { ChevronRightIcon } from "lucide-react";
import { DropdownMenu as Menu } from "radix-ui";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";

export const MenuRoot = Menu.Root;
export const MenuTrigger = Menu.Trigger;
export const MenuSub = Menu.Sub;

// The legacy shell closes the Files screen on Escape; keep Escape inside open menus.
const keepEscape = (event: KeyboardEvent) => event.stopPropagation();

const surface =
  "z-50 overflow-hidden rounded-lg border border-card-border bg-popover p-1.5 text-sm text-foreground shadow-menu outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export function MenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal container={portalContainer()}>
      <Menu.Content
        sideOffset={sideOffset}
        onEscapeKeyDown={keepEscape}
        className={cn(surface, className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal container={portalContainer()}>
      <Menu.SubContent
        sideOffset={6}
        onEscapeKeyDown={keepEscape}
        className={cn(surface, className)}
        {...props}
      />
    </Menu.Portal>
  );
}

const item =
  "flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none focus:bg-accent data-[disabled]:opacity-50 data-[state=open]:bg-accent [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-foreground-3";

export function MenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(item, className)} {...props} />;
}

export function MenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger className={cn(item, className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto size-3" />
    </Menu.SubTrigger>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn("truncate px-2 pt-0.5 pb-1 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return (
    <Menu.Separator className={cn("-mx-1.5 my-1 h-px bg-card-border", className)} {...props} />
  );
}

const buttonVariant = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-secondary text-foreground hover:bg-accent",
} as const;

/** 28px Files-screen button (New folder / New file). */
export function HomeButton({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonVariant }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        buttonVariant[variant],
        className,
      )}
      {...props}
    />
  );
}
