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
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Copy,
  Diamond,
  Eye,
  EyeOff,
  LayoutGrid,
  GitCommitHorizontal,
  Proportions,
  RotateCcw,
  RotateCw,
  RotateCwSquare,
  Scan,
  Shapes,
  Square,
  SquareDashed,
  Trash2,
  Check,
} from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { ShaderIcon, StackColumnIcon, StackRowIcon } from "@/components/icons";
import { activePage, type DesignDocument } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Segmented,
  Swatch,
  type IconType,
} from "./controls";
import { formClick, notify } from "./legacy";
import { ColorPopover } from "./color-picker";
import { BindableField } from "./bind";
import { EXPORT_FORMATS, EXPORT_SCALES, exportArtwork, type ExportFormat } from "./export";
import { toast } from "sonner";
import { alphaPercent, parseColor, toHex, withAlpha } from "./color";
import {
  HEX,
  SHADER_PRESETS,
  descendants,
  fmt,
  hexLabel,
  pageNodes,
  parentOf,
  parseHex,
  patchNodes,
  setField,
  sizingAllowed,
  sizingMode,
  type Node,
  type SizingMode,
} from "./model";
import { TypographySection } from "./typography";

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
        <Field
          name="zIndex"
          label="Stack order"
          numeric
          className="col-span-2"
          value={fmt(node.zIndex)}
          onCommit={set("zIndex")}
          prefix={<Affix>Z</Affix>}
        />
      </div>
    </Section>
  );
}

/* ---------- Layout ---------- */
// Flexbox uses the same stack glyph as the frame's layer row (sidebar/icons.tsx), following its direction.
const display = (direction: string) => [
  { value: "free", label: "Free position", icon: Shapes },
  {
    value: "flex",
    label: "Flexbox",
    icon: direction === "column" ? StackColumnIcon : StackRowIcon,
  },
  { value: "block", label: "Block flow", icon: Square },
  { value: "grid", label: "Grid", icon: LayoutGrid },
];
const DIRECTION = [
  { value: "row", label: "Horizontal", icon: ArrowRight },
  { value: "column", label: "Vertical", icon: ArrowDown },
];
const UNIT_LABEL: Record<SizingMode, string> = { fixed: "px", hug: "Hug", fill: "Fill" };

function SizeField({
  node,
  parent,
  axis,
  selection,
}: Props & { parent: Node | undefined; axis: "w" | "h" }) {
  const mode = sizingMode(node, axis, parent);
  return (
    <Field
      name={axis}
      label={axis === "w" ? "Width" : "Height"}
      numeric
      value={fmt(node[axis])}
      onCommit={(value) => setField(selection, node, axis, value)}
      prefix={<Affix>{axis.toUpperCase()}</Affix>}
      className="pr-1"
      suffix={
        <NativeSelect
          bare
          name={axis + "Mode"}
          label={(axis === "w" ? "Width" : "Height") + " sizing"}
          value={mode}
          className="text-muted-foreground"
          options={(["fixed", "hug", "fill"] as SizingMode[]).map((m) => ({
            value: m,
            label: UNIT_LABEL[m],
            disabled: !sizingAllowed(node, parent, m),
          }))}
          onChange={(value) => setField(selection, node, axis + "Mode", value)}
        />
      }
    />
  );
}

function LayoutSection(props: Props) {
  const { doc, node, selection } = props;
  const parent = parentOf(doc, node);
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const frame = node.type === "frame";
  const layout = node.layout === "inline" ? "block" : node.layout;
  const flow = frame && node.layout !== "free";
  const gapField = (
    <BindableField
      doc={doc}
      node={node}
      selection={selection}
      field="gap"
      label="Gap"
      prefix={<Affix>↔</Affix>}
    >
      {(suffix) => (
        <Field
          name="gap"
          label="Gap"
          numeric
          value={fmt(node.gap)}
          onCommit={set("gap")}
          prefix={<Affix>↔</Affix>}
          suffix={suffix}
        />
      )}
    </BindableField>
  );
  return (
    <Section
      id="layout-section"
      title="Layout"
      tools={
        frame ? (
          <IconButton
            icon={GitCommitHorizontal}
            label={flow ? "Remove auto layout" : "Add auto layout"}
            active={flow}
            onClick={() => set("layout")(flow ? "free" : "flex")}
          />
        ) : null
      }
    >
      {frame ? (
        <Caption label="Display">
          <Segmented
            label="Display"
            hook="insp-display"
            dataKey="layout"
            value={layout}
            onChange={set("layout")}
            items={display(node.direction)}
          />
        </Caption>
      ) : null}
      {frame && node.layout === "flex" ? (
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Direction">
            <Segmented
              label="Direction"
              value={node.direction}
              onChange={set("direction")}
              items={DIRECTION}
            />
          </Caption>
          <Caption label="Gap">{gapField}</Caption>
        </div>
      ) : null}
      {flow ? (
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Padding">
            <BindableField
              doc={doc}
              node={node}
              selection={selection}
              field="padding"
              label="Padding"
              prefix={<IconAffix icon={Scan} />}
            >
              {(suffix) => (
                <Field
                  name="padding"
                  label="Padding"
                  numeric
                  value={fmt(node.padding)}
                  onCommit={set("padding")}
                  prefix={<IconAffix icon={Scan} />}
                  suffix={suffix}
                />
              )}
            </BindableField>
          </Caption>
          {node.layout === "grid" ? (
            <Caption label="Columns">
              <Field
                name="columns"
                label="Grid columns"
                numeric
                value={fmt(node.columns)}
                onCommit={set("columns")}
                prefix={<Affix>#</Affix>}
              />
            </Caption>
          ) : node.layout !== "flex" ? (
            <Caption label="Gap">{gapField}</Caption>
          ) : null}
        </div>
      ) : null}
      {frame && node.layout === "grid" ? (
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Gap">{gapField}</Caption>
        </div>
      ) : null}
      {frame && (node.layout === "flex" || node.layout === "grid") ? (
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Align">
            <NativeSelect
              name="alignItems"
              label="Cross axis alignment"
              value={node.alignItems}
              onChange={set("alignItems")}
              options={["stretch", "flex-start", "center", "flex-end"].map((v) => ({
                value: v,
                label: v.replace("flex-", ""),
              }))}
            />
          </Caption>
          <Caption label="Justify">
            <NativeSelect
              name="justifyContent"
              label="Main axis alignment"
              value={node.justifyContent}
              onChange={set("justifyContent")}
              options={["flex-start", "center", "flex-end", "space-between", "space-around"].map(
                (v) => ({
                  value: v,
                  label: v.replace("flex-", ""),
                }),
              )}
            />
          </Caption>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <SizeField {...props} parent={parent} axis="w" />
          <SizeField {...props} parent={parent} axis="h" />
        </div>
        <IconButton
          icon={Proportions}
          label="Hug contents"
          disabled={!sizingAllowed(node, parent, "hug")}
          onClick={() => patchNodes([node.id], () => ({ wMode: "hug", hMode: "hug" }))}
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
  const hidden = !!node.hidden;
  return (
    <Section
      id="appearance-section"
      title="Appearance"
      tools={
        <IconButton
          id="appearance-visibility"
          icon={hidden ? EyeOff : Eye}
          label={hidden ? "Show layer" : "Hide layer"}
          onClick={() => patchNodes(selection, () => ({ hidden: !hidden }))}
        />
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
                value={fmt(node.radius)}
                onCommit={set("radius")}
                prefix={<IconAffix icon={Scan} />}
                suffix={suffix}
              />
            )}
          </BindableField>
        </Caption>
        <span className="size-6 shrink-0" aria-hidden />
      </div>
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

/* ---------- Fill ---------- */
function VariableMenu({ doc, node, selection }: Props) {
  const tokens = Object.entries(doc.tokens ?? {});
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton icon={ShaderIcon} label="Apply variable" active={!!node.token} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start" sideOffset={12} className="w-48">
        <div className="flex h-7 items-center gap-2 px-2 text-xs text-foreground-3">
          <Diamond className="size-3.5" aria-hidden />
          Apply variable
        </div>
        <DropdownMenuSeparator />
        {tokens.map(([name, color]) => (
          <DropdownMenuItem key={name} onSelect={() => setField(selection, node, "token", name)}>
            <Swatch color={color} className="size-3.5" />
            <span className="flex-1 truncate">{name}</span>
            {node.token === name ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        {!tokens.length ? (
          <DropdownMenuItem disabled>No colour variables yet</DropdownMenuItem>
        ) : null}
        {node.token ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setField(selection, node, "token", "")}>
              Detach variable
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Live canvas preview while dragging in the colour picker (committed on release through updateNodes). */
function previewFill(nodes: Node[], color: string) {
  for (const n of nodes) {
    const el = document.querySelector<HTMLElement>(`#canvas [data-id="${CSS.escape(n.id)}"]`);
    if (!el) continue;
    if (n.type === "text") el.style.color = color;
    else el.style.backgroundColor = color;
  }
}

function PaintRow({ doc, node, selection }: Props) {
  const [open, setOpen] = useState(false);
  const tokenColor = node.token ? doc.tokens?.[node.token] : undefined;
  const color = tokenColor || node.color;
  const hidden = !!node.hidden;
  const selected = pageNodes(doc).filter((n) => selection.includes(n.id));
  const commit = (next: string) => patchNodes(selection, () => ({ color: next, token: "" }));
  return (
    <div className="flex items-center gap-2">
      <ColorPopover
        open={open}
        onOpenChange={setOpen}
        value={color}
        onPreview={(next) => previewFill(selected, next)}
        onCommit={commit}
        tokens={doc.tokens}
        token={node.token}
        onToken={(name) => setField(selection, node, "token", name)}
      >
        <div
          data-color-anchor
          className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field focus-within:ring-1 focus-within:ring-ring"
        >
          <button
            type="button"
            name="color"
            aria-label="Fill colour"
            aria-expanded={open}
            title="Pick colour"
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setOpen(!open)}
          >
            <Swatch color={color} className="size-4.5 rounded-sm" />
          </button>
          {node.token ? (
            <span
              className="min-w-0 flex-1 truncate pl-1 text-foreground"
              title={`Variable: ${node.token}`}
            >
              {node.token}
            </span>
          ) : (
            <Field
              label="Fill hex colour"
              value={hexLabel(node.color)}
              placeholder={HEX.test(node.color) ? "" : node.color}
              className="h-5 flex-1 bg-transparent px-1 shadow-none focus-within:ring-0"
              inputClassName="uppercase"
              onCommit={(value) => {
                const hex =
                  parseHex(value, node.color) ??
                  (parseColor(value) ? toHex(parseColor(value)!) : null);
                if (!hex) return "Use a hex colour such as A58BDD";
                commit(hex);
              }}
            />
          )}
          <Field
            label="Fill opacity"
            numeric
            disabled={!!node.token}
            value={String(alphaPercent(color))}
            className="h-5 w-12 shrink-0 bg-transparent px-0 shadow-none focus-within:ring-0"
            inputClassName="text-right"
            suffix="%"
            onCommit={(value) => {
              const n = Number(value);
              const next = Number.isFinite(n) ? withAlpha(node.color, n) : null;
              if (!next) return "Enter a percentage";
              commit(next);
            }}
          />
        </div>
      </ColorPopover>
      <IconButton
        icon={hidden ? EyeOff : Eye}
        label={hidden ? "Show layer" : "Hide layer"}
        onClick={() => patchNodes(selection, () => ({ hidden: !hidden }))}
      />
    </div>
  );
}

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
        {node ? <VariableMenu doc={doc} node={node} selection={selection} /> : null}
      </div>
      <div className="flex flex-col gap-2 px-3 pt-1 pb-2.75">
        <ShaderSettings node={node} selection={selection} />
        {node ? (
          <>
            <PaintRow doc={doc} node={node} selection={selection} />
            <div className="grid grid-cols-2 gap-2">
              <Caption label="Gradient">
                <Field
                  name="gradient"
                  label="Gradient (CSS)"
                  value={node.gradient}
                  placeholder="linear-gradient(…)"
                  onCommit={set("gradient")}
                />
              </Caption>
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
  const [open, setOpen] = useOptional(node.id, node.strokeWidth > 0);
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
                value={fmt(node.strokeWidth)}
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
    </OptionalSection>
  );
}

function ShadowSection({ node, selection }: Props) {
  const [open, setOpen] = useOptional(node.id, !!node.shadow);
  return (
    <OptionalSection id="shadow-section" title="Shadow" open={open} onOpenChange={setOpen}>
      <Field
        name="shadow"
        label="Box shadow (CSS)"
        value={node.shadow}
        placeholder="0 8px 24px #0003"
        onCommit={(value) => setField(selection, node, "shadow", value)}
      />
    </OptionalSection>
  );
}

function MaskSection({ node, selection }: Props) {
  const [open, setOpen] = useOptional(node.id, !!node.mask);
  return (
    <OptionalSection id="mask-section" title="Mask" open={open} onOpenChange={setOpen}>
      <Field
        name="mask"
        label="Mask gradient (CSS)"
        value={node.mask}
        placeholder="linear-gradient(black, transparent)"
        onCommit={(value) => setField(selection, node, "mask", value)}
      />
    </OptionalSection>
  );
}

function ExportSection({ node, selection }: Props) {
  const [open, setOpen] = useOptional(node.id, false);
  const [format, setFormat] = useState<ExportFormat>("PNG");
  const [scale, setScale] = useState("2");
  const [scope, setScope] = useState("selection");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const fileName = name ?? node.name;
  useEffect(() => {
    setName(null);
    setStatus("");
  }, [node.id]);
  const label = EXPORT_FORMATS.find((f) => f.value === format)!.label;
  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const count = scope === "selection" ? selection.length : 1;
      const saved = await exportArtwork({
        format,
        scale: Number(scale),
        selectionOnly: scope === "selection",
        name: fileName,
      });
      if (!saved) return; // save dialog cancelled
      const message = `Exported ${count} ${count === 1 ? "element" : "elements"}`;
      setStatus(`${message} · ${saved}`);
      toast.success(message, { id: "artwork-export", description: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      toast.error("Export failed", { id: "artwork-export", description: message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <OptionalSection id="export-section" title="Export" open={open} onOpenChange={setOpen}>
      <div className="grid grid-cols-3 gap-2">
        <Field
          label="Export file name"
          className="col-span-2"
          value={fileName}
          onCommit={(value) => setName(value.trim() || null)}
        />
        <NativeSelect
          id="artwork-scope"
          label="Export scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "selection", label: "Selection" },
            { value: "page", label: "Page" },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect
          id="artwork-scale"
          label="Export scale"
          value={scale}
          onChange={setScale}
          options={EXPORT_SCALES.map((v) => ({
            value: v,
            label: v + "x",
            disabled: format === "PDF" || format === "HTML" ? v !== "1" : false,
          }))}
        />
        <NativeSelect
          id="artwork-format"
          label="Export format"
          value={format}
          onChange={(v) => {
            setFormat(v as ExportFormat);
            if (v === "PDF" || v === "HTML") setScale("1");
          }}
          options={EXPORT_FORMATS}
        />
      </div>
      <button
        type="button"
        id="artwork-download"
        disabled={busy}
        className="flex h-6 items-center justify-center rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        onClick={run}
      >
        {busy ? "Exporting…" : `Export as ${label}`}
      </button>
      <p
        id="artwork-status"
        role="status"
        className="truncate text-2xs text-subtle-foreground empty:hidden"
        title={status}
      >
        {status}
      </p>
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
      <FillSection doc={doc} node={node} selection={selection} />
      {node ? <BorderSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <ShadowSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <MaskSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <ExportSection doc={doc} node={node} selection={selection} /> : null}
      {node ? <LayerSection doc={doc} node={node} selection={selection} /> : null}
      {!node ? <PageSection doc={doc} /> : null}
    </>
  );
}
