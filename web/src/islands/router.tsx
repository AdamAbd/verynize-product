import { RouterProvider } from "@tanstack/react-router";
import { ensureContainer, mountIsland } from "@/lib/mount";
import { shellRouter } from "@/lib/router/shell-router";

// This island owns no shell or canvas DOM. Routes only select legacy views.
mountIsland(
  "router",
  () => ensureContainer("bd-router-root"),
  () => <RouterProvider router={shellRouter} />,
);
