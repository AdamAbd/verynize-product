// Constraints (design/wonder 25, 45): how a positioned layer anchors to its parent when the parent resizes.
// They are CSS insets (see `constraintsOf` in web/node-style.js); the canvas re-derives the insets so changing a
// constraint never moves the layer. Artboards and auto-layout children have none, so the controls are disabled.
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./controls";

export type Anchor = "start" | "end" | "stretch" | "center" | "scale";
type Constraints = { h: Anchor; v: Anchor };

const LABELS: Record<"h" | "v", Record<Anchor, string>> = {
  h: { start: "Left", end: "Right", stretch: "Left & Right", center: "Center", scale: "Scale" },
  v: { start: "Top", end: "Bottom", stretch: "Top & Bottom", center: "Center", scale: "Scale" },
};
const ORDER: Anchor[] = ["start", "end", "stretch", "center", "scale"];

/** Constraints of each selected layer, or null when one of them cannot be constrained. */
export function readConstraints(selection: string[]): Constraints[] | null {
  const getter = window.design.getConstraints as ((id: string) => Constraints | null) | undefined;
  if (!getter || !selection.length) return null;
  const list = selection.map((id) => getter(id));
  return list.every(Boolean) ? (list as Constraints[]) : null;
}

function apply(selection: string[], next: Partial<Constraints>) {
  const setter = window.design.setConstraints as
    | ((ids: string[], constraints: Partial<Constraints>) => boolean)
    | undefined;
  setter?.(selection, next);
}

const shared = (list: Constraints[] | null, axis: "h" | "v"): Anchor | "mixed" => {
  if (!list) return "start";
  return list.every((c) => c[axis] === list[0][axis]) ? list[0][axis] : "mixed";
};

export function ConstraintSelect({
  axis,
  selection,
  list,
}: {
  axis: "h" | "v";
  selection: string[];
  list: Constraints[] | null;
}) {
  const value = shared(list, axis);
  return (
    <NativeSelect
      name={axis === "h" ? "constraintH" : "constraintV"}
      label={axis === "h" ? "Horizontal constraint" : "Vertical constraint"}
      value={value}
      disabled={!list}
      options={[
        ...(value === "mixed" ? [{ value: "mixed", label: "Mixed", disabled: true }] : []),
        ...ORDER.map((a) => ({ value: a, label: LABELS[axis][a] })),
      ]}
      onChange={(next) => apply(selection, { [axis]: next as Anchor })}
    />
  );
}

/**
 * The constraint diagram: edge ticks pin a side, the centre lines centre an axis. Shift-click the opposite
 * edge to pin both (Left & Right / Top & Bottom), like Figma.
 */
export function ConstraintWidget({
  selection,
  list,
}: {
  selection: string[];
  list: Constraints[] | null;
}) {
  const h = shared(list, "h"),
    v = shared(list, "v");
  const pick = (axis: "h" | "v", edge: "start" | "end" | "center") => (event: MouseEvent) => {
    const current = axis === "h" ? h : v;
    let next: Anchor = edge;
    if (edge !== "center" && event.shiftKey) {
      const other = edge === "start" ? "end" : "start";
      if (current === other || current === "stretch") next = current === "stretch" ? other : "stretch";
    }
    apply(selection, { [axis]: next });
  };
  const on = (axis: "h" | "v", edge: "start" | "end" | "center") => {
    const current = axis === "h" ? h : v;
    if (edge === "center") return current === "center";
    return current === edge || current === "stretch" || (current === "scale" && edge === "start");
  };
  const tick = (active: boolean) =>
    cn("block rounded-full", active ? "bg-primary" : "bg-muted-foreground/60 group-hover:bg-foreground-2");
  const Edge = ({
    axis,
    edge,
    label,
    className,
    bar,
  }: {
    axis: "h" | "v";
    edge: "start" | "end" | "center";
    label: string;
    className: string;
    bar: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on(axis, edge)}
      disabled={!list}
      data-constraint={axis + "-" + edge}
      onClick={pick(axis, edge)}
      className={cn("group absolute flex items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-ring", className)}
    >
      <span
        aria-hidden
        className={cn(
          bar,
          tick(on(axis, edge)),
          // Like Wonder, the centre lines only show while the diagram is hovered (or when centred).
          edge === "center" && !on(axis, edge) && "opacity-0 group-hover/constraints:opacity-100",
        )}
      />
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Constraints"
      className={cn(
        "group/constraints relative row-span-2 h-full min-h-14 rounded-md bg-accent shadow-field",
        !list && "opacity-50",
      )}
    >
      {/* Wonder 22/43: #363636 well, 12px ticks 6px in from each edge. */}
      <Edge axis="v" edge="start" label="Pin top" className="inset-x-6 top-0 h-6" bar="h-3 w-px" />
      <Edge axis="v" edge="end" label="Pin bottom" className="inset-x-6 bottom-0 h-6" bar="h-3 w-px" />
      <Edge axis="h" edge="start" label="Pin left" className="inset-y-6 left-0 w-6" bar="h-px w-3" />
      <Edge axis="h" edge="end" label="Pin right" className="inset-y-6 right-0 w-6" bar="h-px w-3" />
      <Edge axis="h" edge="center" label="Center horizontally" className="top-6 bottom-6 left-1/2 w-3 -translate-x-1/2" bar="h-3 w-px" />
      <Edge axis="v" edge="center" label="Center vertically" className="top-1/2 left-6 right-6 h-3 -translate-y-1/2" bar="h-px w-3" />
    </div>
  );
}
