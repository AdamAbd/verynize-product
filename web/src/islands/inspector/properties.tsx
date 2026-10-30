// Properties sections (design/wonder 22, 25, 43, 45–46, 55–56).
import { useEffect, useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  RotateCcw,
  RotateCw,
  RotateCwSquare,
  Scan,
  SquareDashed,
  Trash2,
  Check,
} from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { activePage, type DesignDocument } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  Affix,
  Caption,
  Field,
  IconAffix,
  IconButton,
  NativeSelect,
  OptionalSection,
  Section,
  Swatch,
  type IconType,
} from "./controls";
import { formClick, notify } from "./legacy";
import { ColorPopover } from "./color-picker";
import { BindableField } from "./bind";
import { CORNER_KEYS } from "./vars";
import { ExportSection } from "./export-section";
import { FillTools, PaintStack } from "./paints";
import { alphaPercent, parseColor, toHex } from "./color";
import {
  SHADER_PRESETS,
  descendants,
  fmt,
  hexLabel,
  pageNodes,
  parseHex,
  patchNodes,
  setField,
  type Node,
} from "./model";
import { TypographySection } from "./typography";
import { SvgColorsSection } from "./svg-colors";
import { LayoutSection } from "./layout";
import { ConstraintSelect, ConstraintWidget, readConstraints } from "./constraints";
import { BlendMenu, BorderStyleSelect, OutlineSection } from "./effects";
import { ShadowSection } from "./shadows";
import { FilterSection } from "./filters";
import { MaskSection } from "./masks";

type Props = { doc: DesignDocument; node: Node; selection: string[] };

/* ---------- Position ---------- */
const ALIGN_GROUPS: { id: string; label: string; icon: IconType }[][] = [
  [
    { id: "left", label: "Align left", icon: AlignStartVertical },
    { id: "center", label: "Align horizontal centers", icon: AlignCenterVertical },
    { id: "right", label: "Align right", icon: AlignEndVertical },
  ],
  [
    { id: "top", label: "Align top", icon: AlignStartHorizontal },
    { id: "middle", label: "Align vertical centers", icon: AlignCenterHorizontal },
    { id: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
  ],
];

function ToolGroup({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <div
      role="group"
      className={cn(
        "flex h-6 items-center justify-around rounded-md bg-muted px-1",
        disabled && "bg-muted/50",
      )}
    >
      {children}
    </div>
  );
}

function ToolButton({
  id,
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  id?: string;
  label: string;
  icon: IconType;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:text-subtle-foreground disabled:opacity-40"
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function PositionSection({ node, selection }: Props) {
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const many = selection.length > 1;
  const align = (id: string) => formClick("precision-" + id);
  const constraints = readConstraints(selection);
  return (
    <Section id="position-section" title="Position">
      <div className="grid grid-cols-3 gap-2">
        {ALIGN_GROUPS.map((group, i) => (
          <ToolGroup key={i} disabled={!many}>
            {group.map((b) => (
              <ToolButton
                key={b.id}
                id={"precision-" + b.id}
                label={b.label}
                icon={b.icon}
                disabled={!many}
                onClick={() => align(b.id)}
              />
            ))}
          </ToolGroup>
        ))}
        <ToolGroup>
          <ToolButton
            label="Rotate 90°"
            icon={RotateCwSquare}
            onClick={() =>
              patchNodes(selection, (n) => ({ rotation: ((n.rotation || 0) + 90) % 360 }))
            }
          />
          <ToolButton
            id="precision-horizontal"
            label="Distribute horizontally"
            icon={AlignHorizontalDistributeCenter}
            disabled={selection.length < 3}
            onClick={() => align("horizontal")}
          />
          <ToolButton
            id="precision-vertical"
            label="Distribute vertically"
            icon={AlignVerticalDistributeCenter}
            disabled={selection.length < 3}
            onClick={() => align("vertical")}
          />
        </ToolGroup>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field
          name="x"
          label="X position"
          numeric
          value={fmt(node.x)}
          onCommit={set("x")}
          prefix={<Affix>X</Affix>}
        />
        <Field
          name="y"
          label="Y position"
          numeric
          value={fmt(node.y)}
          onCommit={set("y")}
          prefix={<Affix>Y</Affix>}
        />
        <Field
          name="rotation"
          label="Rotation"
          numeric
          value={fmt(node.rotation)}
          onCommit={set("rotation")}
          prefix={<IconAffix icon={RotateCw} />}
          suffix="°"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ConstraintSelect axis="h" selection={selection} list={constraints} />
        <ConstraintSelect axis="v" selection={selection} list={constraints} />
        <ConstraintWidget selection={selection} list={constraints} />
        <Field
          name="zIndex"
          label="Stack order"
          numeric
          className="col-span-2"
          value={node.zIndex ? fmt(node.zIndex) : ""}
          placeholder="Auto"
          onCommit={(value) => set("zIndex")(value.trim() || "0")}
          prefix={<Affix>Z</Affix>}
        />
      </div>
    </Section>
  );
}

/* ---------- Appearance ---------- */
function InspectorCheckbox({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="m-0 flex h-6 w-fit items-center gap-2 text-xs text-foreground-2/90">
      <CheckboxPrimitive.Root
        name={name}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-input shadow-field focus-visible:ring-1 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3" data-icon-weight="bold" aria-hidden />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  );
}

function AppearanceSection({ doc, node, selection }: Props) {
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const [cornersOpen, setCornersOpen] = useOptional(node.id, Array.isArray(node.cornerRadii));
  const cornersExpanded = cornersOpen && !node.bindings?.radius;
  const corners = individualValues(node, "cornerRadii", "radius");
  const radius = corners.every((value) => value === corners[0]) ? fmt(corners[0]) : "";
  const hidden = !!node.hidden;
  return (
    <Section
      id="appearance-section"
      title="Appearance"
      tools={
        <>
          <IconButton
            id="appearance-visibility"
            icon={hidden ? EyeOff : Eye}
            label={hidden ? "Show layer" : "Hide layer"}
            onClick={() => patchNodes(selection, () => ({ hidden: !hidden }))}
          />
          <BlendMenu doc={doc} node={node} selection={selection} />
        </>
      }
    >
      <div className="flex items-end gap-2">
        <Caption label="Opacity" className="flex-1">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="opacity"
            label="Opacity"
            prefix={<IconAffix icon={SquareDashed} />}
          >
            {(suffix) => (
              <Field
                name="opacity"
                label="Opacity"
                numeric
                value={fmt(node.opacity)}
                onCommit={set("opacity")}
                prefix={<IconAffix icon={SquareDashed} />}
                suffix={<>%{suffix}</>}
              />
            )}
          </BindableField>
        </Caption>
        <Caption label="Corner radius" className="flex-1">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="radius"
            label="Corner radius"
            prefix={<IconAffix icon={Scan} />}
          >
            {(suffix) => (
              <Field
                name="radius"
                label="Corner radius"
                numeric
                value={radius}
                placeholder="Mixed"
                onCommit={set("radius")}
                prefix={<IconAffix icon={Scan} />}
                suffix={suffix}
              />
            )}
          </BindableField>
        </Caption>
        <IconButton
          icon={Scan}
          label="Independent corner radii"
          active={cornersExpanded}
          aria-expanded={cornersExpanded}
          onClick={() => {
            if (!cornersExpanded) expandIndividual(selection, "cornerRadii", "radius");
            setCornersOpen(!cornersExpanded);
          }}
        />
      </div>
      {cornersExpanded ? (
        <IndividualFields
          doc={doc}
          node={node}
          selection={selection}
          property="cornerRadii"
          scalar="radius"
          labels={[
            "Top left radius",
            "Top right radius",
            "Bottom right radius",
            "Bottom left radius",
          ]}
          prefixes={["TL", "TR", "BR", "BL"]}
        />
      ) : null}
      {node.type === "frame" ? (
        <InspectorCheckbox
          name="clipContent"
          label="Clip content"
          checked={!!node.clipContent}
          onChange={(v) => setField(selection, node, "clipContent", v)}
        />
      ) : null}
    </Section>
  );
}

type IndividualProperty = "cornerRadii" | "strokeWidths";
type UniformProperty = "radius" | "strokeWidth";

function individualValues(
  node: Node,
  property: IndividualProperty,
  scalar: UniformProperty,
): number[] {
  const values = node[property];
  const fallback =
    typeof node[scalar] === "number" && Number.isFinite(node[scalar])
      ? Math.max(0, node[scalar])
      : 0;
  if (Array.isArray(values) && values.length === 4)
    return values.map((value) =>
      typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback,
    );
  return Array.from({ length: 4 }, () => fallback);
}

function individualPatch(
  node: Node,
  property: IndividualProperty,
  scalar: UniformProperty,
  values: number[],
  detach: string[] = [],
) {
  const bindings = { ...node.bindings };
  delete bindings[scalar];
  for (const key of detach) delete bindings[key];
  return { [property]: values, bindings: Object.keys(bindings).length ? bindings : undefined };
}

/** Expanding a bound uniform value starts with four resolved values and detaches only that binding. */
function expandIndividual(
  selection: string[],
  property: IndividualProperty,
  scalar: UniformProperty,
) {
  patchNodes(selection, (node) =>
    individualPatch(node, property, scalar, individualValues(node, property, scalar)),
  );
}

function IndividualFields({
  doc,
  node,
  selection,
  property,
  scalar,
  labels,
  prefixes,
}: {
  doc?: DesignDocument;
  node: Node;
  selection: string[];
  property: IndividualProperty;
  scalar: UniformProperty;
  labels: string[];
  prefixes: string[];
}) {
  const values = individualValues(node, property, scalar);
  return (
    <div
      className="grid grid-cols-4 gap-2"
      role="group"
      aria-label={
        property === "cornerRadii" ? "Individual corner radii" : "Individual border widths"
      }
    >
      {labels.map((label, index) => {
        // Each corner radius can bind a Dimension variable; typing a corner detaches only that corner.
        const corner = property === "cornerRadii" ? CORNER_KEYS[index] : undefined;
        const field = (suffix?: ReactNode) => (
          <Field
            name={`${property}-${index}`}
            label={label}
            numeric
            value={fmt(values[index])}
            prefix={<Affix>{prefixes[index]}</Affix>}
            suffix={suffix}
            onCommit={(raw) => {
              const value = Number(raw.trim());
              if (!raw.trim() || !Number.isFinite(value)) return "Enter a number.";
              patchNodes(selection, (selected) => {
                const next = individualValues(selected, property, scalar);
                next[index] = Math.max(0, value);
                return individualPatch(selected, property, scalar, next, corner ? [corner] : []);
              });
            }}
          />
        );
        return corner && doc ? (
          <BindableField
            key={label}
            doc={doc}
            node={node}
            selection={selection}
            field={corner}
            label={label}
            prefix={<Affix>{prefixes[index]}</Affix>}
          >
            {field}
          </BindableField>
        ) : (
          <div key={label} className="contents">
            {field()}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Fill ---------- */
const ANIMATED = [
  { value: "", label: "None" },
  { value: "aurora", label: "Aurora" },
  { value: "sunset", label: "Sunset" },
  { value: "ocean", label: "Ocean" },
];

/** Always mounted: app.js toggles `#shader-settings.hidden` on every render, even with nothing selected. */
function ShaderSettings({ node, selection }: { node: Node | undefined; selection: string[] }) {
  const shader = node?.type === "shader";
  const set = (key: string) => (value: string) => node && setField(selection, node, key, value);
  const preset = SHADER_PRESETS.find(([v]) => v === node?.shaderPreset)?.[1] ?? "Aurora";
  return (
    <details id="shader-settings" hidden={!shader} className="group/shader m-0 border-0 p-0">
      <summary className="flex h-6 cursor-default list-none items-center justify-between rounded-md bg-input px-2 text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring">
        <span className="truncate">{preset}</span>
        <span className="text-muted-foreground group-open/shader:rotate-180">
          <ChevronDown className="size-3" aria-hidden />
        </span>
      </summary>
      {node ? (
        <div className="flex flex-col gap-2 pt-2">
          <Caption label="Preset">
            <NativeSelect
              name="shaderPreset"
              label="Shader preset"
              value={node.shaderPreset}
              onChange={set("shaderPreset")}
              options={SHADER_PRESETS.map(([value, label]) => ({ value, label }))}
            />
          </Caption>
          <div className="grid grid-cols-2 gap-2">
            <Caption label="Speed">
              <Field
                name="shaderSpeed"
                label="Shader speed"
                numeric
                step={0.1}
                value={fmt(node.shaderSpeed)}
                onCommit={set("shaderSpeed")}
              />
            </Caption>
            <Caption label="Intensity">
              <Field
                name="shaderIntensity"
                label="Shader intensity"
                numeric
                step={0.1}
                value={fmt(node.shaderIntensity)}
                onCommit={set("shaderIntensity")}
              />
            </Caption>
          </div>
          <button
            type="button"
            id="choose-shader"
            className="flex h-6 items-center justify-center rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => formClick("choose-shader")}
          >
            Choose shader…
          </button>
          <p className="text-2xs text-subtle-foreground">
            Fill colour or a colour variable drives the shader colour. Speed 0 freezes motion.
          </p>
        </div>
      ) : null}
    </details>
  );
}

function FillSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node | undefined;
  selection: string[];
}) {
  const set = (key: string) => (value: string) => node && setField(selection, node, key, value);
  return (
    <section id="fill-section" hidden={!node} className="border-b border-border">
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">
          {node?.type === "text"
            ? "Text Fill"
            : node?.type === "shader"
              ? "Shader Fill"
              : "Background Fill"}
        </h3>
        {node ? <FillTools doc={doc} node={node} selection={selection} /> : null}
      </div>
      <div className="flex flex-col gap-2 px-3 pt-1 pb-2.75">
        <ShaderSettings node={node} selection={selection} />
        {node ? (
          <>
            <PaintStack doc={doc} node={node} selection={selection} />
            <div className="grid grid-cols-2 gap-2">
              {/* Free-form CSS gradients (older documents, codec input) stay editable until cleared. */}
              {node.gradient ? (
                <Caption label="CSS gradient">
                  <Field
                    name="gradient"
                    label="Gradient (CSS)"
                    value={node.gradient}
                    placeholder="linear-gradient(…)"
                    onCommit={set("gradient")}
                  />
                </Caption>
              ) : null}
              <Caption label="Animated">
                <NativeSelect
                  name="animated"
                  label="Animated gradient"
                  value={node.animated}
                  onChange={set("animated")}
                  options={ANIMATED}
                />
              </Caption>
            </div>
          </>
        ) : null}
      </div>
      {/* app.js writes the selected colour here on every render (updateMeasurement). */}
      <input type="hidden" id="fill-hex" />
    </section>
  );
}

/* ---------- Page (nothing selected) ---------- */
const workspace = () => document.getElementById("workspace");

/** The canvas backdrop the page falls back to without its own background (theme token). */
function defaultPageColor() {
  const el = workspace();
  if (!el) return "#2B2B2B";
  const inline = el.style.backgroundColor;
  el.style.backgroundColor = "";
  const parsed = parseColor(getComputedStyle(el).backgroundColor);
  el.style.backgroundColor = inline;
  return parsed ? toHex(parsed) : "#2B2B2B";
}

function updatePage(patch: { background?: string }) {
  try {
    window.design.updatePage(patch);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function PageSection({ doc }: { doc: DesignDocument }) {
  const [open, setOpen] = useState(false);
  const background = activePage(doc).background;
  const color = background || defaultPageColor();
  const commit = (next: string) => updatePage({ background: next });
  return (
    <Section
      id="page-section"
      title="Page"
      tools={
        background ? (
          <IconButton
            icon={RotateCcw}
            label="Reset page colour"
            onClick={() => updatePage({ background: undefined })}
          />
        ) : null
      }
    >
      <ColorPopover
        open={open}
        onOpenChange={setOpen}
        value={color}
        onPreview={(next) => {
          const el = workspace();
          if (el) el.style.backgroundColor = next;
        }}
        onCommit={commit}
      >
        <div
          data-color-anchor
          className="flex h-6 min-w-0 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field focus-within:ring-1 focus-within:ring-ring"
        >
          <button
            type="button"
            name="pageBackground"
            aria-label="Page colour"
            aria-expanded={open}
            title="Pick page colour"
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setOpen(!open)}
          >
            <Swatch color={color} className="size-4.5 rounded-sm" />
          </button>
          <Field
            label="Page hex colour"
            value={hexLabel(color)}
            className="h-5 flex-1 bg-transparent px-1 shadow-none focus-within:ring-0"
            inputClassName="uppercase"
            onCommit={(value) => {
              const hex =
                parseHex(value, color) ?? (parseColor(value) ? toHex(parseColor(value)!) : null);
              if (!hex) return "Use a hex colour such as 2B2B2B";
              commit(hex);
            }}
          />
        </div>
      </ColorPopover>
    </Section>
  );
}

/* ---------- Optional sections ---------- */
function useOptional(nodeId: string | undefined, hasValue: boolean) {
  const [open, setOpen] = useState(hasValue);
  useEffect(() => {
    setOpen(hasValue);
    // Reset per layer: open when the layer already uses the property.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);
  useEffect(() => {
    if (hasValue) setOpen(true);
  }, [hasValue]);
  return [open, setOpen] as const;
}

function BorderSection({ doc, node, selection }: Props) {
  const widths = individualValues(node, "strokeWidths", "strokeWidth");
  const [open, setOpen] = useOptional(
    node.id,
    widths.some((value) => value > 0),
  );
  const [sidesOpen, setSidesOpen] = useOptional(node.id, Array.isArray(node.strokeWidths));
  const sidesExpanded = sidesOpen && !node.bindings?.strokeWidth;
  const [picker, setPicker] = useState(false);
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const commit = (color: string) => setField(selection, node, "strokeColor", color);
  return (
    <OptionalSection id="border-section" title="Border" open={open} onOpenChange={setOpen}>
      <div className="grid grid-cols-2 gap-2">
        <Caption label="Width">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="strokeWidth"
            label="Border width"
            prefix={<Affix>W</Affix>}
            suffix="px"
          >
            {(suffix) => (
              <Field
                name="strokeWidth"
                label="Border width"
                numeric
                value={widths.every((value) => value === widths[0]) ? fmt(widths[0]) : ""}
                placeholder="Mixed"
                onCommit={set("strokeWidth")}
                prefix={<Affix>W</Affix>}
                suffix={suffix}
              />
            )}
          </BindableField>
        </Caption>
        <Caption label="Colour">
          <ColorPopover
            open={picker}
            onOpenChange={setPicker}
            value={node.strokeColor || "#000000"}
            onCommit={commit}
          >
            <div data-color-anchor>
              <Field
                name="strokeColor"
                label="Border colour"
                value={hexLabel(node.strokeColor)}
                inputClassName="uppercase"
                prefix={
                  <button
                    type="button"
                    aria-label="Pick border colour"
                    aria-expanded={picker}
                    className="flex rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setPicker(!picker)}
                  >
                    <Swatch color={node.strokeColor} className="size-3.5" />
                  </button>
                }
                scrub={false}
                suffix={
                  alphaPercent(node.strokeColor) < 100
                    ? `${alphaPercent(node.strokeColor)}%`
                    : undefined
                }
                onCommit={(value) => {
                  const hex = parseHex(value, node.strokeColor);
                  return hex ? commit(hex) : "Use a hex colour such as A58BDD";
                }}
              />
            </div>
          </ColorPopover>
        </Caption>
      </div>
      <div className="flex items-center justify-end gap-2">
        <BorderStyleSelect node={node} selection={selection} />
        <IconButton
          icon={SquareDashed}
          label="Independent border widths"
          active={sidesExpanded}
          aria-expanded={sidesExpanded}
          onClick={() => {
            if (!sidesExpanded) expandIndividual(selection, "strokeWidths", "strokeWidth");
            setSidesOpen(!sidesExpanded);
          }}
        />
      </div>
      {sidesExpanded ? (
        <IndividualFields
          node={node}
          selection={selection}
          property="strokeWidths"
          scalar="strokeWidth"
          labels={[
            "Top border width",
            "Right border width",
            "Bottom border width",
            "Left border width",
          ]}
          prefixes={["T", "R", "B", "L"]}
        />
      ) : null}
    </OptionalSection>
  );
}

function LayerSection({ doc, node, selection }: Props) {
  const [open, setOpen] = useOptional(node.id, false);
  const excluded = descendants(doc, node.id);
  const frames = pageNodes(doc).filter((n) => n.type === "frame" && !excluded.has(n.id));
  return (
    <OptionalSection id="layer-section" title="Layer" open={open} onOpenChange={setOpen}>
      <Caption label="Name">
        <Field
          name="name"
          label="Layer name"
          value={node.name}
          onCommit={(value) => setField(selection, node, "name", value)}
        />
      </Caption>
      <Caption label="Parent frame">
        <NativeSelect
          name="parentId"
          label="Parent frame"
          value={node.parentId ?? ""}
          onChange={(value) => setField(selection, node, "parentId", value)}
          options={[
            { value: "", label: "Canvas" },
            ...frames.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </Caption>
      <div className="grid grid-cols-4 gap-2">
        <ActionButton id="scale-down" label="Scale ½" onClick={() => formClick("scale-down")}>
          ½×
        </ActionButton>
        <ActionButton id="scale-up" label="Scale 2×" onClick={() => formClick("scale-up")}>
          2×
        </ActionButton>
        <ActionButton id="duplicate" label="Duplicate layer" onClick={() => formClick("duplicate")}>
          <Copy className="size-3.5" aria-hidden />
        </ActionButton>
        <ActionButton
          id="delete"
          label="Delete layer"
          onClick={() => formClick("delete")}
          destructive
        >
          <Trash2 className="size-3.5" aria-hidden />
        </ActionButton>
      </div>
    </OptionalSection>
  );
}

function ActionButton({
  id,
  label,
  onClick,
  children,
  destructive,
}: {
  id?: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-6 items-center justify-center rounded-md bg-input text-xs text-foreground-2 shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring",
        destructive && "hover:text-destructive",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- Panel body ---------- */
export function PropertiesBody({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node | undefined;
  selection: string[];
}) {
  // Slots keep fixed positions so the always-mounted Fill section (with #shader-settings / #fill-hex) never remounts.
  return (
    <>
      {node ? <PositionSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <LayoutSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <AppearanceSection doc={doc} node={node} selection={selection} /> : null}
      {node?.type === "text" ? (
        <TypographySection key={node.id} doc={doc} node={node} selection={selection} />
      ) : null}
      {node ? <SvgColorsSection key={node.id} doc={doc} node={node} selection={selection} /> : null}
      <FillSection doc={doc} node={node} selection={selection} />
      {node ? <BorderSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <OutlineSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <ShadowSection key={"shadow-" + node.id} doc={doc} node={node} selection={selection} /> : null}
      {node ? <FilterSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <MaskSection key={"mask-" + node.id} doc={doc} node={node} selection={selection} /> : null}
      {node ? <ExportSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <LayerSection doc={doc} node={node} selection={selection} /> : null}
      {!node ? <PageSection doc={doc} /> : null}
    </>
  );
}
