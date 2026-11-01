// Island entry: settings. Owned by the "settings" workstream (see web/src/islands/README.md).
// Renders the settings screen (web/settings.js keeps preferences + actions) and restyles the remaining dialogs.
import { mountIsland, ensureContainer } from "@/lib/mount";
import { hosted } from "@/lib/router/host";
import { Toaster } from "@/components/ui/sonner";
import { attachSettings } from "./settings/api";
import { startPreferenceRuntime } from "./settings/preference-runtime";
import { SettingsScreen } from "./settings/SettingsScreen";
import { GlobalSearchDialog } from "./settings/projects";
import { DialogEnhancer, ExportToasts } from "./settings/dialogs";
import "./settings/settings.css";

function Island() {
  return (
    <>
      {/* On the web, Start's settings route renders the screen (settings/route-area.tsx). */}
      {!hosted && <SettingsScreen />}
      <GlobalSearchDialog />
      <DialogEnhancer />
      <ExportToasts />
      <Toaster position="bottom-right" offset={16} visibleToasts={3} />
    </>
  );
}

mountIsland(
  "settings",
  () => {
    attachSettings();
    startPreferenceRuntime();
    return ensureContainer("bd-settings-root");
  },
  () => <Island />,
);
