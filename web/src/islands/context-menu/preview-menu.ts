// The canvas context menu of a live preview frame (preview audit PF5, design/wonder/preview-audit/wonder/PF5-context.png).
// Wonder's order: Copy ⌘C [disabled], Copy as › [disabled], Copy link to selection | Select layer ›, Paste ⌘V,
// Paste styles ⌘⌥V, Paste to replace ⌘⇧R, Paste over selection ⌘⇧V, Duplicate ⌘D [disabled] | Hide ⌘⇧H, Lock ⌘⇧L |
// Arrange ›, Show terminal, Clear preview data, Clear preview data (including logins) | Layout › | Set as file
// thumbnail. The shared rows come from the layer menu (model.ts) so labels and commands stay in one place.
//
// "Set as file thumbnail" is listed disabled: Verynize file cards always draw the active page and have no chosen
// thumbnail, and a live preview has no static picture to draw.
import { activePage, design, type LayerNode } from "@/lib/bridge";
import { layerMenu, type Entry } from "./model";
import { platform } from "@/lib/platform";

type PreviewData = { root: string; url?: string };
type LivePreview = {
  showTerminal?: (id: string) => void;
  getNodeId?: () => string | null;
  getURL?: () => string;
};

const live = () => (window as unknown as { livePreview?: LivePreview }).livePreview;
const desktop = () => platform.desktop;
/** The status footer, like the inspector's validation messages. */
const notify = (message: string) => {
  const footer = document.querySelector("footer");
  if (footer) footer.textContent = message;
};

/** The single selected layer when it is a live preview frame. */
export function selectedPreview(): LayerNode | null {
  const ids = design().getSelection();
  if (ids.length !== 1) return null;
  const node = activePage(design().getDocument())?.nodes.find((n) => n.id === ids[0]);
  return node && node.type === "frame" && !node.parentId && node.preview ? node : null;
}

/** The app URL of a preview frame: the live one while it is the active preview, else the one it remembers. */
function previewURL(node: LayerNode) {
  const api = live();
  if (api?.getNodeId?.() === node.id && api.getURL?.()) return api.getURL();
  return (node.preview as PreviewData).url || "";
}

async function clearData(node: LayerNode, logins: boolean) {
  const url = previewURL(node);
  const clear = desktop()?.previewClearData;
  if (!url || !clear) return;
  try {
    await clear({ url, logins });
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function find(entries: Entry[], command: string): Entry | null {
  return entries.find((e) => e.type !== "separator" && e.command === command) ?? null;
}

const disabled = (entry: Entry | null): Entry | null =>
  entry && entry.type !== "separator" ? { ...entry, disabled: true } : entry;

export function previewMenu(node: LayerNode, under: string[]): Entry[] {
  const base = layerMenu("canvas", under);
  const pick = (command: string) => find(base, command);
  const have = new Set(
    design()
      .commands()
      .map((c) => c.id),
  );
  const canPaste =
    (
      window as unknown as { BetterCanvas?: { canPaste?: () => boolean } }
    ).BetterCanvas?.canPaste?.() ?? true;
  const url = previewURL(node);
  const clearable = !!url && !!desktop()?.previewClearData;
  const groups: (Entry | null)[][] = [
    [disabled(pick("edit.copy")), disabled(pick("menu.copyAs")), pick("clipboard.copyLink")],
    [
      pick("menu.selectLayer"),
      pick("edit.paste"),
      {
        type: "item",
        command: "edit.pasteStyle",
        label: "Paste styles",
        shortcut: "⌘⌥V",
        disabled: !have.has("edit.pasteStyle") || !canPaste,
        run: () => design().runCommand("edit.pasteStyle"),
      },
      pick("clipboard.pasteToReplace"),
      pick("clipboard.pasteOverSelection"),
      disabled(pick("edit.duplicate")),
    ],
    [pick("layer.visibility"), pick("layer.lock")],
    [
      pick("menu.arrange"),
      {
        type: "item",
        command: "preview.showTerminal",
        label: "Show terminal",
        disabled: !live()?.showTerminal,
        run: () => live()?.showTerminal?.(node.id),
      },
      {
        type: "item",
        command: "preview.clearData",
        label: "Clear preview data",
        disabled: !clearable,
        run: () => void clearData(node, false),
      },
      {
        type: "item",
        command: "preview.clearDataAndLogins",
        label: "Clear preview data (including logins)",
        disabled: !clearable,
        run: () => void clearData(node, true),
      },
    ],
    [pick("menu.layout")],
    [
      {
        type: "item",
        command: "preview.setThumbnail",
        label: "Set as file thumbnail",
        disabled: true,
        run: () => {},
      },
    ],
  ];
  const out: Entry[] = [];
  for (const group of groups) {
    const items = group.filter((e): e is Entry => !!e);
    if (!items.length) continue;
    if (out.length) out.push({ type: "separator" });
    out.push(...items);
  }
  return out;
}
