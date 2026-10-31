// Context menus of the sidebar rows: layer rows show the canvas layer menu without Select layer (Wonder CM7-row),
// page rows show Rename F2 | Delete (Wonder CM8-page).
import { Delete } from "lucide-react";
import { useDesign, useSelection } from "@/lib/bridge";
import { MenuEntries } from "./entries";
import { layerMenu } from "./model";
import { Menu, MenuContent, MenuItem, MenuSeparator } from "./parts";

export const RowMenuRoot = Menu.Root;
export const RowMenuTrigger = Menu.Trigger;

export function LayerRowMenu() {
  return (
    <MenuContent data-target="row">
      <LayerRowEntries />
    </MenuContent>
  );
}

function LayerRowEntries() {
  useDesign();
  useSelection();
  return <MenuEntries entries={layerMenu("row")} />;
}

export function PageRowMenu({
  canDelete,
  onRename,
  onDelete,
}: {
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <MenuContent data-target="page">
      <MenuItem data-command="page.rename" label="Rename" shortcut="F2" onSelect={onRename} />
      <MenuSeparator />
      <MenuItem
        data-command="page.delete"
        label="Delete"
        destructive
        disabled={!canDelete}
        shortcut={<Delete className="size-3.5" />}
        onSelect={onDelete}
      />
    </MenuContent>
  );
}
