// Wonder-styled context menu parts (canvas, layer rows, page rows), built on the Radix context menu primitive.
// Geometry measured in design/wonder/canvas-audit/wonder/CM2-frame-ready.png: 176 px wide, 4 px inset, 25 px row
// pitch, radius ≈ 12, surface rgb(28,28,28), highlighted row rgb(76,48,91) keeping the text colour, 13 px labels,
// right-aligned glyph shortcuts, full-width separators and › chevrons for submenus.
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ContextMenu as Menu } from "radix-ui";
import { portalContainer } from "@/lib/bridge";
import { cn } from "@/lib/utils";

const surface =
  "z-50 min-w-44 overflow-hidden rounded-2xl border border-border bg-context-menu p-1 text-sm text-foreground shadow-menu";
const row =
  "relative flex h-6.25 cursor-default items-center gap-3 rounded-md pr-2 pl-1.5 outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:text-subtle-foreground data-[highlighted]:bg-context-menu-highlight data-[state=open]:bg-context-menu-highlight";

// Keys pressed inside a menu (arrows, Escape, letters) navigate the menu only: they must not reach the canvas
// shortcuts on `document` (nudge, deselect, tools) or the layer tree's row handlers.
const keepKeys = (event: KeyboardEvent<HTMLDivElement>) => event.stopPropagation();

export function MenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal container={portalContainer()}>
      <Menu.Content
        data-bd-context-menu=""
        collisionPadding={8}
        onKeyDown={keepKeys}
        className={cn(surface, "max-h-(--radix-context-menu-content-available-height)", className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export function MenuItem({
  label,
  shortcut,
  destructive,
  className,
  ...props
}: Omit<ComponentProps<typeof Menu.Item>, "children"> & {
  label: string;
  shortcut?: ReactNode;
  destructive?: boolean;
}) {
  return (
    <Menu.Item
      className={cn(
        row,
        destructive && "text-destructive data-[disabled]:text-destructive/50",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <MenuShortcut>{shortcut}</MenuShortcut> : null}
    </Menu.Item>
  );
}

export function MenuShortcut({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto flex shrink-0 items-center text-xs text-foreground-3">{children}</span>
  );
}

export function MenuSeparator() {
  return <Menu.Separator className="-mx-1 my-1 h-px bg-divider" />;
}

export function MenuSub({
  label,
  command,
  disabled,
  children,
}: {
  label: string;
  command: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger data-command={command} disabled={disabled} className={row}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-3 shrink-0 text-foreground-3" />
      </Menu.SubTrigger>
      <Menu.Portal container={portalContainer()}>
        <Menu.SubContent
          data-bd-context-menu=""
          data-submenu={command}
          sideOffset={4}
          alignOffset={-5}
          collisionPadding={8}
          onKeyDown={keepKeys}
          className={surface}
        >
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

export { Menu };
