import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";
import { useLegacyUi } from "../../legacy/ui";

// The Files home, rendered by this route (web/src/islands/home/route-area.tsx): being rendered means shown.
export const Route = createFileRoute("/_editor/")({ component: FilesHomeArea });

function FilesHomeArea() {
  useShellArea("/");
  const ui = useLegacyUi();
  return ui ? <ui.HomeArea /> : null;
}
