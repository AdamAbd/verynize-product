import { Outlet, createFileRoute, useLocation, useParams } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";
import { useLegacyUi } from "../../legacy/ui";

// The settings overlay, rendered by this route (web/src/islands/settings/route-area.tsx): being rendered means open,
// and the section is the URL's (`/settings` and unknown sections show the default one; the shell router replaces
// the URL with the canonical /settings/<section> and records the view underneath in history state). One layout for
// both child paths, so switching sections never remounts the screen.
//
// The view underneath comes from that history state (`settingsUnder`). Of the views, only the Files home is rendered
// by a route, so this route renders it too while settings is open over it; the editor and the Code workspace are
// still shown by the shell router's legacy appliers.
export const Route = createFileRoute("/_editor/settings")({ component: SettingsArea });

function SettingsArea() {
  useShellArea("/settings");
  const { section } = useParams({ strict: false });
  const under = useLocation({
    select: (location) => (location.state as { settingsUnder?: string }).settingsUnder,
  });
  const ui = useLegacyUi();
  return (
    <>
      {ui && under === "/" && <ui.HomeArea />}
      {ui && <ui.SettingsArea section={section} />}
      <Outlet />
    </>
  );
}
