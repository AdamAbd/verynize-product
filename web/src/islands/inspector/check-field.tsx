// Labelled checkbox for the effect editors ("Inner shadow", mask "Invert"). A Radix checkbox, not a native
// <input type=checkbox>: the global `[data-bd] input` reset (globals.css) strips native checkboxes to nothing.
// Tests find it by role and label (`getByRole("checkbox", { name })`) or by `[data-check-field=<name>]`.
// Same look as Clip content: a 16px #2b2b2b box, accent fill with a bold check when on (wonder A4-shadow-editor).
import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

export function CheckField({
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
    <label className="m-0 flex h-7 w-fit items-center gap-2 text-xs text-foreground">
      <CheckboxPrimitive.Root
        checked={checked}
        aria-label={label}
        data-check-field={name}
        onCheckedChange={(value) => onChange(value === true)}
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
