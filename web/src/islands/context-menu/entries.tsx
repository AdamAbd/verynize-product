// Renders a context menu model (model.ts) with the Wonder-styled Radix parts. Every row carries `data-command`.
import type { Entry } from "./model";
import { MenuItem, MenuSeparator, MenuSub } from "./parts";

export function MenuEntries({ entries }: { entries: Entry[] }) {
  return (
    <>
      {entries.map((entry, index) => {
        if (entry.type === "separator") return <MenuSeparator key={"sep-" + index} />;
        if (entry.type === "sub") {
          return (
            <MenuSub
              key={entry.command}
              label={entry.label}
              command={entry.command}
              disabled={entry.disabled}
            >
              <MenuEntries entries={entry.entries} />
            </MenuSub>
          );
        }
        return (
          <MenuItem
            key={entry.command}
            data-command={entry.command}
            label={entry.label}
            shortcut={entry.shortcut}
            disabled={entry.disabled}
            onSelect={entry.run}
          />
        );
      })}
    </>
  );
}
