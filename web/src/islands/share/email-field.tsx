// Email chip field (Wonder SH2/SI1): "Add emails..." turns typed addresses into removable chips on comma, Enter or
// blur; invalid chips are highlighted. Enter on an empty input submits. One line until the first chip, then the
// chips sit above the caret line (SI1-typed).
import {
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>().]+(\.[^\s@,;<>().]+)+$/;
export type Chip = { email: string; invalid: boolean };
export type EmailFieldHandle = { focus(): void; commit(): Chip[] };

const split = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

export function EmailField({
  chips,
  onChipsChange,
  onSubmit,
  onEdit,
  disabled,
  invalid,
  ref,
}: {
  chips: Chip[];
  onChipsChange: (chips: Chip[]) => void;
  onSubmit: () => void;
  /** Typing or removing a chip: clears a stale validation message. */
  onEdit: () => void;
  disabled: boolean;
  invalid: boolean;
  ref?: Ref<EmailFieldHandle>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  const add = (parts: string[]) => {
    if (!parts.length) return chips;
    const known = new Set(chips.map((chip) => chip.email.toLowerCase()));
    const next = [...chips];
    for (const email of parts) {
      if (known.has(email.toLowerCase())) continue;
      known.add(email.toLowerCase());
      next.push({ email, invalid: !EMAIL.test(email) });
    }
    onChipsChange(next);
    return next;
  };
  /** Turn the typed text into chips; returns the resulting list. */
  const commit = () => {
    const parts = split(text);
    setText("");
    return add(parts);
  };
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), commit }));

  const remove = (email: string) => {
    onChipsChange(chips.filter((chip) => chip.email !== email));
    onEdit();
    input.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (text.trim()) commit();
      else onSubmit();
    } else if (event.key === "Backspace" && !text && chips.length) {
      event.preventDefault();
      remove(chips[chips.length - 1].email);
    }
  };
  const onChange = (value: string) => {
    onEdit();
    if (/[,;]/.test(value)) {
      // Everything before the last separator becomes chips; the rest stays typed.
      const parts = value.split(/[,;]/);
      const rest = parts.pop() ?? "";
      add(split(parts.join(",")));
      setText(rest.trimStart());
    } else setText(value);
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/[\s,;]/.test(pasted.trim())) return;
    event.preventDefault();
    onEdit();
    add(split(text + pasted));
    setText("");
  };

  return (
    <div
      data-share-emails=""
      data-invalid={invalid || undefined}
      className={cn(
        "flex min-w-0 flex-1 cursor-text flex-col rounded-md border border-input bg-background",
        "focus-within:border-transparent focus-within:ring-2 focus-within:ring-share-focus",
        invalid && "border-transparent ring-2 ring-share-error focus-within:ring-share-error",
        disabled && "cursor-default opacity-60",
      )}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          input.current?.focus();
        }
      }}
    >
      {chips.length > 0 && (
        <ul aria-label="Invited emails" className="m-0 flex list-none flex-wrap gap-1 px-2.5 pt-1">
          {chips.map((chip) => (
            <li
              key={chip.email}
              data-email-chip={chip.email}
              data-invalid={chip.invalid || undefined}
              className={cn(
                "flex h-5 max-w-48 items-center gap-1 rounded-sm pr-0.5 pl-1.5 text-sm leading-4",
                chip.invalid ? "bg-share-error-chip text-share-error" : "bg-accent text-foreground",
              )}
            >
              <span className="truncate">{chip.email}</span>
              <button
                type="button"
                aria-label={`Remove ${chip.email}`}
                disabled={disabled}
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  chip.invalid ? "text-share-error" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => remove(chip.email)}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="text"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        aria-label="Emails to invite"
        aria-invalid={invalid || undefined}
        placeholder={chips.length ? undefined : "Add emails..."}
        value={text}
        disabled={disabled}
        className="h-6.5 w-full min-w-0 bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-default"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          if (text.trim()) commit();
        }}
      />
    </div>
  );
}
