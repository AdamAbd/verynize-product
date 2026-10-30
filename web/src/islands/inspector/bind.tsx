// "Apply variable" for numeric/typography properties (design/wonder 26–27): a diamond button inside a field
// opens the compatible Dimension/Number variables; a bound field shows the variable as a chip until detached.
import type { ReactNode } from "react";
import { Diamond, Folder, Unlink } from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fieldPrefixInset, fieldShell } from "./controls";
import type { Node } from "./model";
import {
  BINDABLE,
  bindVariable,
  bindingsOf,
  createVariable,
  groupByFolder,
  leafOf,
  valueLabel,
  variablesOf,
  VARIABLE_TYPES,
} from "./vars";

type BindProps = {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  field: string;
  label: string;
};

/** Menu items: compatible variables, create, detach. */
function BindItems({ doc, node, selection, field }: BindProps) {
  const vars = Object.entries(variablesOf(doc)).filter(([, v]) =>
    BINDABLE[field]?.includes(v.type),
  );
  const bound = bindingsOf(node)[field];
  const types = BINDABLE[field] ?? [];
  return (
    <>
      <div className="flex h-7 items-center gap-2 px-2 text-xs text-foreground-3">
        <Diamond className="size-3.5" aria-hidden />
        Apply variable
      </div>
      <DropdownMenuSeparator />
      {groupByFolder(vars).map(({ folder, items }) => (
        <DropdownMenuGroup
          key={folder || "/"}
          data-variable-folder={folder}
          aria-label={folder || undefined}
        >
          {folder ? (
            <DropdownMenuLabel>
              <span className="flex min-w-0 items-center gap-1">
                <Folder className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{folder}</span>
              </span>
            </DropdownMenuLabel>
          ) : null}
          {items.map(([name, v]) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => bindVariable(doc, selection, field, name)}
              data-variable={name}
              aria-label={name}
            >
              <span className={cn("min-w-0 flex-1 truncate", folder && "ml-4")}>
                {folder ? leafOf(name) : name}
              </span>
              <span className={cn("text-muted-foreground", bound === name && "text-foreground")}>
                {valueLabel(v)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ))}
      {!vars.length ? <DropdownMenuItem disabled>No matching variables</DropdownMenuItem> : null}
      <DropdownMenuSeparator />
      {types.map((type) => (
        <DropdownMenuItem
          key={type}
          onSelect={async () => {
            const name = await createVariable(type);
            if (name) bindVariable(window.design.getDocument(), selection, field, name);
          }}
        >
          New{" "}
          {VARIABLE_TYPES.find((t) => t.type === type)
            ?.label.toLowerCase()
            .replace(/s$/, "")}{" "}
          variable…
        </DropdownMenuItem>
      ))}
      {bound ? (
        <DropdownMenuItem onSelect={() => bindVariable(doc, selection, field, null)}>
          <Unlink />
          Detach variable
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/** Small trigger rendered as a field suffix; visible on hover/focus, always when bound. */
export function BindButton(props: BindProps) {
  const bound = bindingsOf(props.node)[props.field];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Apply variable to ${props.label.toLowerCase()}`}
          title="Apply variable"
          data-bind={props.field}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/field:opacity-100 group-focus-within/field:opacity-100 data-[state=open]:opacity-100",
            bound && "text-primary-text opacity-100",
          )}
        >
          <Diamond className="size-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start" sideOffset={12} className="w-52">
        <BindItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The bound-variable pill Wonder draws inside a field (design/wonder/2026-10-30/05, 06, 07, 13, 35): 16px tall,
 * 4px radius, panel-coloured fill with a 0.5px edge, 12px label. Shows the leaf of a folder name
 * (`surface/base` → `base`); the full name stays in the tooltip. A name whose variable is gone renders red.
 */
export function VariableChip({
  name,
  missing,
  className,
}: {
  name: string;
  missing?: boolean;
  className?: string;
}) {
  return (
    <span
      data-variable-chip={name}
      data-missing={missing || undefined}
      className={cn(
        "flex h-4 min-w-0 max-w-full shrink items-center rounded-sm bg-variable-chip px-1 text-xs text-variable-chip-foreground shadow-variable-chip",
        missing && "text-destructive",
        className,
      )}
    >
      <span className="min-w-0 truncate">{leafOf(name)}</span>
    </span>
  );
}

/**
 * A field bound to a variable keeps its prefix icon and shows the variable as a chip instead of the value; no unit
 * suffix (Wonder 05/06/07); the chip starts 3px after where the value text would (27.5px in with a prefix,
 * 11.5px without). The whole field opens the bind menu (other variables, create, detach).
 */
export function BoundChip({
  prefix,
  className,
  ...props
}: BindProps & { prefix?: ReactNode; className?: string }) {
  const name = bindingsOf(props.node)[props.field];
  const variable = variablesOf(props.doc)[name];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${props.label}: variable ${name}`}
          title={variable ? `${name} = ${valueLabel(variable)}` : `${name} (missing variable)`}
          data-bound={props.field}
          className={cn(
            fieldShell,
            prefix && fieldPrefixInset,
            "w-full text-left focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          {prefix ? <span className="flex shrink-0 items-center">{prefix}</span> : null}
          <VariableChip name={name} missing={!variable} className="ml-0.75" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start" sideOffset={12} className="w-52">
        <BindItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const isBound = (node: Node, field: string) => !!bindingsOf(node)[field];

/** A numeric Field whose property can be bound to a variable (radius, gap, padding, opacity, type sizes…). */
export function BindableField({
  doc,
  node,
  selection,
  field,
  label,
  prefix,
  suffix,
  className,
  children,
}: BindProps & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  children: (suffix: ReactNode) => ReactNode;
}) {
  if (isBound(node, field))
    return (
      <BoundChip
        doc={doc}
        node={node}
        selection={selection}
        field={field}
        label={label}
        prefix={prefix}
        className={className}
      />
    );
  return (
    <>
      {children(
        <span className="flex items-center gap-1">
          {suffix}
          <BindButton doc={doc} node={node} selection={selection} field={field} label={label} />
        </span>,
      )}
    </>
  );
}
