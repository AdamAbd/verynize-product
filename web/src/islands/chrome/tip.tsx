// Wonder tooltip (29-chat-panel.png "Shader  S"): 24px dark chip, 1px edge, radius 8, muted shortcut.
import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { portalContainer } from "@/lib/bridge";

export function Tip({
  label,
  shortcut,
  side = "top",
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={portalContainer()}>
        <Tooltip.Content
          side={side}
          sideOffset={8}
          className="z-50 flex h-6 items-center gap-2.5 rounded-lg border border-tab-edge bg-background px-2 text-xs text-foreground shadow-toolbar select-none data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {label}
          {shortcut ? <span className="text-muted-foreground">{shortcut}</span> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
