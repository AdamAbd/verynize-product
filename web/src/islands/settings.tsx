// Island entry: settings. Owned by the "settings" workstream (see web/src/islands/README.md).
// Renders the settings screen (web/settings.js keeps preferences + actions) and restyles the remaining dialogs.
import { mountIsland, ensureContainer } from "@/lib/mount";
import { Toaster } from "@/components/ui/sonner";
import { attachSettings } from "./settings/api";
import { startPreferenceRuntime } from "./settings/preference-runtime";
import { SettingsScreen } from "./settings/SettingsScreen";
import { DialogEnhancer, ExportToasts } from "./settings/dialogs";
import "./settings/settings.css";

function Island() {
  return (
    <>
      <SettingsScreen />
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
