// The settings area as Start's settings route renders it on the web (web-start/src/routes/_editor/settings.tsx).
// The route owns the overlay there: it being rendered means open, its URL names the section. Desktop keeps the
// island-rendered screen (SettingsScreen) opened and closed by the shell router through settings.js.
import { StrictMode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IslandProviders } from "@/lib/mount";
import { settingsSection } from "@/lib/router/settings-sections";
import { settingsApi } from "./api";
import { SettingsScreenContent } from "./SettingsScreen";

type RoutedSettingsApi = { syncSection?(section: string): void };

/** Renders into the legacy `#settings-screen` host (same element, ids and CSS as desktop). */
export function SettingsArea({ section }: { section?: string }) {
  const id = settingsSection(section);
  const [host] = useState(() => document.getElementById("settings-screen"));
  // Open while mounted. Layout effects, so the overlay shows in the same frame as the route.
  useLayoutEffect(() => {
    if (!host) return;
    host.setAttribute("data-bd", "");
    host.dataset.routeOwner = "start";
    host.hidden = false;
    document.body.classList.add("settings-open");
    return () => {
      host.hidden = true;
      delete host.dataset.routeOwner;
      document.body.classList.remove("settings-open");
      (settingsApi() as RoutedSettingsApi | undefined)?.syncSection?.(id);
    };
  }, [host]); // oxlint-disable-line react-hooks/exhaustive-deps
  // settings.js still answers getState() for legacy code (Escape, select, shell requests).
  useLayoutEffect(() => {
    (settingsApi() as RoutedSettingsApi | undefined)?.syncSection?.(id);
  }, [id]);
  if (!host) return null;
  return createPortal(
    <StrictMode>
      <IslandProviders>
        <SettingsScreenContent section={id} />
      </IslandProviders>
    </StrictMode>,
    host,
  );
}
