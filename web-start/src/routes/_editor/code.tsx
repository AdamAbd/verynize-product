import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";
import { useLegacyUi } from "../../legacy/ui";

// The Code workspace, rendered by this route (web/src/islands/code/route-area.tsx): being rendered means Code mode.
export const Route = createFileRoute("/_editor/code")({ component: CodeArea });

function CodeArea() {
  useShellArea("/code");
  const ui = useLegacyUi();
  return ui ? <ui.CodeArea /> : null;
}
