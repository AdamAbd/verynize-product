// Border colour (Wonder's Border row, design/wonder/2026-10-30/15–16 and 19): one colour for all sides, or
// one colour per side. Every colour can be bound to a Colors variable (`strokeToken`, `strokeColors[i].token`);
// detaching or picking a custom colour keeps the resolved value. Rendering lives in web/node-style.js.
import { Palette } from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import { IconButton } from "./controls";
import { EffectColorField } from "./effects";
import { patchNodes, type Node } from "./model";

type SideColor = { color: string; token?: string };
type BorderNode = Node & { strokeToken?: string; strokeColors?: SideColor[] };
const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

const sideColors = (node: BorderNode): SideColor[] | null =>
  Array.isArray(node.strokeColors) && node.strokeColors.length === 4 ? node.strokeColors : null;

export function BorderColors({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const n = node as BorderNode;
  const tokens = doc.tokens ?? {};
  const color = n.strokeColor || "#000000";
  const sides = sideColors(n);
  const setUniform = (patch: { strokeColor: string; strokeToken?: string }) =>
    patchNodes(selection, () => ({ strokeToken: undefined, ...patch }));
  const setSide = (index: number, next: SideColor) =>
    patchNodes(selection, (current) => {
      const own = sideColors(current as BorderNode) ?? sides ?? SIDES.map(() => ({ color }));
      return {
        strokeColors: own.map((c, i) =>
          i === index ? (next.token ? next : { color: next.color }) : { ...c },
        ),
      };
    });
  return (
    <div className="flex flex-col gap-2" data-border-colors={sides ? "sides" : "all"}>
      <div className="flex items-center gap-2">
        {sides ? (
          <span className="flex-1 text-xs text-muted-foreground">Side colours</span>
        ) : (
          <EffectColorField
            name="strokeColor"
            label="Border colour"
            value={color}
            tokens={tokens}
            token={n.strokeToken}
            onToken={(name) =>
              setUniform({ strokeColor: tokens[name] ?? color, strokeToken: name || undefined })
            }
            onCommit={(next) => setUniform({ strokeColor: next })}
          />
        )}
        <IconButton
          icon={Palette}
          label={sides ? "Use one border colour" : "Independent border colours"}
          active={!!sides}
          aria-pressed={!!sides}
          onClick={() =>
            patchNodes(selection, (current) => {
              const c = current as BorderNode;
              if (sideColors(c)) {
                // Collapse to the top side's colour (and its variable).
                const top = sideColors(c)![0];
                return { strokeColors: undefined, strokeColor: top.color, strokeToken: top.token };
              }
              const base: SideColor = c.strokeToken
                ? { color: tokens[c.strokeToken] ?? c.strokeColor ?? color, token: c.strokeToken }
                : { color: c.strokeColor || color };
              return { strokeColors: SIDES.map(() => ({ ...base })), strokeToken: undefined };
            })
          }
        />
      </div>
      {sides
        ? SIDES.map((side, i) => (
            <div
              key={side}
              className="flex items-center gap-2"
              data-border-side={side.toLowerCase()}
            >
              <span className="w-3 shrink-0 text-xs text-muted-foreground">{side[0]}</span>
              <EffectColorField
                name={`strokeColor${side}`}
                label={`${side} border colour`}
                value={sides[i].color}
                tokens={tokens}
                token={sides[i].token}
                onToken={(name) =>
                  setSide(i, { color: tokens[name] ?? sides[i].color, token: name || undefined })
                }
                onCommit={(next) => setSide(i, { color: next })}
              />
            </div>
          ))
        : null}
    </div>
  );
}
