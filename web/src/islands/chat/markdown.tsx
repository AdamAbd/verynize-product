// Minimal, safe Markdown → React renderer for agent replies (no HTML injection): paragraphs, headings,
// lists (one nesting level per indent), blockquotes, fenced code, rules, inline code/bold/italic/links.
import { Fragment, memo, type ReactNode } from "react";
import { workspace } from "./store";

/** Classifies a link target: only http(s) and verynize:// are ever clickable (no javascript:, data:, file: …). */
export function linkKind(href: string): "web" | "app" | null {
  const value = href.trim();
  if (/^https?:\/\//i.test(value)) return "web";
  if (/^verynize:\/\//i.test(value)) return "app";
  return null;
}

/** Opens a verynize:// link on the canvas; false when the workspace cannot handle it. */
export function openAppLink(href: string): boolean {
  const open = workspace()?.openLink;
  if (!open || linkKind(href) !== "app") return false;
  try {
    return open(href) !== false;
  } catch {
    return false;
  }
}

const LINK = "text-primary-text underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-hidden";

function Link({ href, children }: { href: string; children: ReactNode }) {
  const kind = linkKind(href);
  if (kind === "web")
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>
        {children}
      </a>
    );
  if (kind === "app" && workspace()?.openLink)
    return (
      <a
        href={href}
        className={LINK}
        onClick={(event) => {
          event.preventDefault();
          openAppLink(href);
        }}
      >
        {children}
      </a>
    );
  return <span>{children}</span>;
}

type Block =
  | { type: "p"; lines: string[] }
  | { type: "h"; level: number; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] };
type ListItem = { lines: string[]; children: ListItem[]; ordered: boolean };

const LIST = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "h", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", lines: body });
      continue;
    }
    const first = line.match(LIST);
    if (first) {
      const baseIndent = first[1].length;
      const ordered = /\d/.test(first[2]);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const match = current.match(LIST);
        if (match) {
          const item: ListItem = { lines: [match[3]], children: [], ordered: /\d/.test(match[2]) };
          if (match[1].length > baseIndent && items.length) items.at(-1)!.children.push(item);
          else items.push(item);
        } else if (current.trim() && /^\s+/.test(current) && items.length) {
          const last = items.at(-1)!;
          (last.children.at(-1) ?? last).lines.push(current.trim());
        } else if (!current.trim() && LIST.test(lines[i + 1] ?? "")) {
          // blank line between items keeps the list going
        } else break;
        i++;
      }
      blocks.push({ type: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) || 1 : 1, items });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !LIST.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(```|~~~)/.test(lines[i])
    )
      body.push(lines[i++]);
    blocks.push({ type: "p", lines: body });
  }
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(\[[^\]\n]+\]\([^)\s]+\))|((?:https?|verynize):\/\/[^\s<>()`]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    if (match[1])
      out.push(
        <code key={key++} className="rounded-sm border border-card-border bg-card px-1 font-mono text-sm">
          {token.slice(1, -1)}
        </code>,
      );
    else if (match[2])
      out.push(
        <strong key={key++} className="font-semibold text-foreground">
          {inline(token.slice(2, -2))}
        </strong>,
      );
    else if (match[3]) out.push(<em key={key++}>{inline(token.slice(1, -1))}</em>);
    else if (match[5]) {
      // Bare URL: trailing sentence punctuation is not part of it.
      const url = token.replace(/[.,;:!?'"]+$/, "");
      out.push(<Link key={key++} href={url}>{url}</Link>);
      last = index + url.length;
      continue;
    } else {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      out.push(<Link key={key++} href={href ?? ""}>{inline(label ?? "")}</Link>);
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(list: string[]): ReactNode {
  return list.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

function List({ items, ordered, start }: { items: ListItem[]; ordered: boolean; start?: number }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      start={ordered ? start : undefined}
      className={ordered ? "list-decimal space-y-0.5 pl-5 marker:text-subtle-foreground" : "list-disc space-y-0.5 pl-5 marker:text-subtle-foreground"}
    >
      {items.map((item, index) => (
        <li key={index}>
          {lines(item.lines)}
          {item.children.length > 0 && <List items={item.children} ordered={item.children[0].ordered} />}
        </li>
      ))}
    </Tag>
  );
}

/** Rendered Markdown with chat typography (14/21, 10px block rhythm). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="space-y-2.5 break-words">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h":
            return (
              <p key={index} className="font-semibold text-foreground">
                {inline(block.text)}
              </p>
            );
          case "quote":
            return (
              <blockquote key={index} className="border-l-2 border-border pl-3.5 text-foreground-3">
                {lines(block.lines)}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-lg border border-card-border bg-card px-3 py-2 font-mono text-xs whitespace-pre text-foreground-2"
              >
                {block.text}
              </pre>
            );
          case "hr":
            return <hr key={index} className="border-t border-border" />;
          case "list":
            return <List key={index} items={block.items} ordered={block.ordered} start={block.start} />;
          default:
            return <p key={index}>{lines(block.lines)}</p>;
        }
      })}
    </div>
  );
});
