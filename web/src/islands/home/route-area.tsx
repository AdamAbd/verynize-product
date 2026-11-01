// The Files home as Start's routes render it on the web: the Files route (web-start/src/routes/_editor/index.tsx), and
// the settings route while settings is open over Files. Being rendered means the home view is shown. Desktop keeps the
// island-rendered screen, shown and hidden by the shell router through fileLibrary.applyHome/applyEditor.
import { StrictMode, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IslandProviders } from "@/lib/mount";
import { HomeScreen } from "./home-screen";

type RoutedLibrary = { syncHome?(open: boolean): void };
const routedLibrary = () => window.fileLibrary as unknown as RoutedLibrary | undefined;

/** Renders into `#bd-home-root` inside the legacy `#file-home` section (same element, ids and CSS as desktop). */
export function HomeArea() {
  const [host] = useState(() => ({
    home: document.getElementById("file-home"),
    root: document.getElementById("bd-home-root"),
  }));
  // Shown while mounted. Layout effects, so the view switches in the same frame as the route.
  useLayoutEffect(() => {
    const { home } = host;
    if (!home) return;
    home.hidden = false;
    home.dataset.routeOwner = "start";
    document.body.classList.add("files-view");
    routedLibrary()?.syncHome?.(true);
    return () => {
      home.hidden = true;
      delete home.dataset.routeOwner;
      document.body.classList.remove("files-view");
      routedLibrary()?.syncHome?.(false);
    };
  }, [host]);
  if (!host.root) return null;
  return createPortal(
    <StrictMode>
      <IslandProviders>
        <HomeScreen routed />
      </IslandProviders>
    </StrictMode>,
    host.root,
  );
}
