import { useLayoutEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { ensureContainer, mountIsland } from "@/lib/mount";
import { applyCurrentLocation, hosted, shellRouter } from "@/lib/router/shell-router";

// This island owns no shell or canvas DOM. Routes only select legacy views.
// Standalone (desktop) it renders the shell router. Hosted by the Start app, Start's router is already rendered and
// its routes apply later locations; this island only applies the entry Start rendered before ui.js loaded.
function HostedShell() {
  useLayoutEffect(() => {
    applyCurrentLocation();
  }, []);
  return null;
}

mountIsland(
  "router",
  () => ensureContainer("bd-router-root"),
  () => (hosted ? <HostedShell /> : <RouterProvider router={shellRouter} />),
);
