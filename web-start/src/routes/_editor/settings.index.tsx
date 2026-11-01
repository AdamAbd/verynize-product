import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";

// /settings opens the default section; the shell router replaces it with /settings/<section>.
export const Route = createFileRoute("/_editor/settings/")({ component: SettingsArea });

function SettingsArea() {
  useShellArea("/settings");
  return null;
}
