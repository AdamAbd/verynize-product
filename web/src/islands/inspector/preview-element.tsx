// Inspector for a DOM element selected in a live preview's Edit mode (Wonder PM3-inspector): Position (read-only),
// Layout (W/H, padding, margin), Appearance (opacity, corner radius), Typography and Text Fill. Values are the page's
// computed styles; editing one stages a transient style on the element through window.previewEdits (web/preview-edit.js).
import { useSyncExternalStore } from "react";
import { Scan } from "lucide-react";
import {
  FontSizeIcon,
  LineHeightIcon,
  MarginXIcon,
  MarginYIcon,
  OpacityIcon,
  PaddingXIcon,
  PaddingYIcon,
} from "@/components/icons";
import { Affix, Caption, Field, IconAffix, NativeSelect, Section, Swatch } from "./controls";
import { WEIGHTS, weightName } from "./model";

type Styles = Record<string, string>;
export type PreviewElement = {
  path: string;
  tag: string;
  text: string;
  leaf: boolean;
  box: { x: number; y: number; width: number; height: number };
  position: { x: number; y: number };
  sizing?: { w: string; h: string };
  styles: Styles;
};
type Selection = { frameId: string; element: PreviewElement; editing: boolean } | null;
type EditsApi = { selection(): Selection; setStyle(prop: string, value: string): void };
const edits = () => (window as unknown as { previewEdits?: EditsApi }).previewEdits;

let cached: Selection = null;
let cachedKey = "";
function snapshot(): Selection {
  const next = edits()?.selection() ?? null;
  const key = next ? JSON.stringify(next) : "";
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}
function subscribe(callback: () => void) {
  window.addEventListener("bd:preview-element", callback);
  return () => window.removeEventListener("bd:preview-element", callback);
}
/** The DOM element selected in a preview's Edit mode, or null. */
export function usePreviewElement() {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

type LivePreviewApi = { getSelectionState?(): { mode?: string } | null };
const inEditMode = () =>
  (window as unknown as { livePreview?: LivePreviewApi }).livePreview?.getSelectionState?.()?.mode === "edit";
function subscribeMode(callback: () => void) {
  window.addEventListener("bd:preview-state", callback);
  return () => window.removeEventListener("bd:preview-state", callback);
}
/** The selected preview frame is in Edit mode. Until an element is picked, Wonder leaves Properties empty (PM3-hover). */
export function usePreviewEditMode() {
  return useSyncExternalStore(subscribeMode, inEditMode, () => false);
}

const r2 = (v: number) => String(Math.round(v * 100) / 100);
const px = (value: string | undefined) => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? r2(n) : "";
};
const firstFamily = (value: string) =>
  (value.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
function hex(color: string) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/.exec(color);
  if (!m) return { hex: "", alpha: 100 };
  const part = (v: string) => Math.round(Number(v)).toString(16).padStart(2, "0");
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
  return {
    hex: (part(m[1]) + part(m[2]) + part(m[3])).toUpperCase(),
    alpha: Math.round(alpha * 100),
  };
}
const length = (raw: string) => {
  const t = raw.trim();
  if (!t) return "";
  return /^-?\d*\.?\d+$/.test(t) ? t + "px" : t;
};

export function PreviewElementBody({ element }: { element: PreviewElement }) {
  const set =
    (prop: string, transform: (raw: string) => string = length) =>
    (raw: string) =>
      edits()?.setStyle(prop, transform(raw));
  const st = element.styles;
  const fill = hex(st.color || "");
  const lineHeight = st.lineHeight === "normal" ? "Auto" : px(st.lineHeight);
  const letterSpacing = st.letterSpacing === "normal" ? "0" : px(st.letterSpacing);
  const weight = String(st.fontWeight || "400");
  const weights = WEIGHTS.some(([v]) => v === weight)
    ? WEIGHTS
    : [...WEIGHTS, [weight, weightName(weight)] as [string, string]];
  return (
    <div id="preview-element-inspector" data-element-path={element.path}>
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <Field
            name="pe-x"
            label="X"
            value={r2(element.position.x)}
            onCommit={() => null}
            prefix={<Affix>X</Affix>}
            disabled
          />
          <Field
            name="pe-y"
            label="Y"
            value={r2(element.position.y)}
            onCommit={() => null}
            prefix={<Affix>Y</Affix>}
            disabled
          />
        </div>
      </Section>
      <Section title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <Field
            name="pe-width"
            label="Width"
            numeric
            value={r2(element.box.width)}
            onCommit={set("width")}
            prefix={<Affix>W</Affix>}
            suffix="px"
          />
          <Field
            name="pe-height"
            label="Height"
            numeric
            value={r2(element.box.height)}
            onCommit={set("height")}
            prefix={<Affix>H</Affix>}
            suffix="px"
          />
        </div>
        <Caption label="Padding">
          <div className="grid grid-cols-2 gap-2">
            <Field
              name="pe-padding-x"
              label="Horizontal padding"
              numeric
              value={px(st.paddingLeft)}
              onCommit={set("padding-inline")}
              prefix={<IconAffix icon={PaddingXIcon} />}
              suffix="px"
            />
            <Field
              name="pe-padding-y"
              label="Vertical padding"
              numeric
              value={px(st.paddingTop)}
              onCommit={set("padding-block")}
              prefix={<IconAffix icon={PaddingYIcon} />}
              suffix="px"
            />
          </div>
        </Caption>
        <Caption label="Margin">
          <div className="grid grid-cols-2 gap-2">
            <Field
              name="pe-margin-x"
              label="Horizontal margin"
              numeric
              value={px(st.marginLeft)}
              onCommit={set("margin-inline")}
              prefix={<IconAffix icon={MarginXIcon} />}
              suffix="px"
            />
            <Field
              name="pe-margin-y"
              label="Vertical margin"
              numeric
              value={px(st.marginTop)}
              onCommit={set("margin-block")}
              prefix={<IconAffix icon={MarginYIcon} />}
              suffix="px"
            />
          </div>
        </Caption>
      </Section>
      <Section title="Appearance">
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Opacity">
            <Field
              name="pe-opacity"
              label="Opacity"
              numeric
              value={r2(Number(st.opacity || 1) * 100)}
              onCommit={set("opacity", (raw) =>
                raw.trim() ? String(Math.max(0, Math.min(100, Number(raw))) / 100) : "",
              )}
              prefix={<IconAffix icon={OpacityIcon} />}
              suffix="%"
            />
          </Caption>
          <Caption label="Corner radius">
            <Field
              name="pe-radius"
              label="Corner radius"
              numeric
              value={px(st.borderRadius)}
              onCommit={set("border-radius")}
              prefix={<IconAffix icon={Scan} />}
            />
          </Caption>
        </div>
      </Section>
      <Section title="Typography">
        <Field
          name="pe-font-family"
          label="Font family"
          value={firstFamily(st.fontFamily || "")}
          onCommit={set("font-family", (raw) => raw.trim())}
        />
        <div className="grid grid-cols-2 gap-2">
          <NativeSelect
            name="pe-font-weight"
            label="Font weight"
            value={weight}
            options={weights.map(([value, label]) => ({ value, label }))}
            onChange={set("font-weight", (raw) => raw)}
          />
          <Field
            name="pe-font-size"
            label="Font size"
            numeric
            value={px(st.fontSize)}
            onCommit={set("font-size")}
            prefix={<IconAffix icon={FontSizeIcon} />}
            suffix="px"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Line height">
            <Field
              name="pe-line-height"
              label="Line height"
              numeric
              value={lineHeight}
              placeholder="Auto"
              onCommit={set("line-height", (raw) =>
                /^auto$/i.test(raw.trim()) ? "normal" : length(raw),
              )}
              prefix={<IconAffix icon={LineHeightIcon} />}
            />
          </Caption>
          <Caption label="Letter spacing">
            <Field
              name="pe-letter-spacing"
              label="Letter spacing"
              numeric
              step={0.1}
              value={letterSpacing}
              onCommit={set("letter-spacing")}
              prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
              suffix="px"
            />
          </Caption>
        </div>
      </Section>
      <Section title="Text Fill">
        <Field
          name="pe-color"
          label="Text color"
          value={fill.hex}
          onCommit={set("color", (raw) => {
            const v = raw.trim().replace(/^#/, "");
            return /^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v) ? "#" + v : raw.trim();
          })}
          prefix={<Swatch color={st.color || ""} />}
          suffix={`${fill.alpha} %`}
        />
      </Section>
    </div>
  );
}
