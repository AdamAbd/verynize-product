// Floating controls inside #workspace: bottom toolbar + views menu (20/22/19), page pill (22/29), `?` help and the
// zoom readout + zoom menu. Rendered through a portal into a host appended to #workspace.
import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { Popover } from "radix-ui";
import {
  Check,
  ChevronsUpDown,
  Circle,
  File,
  Hand,
  MousePointer2,
  Pin,
  Pipette,
  SquareArrowUpRight,
  Scan,
  Type,
} from "lucide-react";
import {
  activePage,
  legacySet,
  legacy,
  portalContainer,
  useBodyClass,
  useDesign,
} from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  CanvasLayoutIcon,
  DesignLayoutIcon,
  DetailsLayoutIcon,
  LogoIcon,
  PanelLeftIcon,
  ShaderIcon,
  PlusIcon,
} from "@/components/icons";
import {
  applyLayout,
  currentLayout,
  isExactLayout,
  LAYOUTS,
  toggleBodyClass,
  useAppliedLayout,
  useTool,
  useZoom,
  type LayoutName,
} from "./hooks";
import { initialSnap, run } from "./legacy";
import {
  Kbd,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuItemIndicator,
  MenuLabel,
  MenuPseudoLabelItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  Shortcut,
} from "./menu";
import { Tip } from "./tip";
import { PreviewToolbar } from "./PreviewToolbar";

type Icon = ComponentType<{ className?: string }>;
const TOOLS: { id: string; tool: string; label: string; key: string; icon: Icon }[] = [
  { id: "select-tool", tool: "move", label: "Move", key: "V", icon: MousePointer2 },
  { id: "scale-tool", tool: "scale", label: "Scale", key: "K", icon: SquareArrowUpRight },
  { id: "pan-tool", tool: "hand", label: "Hand", key: "H", icon: Hand },
  { id: "eyedropper-tool", tool: "eyedropper", label: "Eyedropper", key: "I", icon: Pipette },
  { id: "add-frame", tool: "frame", label: "Frame", key: "F", icon: Scan },
  { id: "add-ellipse", tool: "ellipse", label: "Ellipse", key: "O", icon: Circle },
  { id: "add-shader", tool: "shader", label: "Shader", key: "S", icon: ShaderIcon },
  { id: "text", tool: "text", label: "Text", key: "T", icon: Type },
];
/** Index of the first creation tool (Frame); a divider separates it from the pointer tools. */
const TOOL_GROUP_SPLIT = TOOLS.findIndex((t) => t.id === "add-frame");
const LAYOUT_ICONS: Record<LayoutName, Icon> = {
  details: DetailsLayoutIcon,
  design: DesignLayoutIcon,
  canvas: CanvasLayoutIcon,
};

// 32px tool buttons (22): resets legacy `#canvas-toolbar button` rules (padding, min-width, borders, backgrounds).
const toolButton =
  "flex size-8 min-w-0 shrink-0 items-center justify-center rounded-xl border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset [&_svg]:size-5";
const layoutButton =
  "flex size-7 min-w-0 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:size-5";
const floating = "absolute z-30 border border-toolbar-edge bg-background";

export function CanvasOverlays() {
  const filesView = useBodyClass("files-view");
  const leftCollapsed = useBodyClass("left-collapsed");
  if (filesView) return <ZoomProxies />;
  return (
    <>
      <Toolbar />
      <PreviewToolbar />
      {leftCollapsed && <PagePill />}
      <Help />
      <Zoom />
    </>
  );
}

/* ---------- Bottom toolbar ---------- */
function Toolbar() {
  const tool = useTool();
  useBodyClass("left-collapsed");
  useBodyClass("right-collapsed");
  const layout = currentLayout();
  const applied = useAppliedLayout() === layout && isExactLayout();
  return (
    <div
      id="canvas-toolbar"
      role="toolbar"
      aria-label="Canvas tools"
      className={cn(
        floating,
        "bottom-3 left-1/2 flex h-11 -translate-x-1/2 transform-none items-stretch gap-0 rounded-3xl p-0 shadow-toolbar",
      )}
    >
      <div className="flex items-center gap-1 pr-2 pl-1.5">
        {TOOLS.map(({ id, tool: name, label, key, icon: Icon }, index) => (
          <ToolSlot key={id} separator={index === TOOL_GROUP_SPLIT}>
            <Tip label={label} shortcut={key}>
              <button
                type="button"
                id={id}
                aria-label={label}
                aria-pressed={tool === name}
                className={cn(
                  toolButton,
                  tool === name && "bg-accent text-foreground hover:bg-accent",
                )}
                onClick={() => run(id)}
              >
                <Icon />
              </button>
            </Tip>
          </ToolSlot>
        ))}
      </div>
      <span aria-hidden="true" className="w-px shrink-0 bg-toolbar-divider" />
      <div className="flex items-center pr-1.5 pl-2">
        <div className="flex h-8 items-center gap-0.5 rounded-xl bg-muted p-0.5">
          {LAYOUTS.filter((l) => l.name !== "canvas").map(({ name, label, key }) => {
            const Icon = LAYOUT_ICONS[name];
            return (
              <Tip key={name} label={label} shortcut={`⌥${key}`}>
                <button
                  type="button"
                  id={`layout-${name}`}
                  aria-label={`${label} layout`}
                  aria-pressed={applied && layout === name}
                  className={cn(
                    layoutButton,
                    applied &&
                      layout === name &&
                      "bg-accent text-primary-text hover:text-primary-text",
                  )}
                  onClick={() => applyLayout(name)}
                >
                  <Icon />
                </button>
              </Tip>
            );
          })}
          <ViewMenu layout={layout} />
        </div>
      </div>
    </div>
  );
}

function ToolSlot({ separator, children }: { separator: boolean; children: ReactNode }) {
  return (
    <>
      {separator && <span aria-hidden="true" className="h-5 w-px shrink-0 bg-toolbar-divider" />}
      {children}
    </>
  );
}

/* ---------- Views menu (19) ---------- */
function ViewMenu({ layout }: { layout: LayoutName }) {
  const [open, setOpen] = useState(false);
  const edited = useAppliedLayout() !== layout || !isExactLayout();
  const label = LAYOUTS.find((l) => l.name === layout)?.label ?? "Design";
  const choose = applyLayout;
  return (
    <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
      <Tip label="Views">
        <MenuTrigger asChild>
          <button
            type="button"
            id="bd-view-menu-button"
            aria-label="Views"
            className={layoutButton}
          >
            <PlusIcon />
          </button>
        </MenuTrigger>
      </Tip>
      <MenuContent side="top" align="end" sideOffset={8} className="w-view-menu">
        <MenuGroup>
          <MenuLabel>
            {label}
            {edited ? " · edited" : ""}
          </MenuLabel>
          <MenuItem onSelect={() => run("saved-views-open")}>Save current view</MenuItem>
          <MenuItem
            onSelect={() => {
              choose(layout);
              run("zoom-fit");
            }}
          >
            Reset to {label}
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          {LAYOUTS.map(({ name, label: text, key }) => {
            const Icon = LAYOUT_ICONS[name];
            return (
              <MenuItem key={name} aria-checked={layout === name} onSelect={() => choose(name)}>
                <Icon />
                {text}
                {name !== "canvas" && <Pin className="size-3.5 rotate-45 text-muted-foreground" />}
                <Kbd keys={["⌥", key]} className="mr-4" />
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}

/* ---------- Page pill (sidebar hidden / chat open) ---------- */
function PagePill() {
  const doc = useDesign();
  const page = doc ? activePage(doc) : null;
  return (
    <div
      id="bd-page-pill"
      role="group"
      aria-label="Page"
      className={cn(
        floating,
        "top-1.75 left-1.75 flex h-10.5 w-page-pill items-center rounded-lg p-1.5",
      )}
    >
      <Tip label="Main menu" side="bottom">
        <button
          type="button"
          aria-label="Main menu"
          ref={markAppMenuTrigger}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4"
        >
          <LogoIcon />
        </button>
      </Tip>
      <MenuRoot modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch page"
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-xs text-foreground outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-muted"
          >
            <span className="truncate">{page?.name ?? "Page"}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" sideOffset={10} alignOffset={-36} className="w-page-pill">
          <MenuGroup>
            <MenuLabel>Pages</MenuLabel>
            {doc?.pages.map((p) => (
              <MenuItem
                key={p.id}
                aria-checked={p.id === doc.activePage}
                onSelect={() => window.design.setActivePage(p.id)}
              >
                <File />
                <span className="truncate">{p.name}</span>
                {p.id === doc.activePage && <Check className="ml-auto" />}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuItem onSelect={() => run("add-page")}>
              <PlusIcon />
              New page
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </MenuRoot>
      <div className="flex-1" />
      <Tip label="Show sidebar" side="bottom">
        <button
          type="button"
          aria-label="Show sidebar"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4"
          onClick={() => toggleBodyClass("left-collapsed", false)}
        >
          <PanelLeftIcon />
        </button>
      </Tip>
    </div>
  );
}

/** `.app-menu-trigger` is the cross-island contract class (tests click `.app-menu-trigger:visible`); it is a marker,
 * not a Tailwind class, so it is added outside className. */
function markAppMenuTrigger(node: HTMLButtonElement | null) {
  node?.classList.add("app-menu-trigger");
}

/* ---------- `?` help ---------- */
const SHORTCUTS: [string, string][] = [
  ["Move", "V"],
  ["Scale", "K"],
  ["Hand", "H / Space"],
  ["Frame", "F"],
  ["Rectangle", "R"],
  ["Ellipse", "O"],
  ["Text", "T"],
  ["Shader", "S"],
  ["Eyedropper", "I"],
  ["Flip horizontal / vertical", "⇧H / ⇧V"],
  ["Rotate 90°", "⌥⇧R"],
  ["Zoom in / out", "⌘+ / ⌘−"],
  ["Zoom to fit", "⇧1"],
  ["Zoom to 100%", "⇧0"],
  ["Undo / Redo", "⌘Z / ⇧⌘Z"],
  ["Nudge", "Arrows"],
  ["Multi-select", "Shift click"],
  ["Search files", "⌘K"],
  ["Details · Design · Canvas", "⌥1 ⌥2 ⌥0"],
];
function Help() {
  return (
    <Popover.Root>
      <Tip label="Help and shortcuts" side="right">
        <Popover.Trigger asChild>
          <button
            type="button"
            id="bd-canvas-help"
            aria-label="Help and keyboard shortcuts"
            className="absolute bottom-1.75 left-1.75 z-30 flex size-6.5 items-center justify-center rounded-full border border-edge bg-help text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:text-foreground"
          >
            ?
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal container={portalContainer()}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label="Keyboard shortcuts"
          className="z-50 w-view-menu rounded-2xl border border-menu-edge bg-background p-1 text-xs text-foreground shadow-menu outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="flex h-6.25 items-center px-1.5 text-muted-foreground">
            Keyboard shortcuts
          </p>
          <dl className="m-0 flex flex-col gap-px">
            {SHORTCUTS.map(([label, keys]) => (
              <div key={label} className="flex h-6.25 items-center gap-2 px-1.5">
                <dt className="truncate">{label}</dt>
                <dd className="m-0 ml-auto shrink-0 text-muted-foreground">{keys}</dd>
              </div>
            ))}
          </dl>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------- Zoom readout + menu ---------- */
let snapState = initialSnap;
function useSnap(): [boolean, (value: boolean) => void] {
  const [snap, setSnapState] = useState(() => snapState);
  return [
    snap,
    (value) => {
      snapState = value;
      setSnapState(value);
      legacySet(legacy<HTMLInputElement>("snap"), value);
    },
  ];
}

function Zoom() {
  const zoom = useZoom();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useSnap();
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // Legacy drag code reads `$('#snap')?.checked`; give the menu item the same property.
  const snapItem = (node: HTMLElement | null) => {
    if (node && !Object.prototype.hasOwnProperty.call(node, "checked"))
      Object.defineProperty(node, "checked", { configurable: true, get: () => snapRef.current });
  };
  return (
    <>
      <MenuRoot open={open} onOpenChange={setOpen} modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            id="zoom-menu-button"
            aria-label={`Zoom ${zoom}%`}
            className="absolute right-2 bottom-2 z-30 flex h-6 items-center rounded-md px-2 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground"
          >
            {zoom}%
          </button>
        </MenuTrigger>
        <MenuContent
          id="bd-zoom-menu"
          aria-label="Zoom"
          side="top"
          align="end"
          sideOffset={6}
          className="w-view-menu"
        >
          <MenuGroup>
            <MenuItem id="zoom-in" onSelect={() => run("zoom-in")}>
              Zoom in
              <Shortcut>⌘+</Shortcut>
            </MenuItem>
            <MenuItem id="zoom-out" onSelect={() => run("zoom-out")}>
              Zoom out
              <Shortcut>⌘−</Shortcut>
            </MenuItem>
            <MenuItem id="zoom-fit" onSelect={() => run("zoom-fit")}>
              Zoom to fit
              <Shortcut>⇧1</Shortcut>
            </MenuItem>
            {/* Text content stays the live percentage (tests and legacy applyCamera() use it); the visible
                label comes from chrome.css ::before/::after. */}
            <MenuPseudoLabelItem
              id="zoom-reset"
              data-zoom-reset=""
              aria-label="Zoom to 100%"
              onSelect={() => run("zoom-reset")}
            >
              {`${zoom}%`}
            </MenuPseudoLabelItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuCheckboxItem
              id="snap"
              ref={snapItem}
              checked={snap}
              onCheckedChange={(value) => setSnap(value === true)}
            >
              Snap to objects
              <span className="ml-auto flex size-4 items-center justify-center">
                <MenuItemIndicator>
                  <Check className="text-foreground" />
                </MenuItemIndicator>
              </span>
            </MenuCheckboxItem>
            <MenuItem id="saved-views-open" onSelect={() => run("saved-views-open")}>
              Saved views…
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </MenuRoot>
      {!open && <ZoomProxies zoom={zoom} snap={snap} setSnap={setSnap} />}
    </>
  );
}

/** Hidden owners of the zoom ids while the zoom menu is closed (or the editor is behind Files). */
function ZoomProxies({
  zoom,
  snap,
  setSnap,
}: {
  zoom?: number;
  snap?: boolean;
  setSnap?: (v: boolean) => void;
}) {
  const fallbackZoom = useZoom();
  const [fallbackSnap, setFallbackSnap] = useSnap();
  return (
    <div hidden data-chrome-proxies="zoom">
      {(["zoom-in", "zoom-out", "zoom-fit", "saved-views-open"] as const).map((id) => (
        <button key={id} type="button" id={id} tabIndex={-1} onClick={() => run(id)} />
      ))}
      <button type="button" id="zoom-reset" tabIndex={-1} onClick={() => run("zoom-reset")}>
        {`${zoom ?? fallbackZoom}%`}
      </button>
      <input
        type="checkbox"
        id="snap"
        tabIndex={-1}
        checked={snap ?? fallbackSnap}
        onChange={(event) => (setSnap ?? setFallbackSnap)(event.target.checked)}
      />
    </div>
  );
}
