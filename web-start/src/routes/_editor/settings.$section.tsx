import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";

// The section comes from the location, not the params (applySettingsLocation in
// web/src/lib/router/shell-router.ts); unknown sections are replaced with the default one.
export const Route = createFileRoute("/_editor/settings/$section")({ component: SettingsArea });

function SettingsArea() {
  useShellArea("/settings");
  return null;
}
