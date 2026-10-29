/* oxlint-disable shadcn/no-restyle -- Wonder's tooltip is a dark bordered chip without an arrow, not the shared
   inverted bubble; this file is the one place that look is applied. */
// Chat tooltip: shadcn Tooltip with Wonder's chip look (29 "Shader  S": 24px, background fill, 1px edge, no arrow).
import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ChatTip({
  label,
  side = "top",
  children,
}: {
  label: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="max-w-64 rounded-lg border border-tab-edge bg-background px-2 py-1 text-xs text-foreground shadow-toolbar select-none [&>span]:hidden"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
