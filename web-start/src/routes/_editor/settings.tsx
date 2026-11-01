import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";
import { useLegacyUi } from "../../legacy/ui";

// The settings overlay, rendered by this route (web/src/islands/settings/route-area.tsx): being rendered means open,
// and the section is the URL's (`/settings` and unknown sections show the default one; the shell router replaces
// the URL with the canonical /settings/<section> and records the view underneath in history state). One layout for
// both child paths, so switching sections never remounts the screen.
export const Route = createFileRoute("/_editor/settings")({ component: SettingsArea });

function SettingsArea() {
  useShellArea("/settings");
  const { section } = useParams({ strict: false });
  const ui = useLegacyUi();
  return (
    <>
      {ui && <ui.SettingsArea section={section} />}
      <Outlet />
    </>
  );
}
