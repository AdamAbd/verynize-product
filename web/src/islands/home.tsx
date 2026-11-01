// Island entry: home. Owned by the "home" workstream (see web/src/islands/README.md).
// Renders the Files home screen inside the legacy `#file-home` section created by web/wonder-shell.js,
// which still owns the file library data (window.fileLibrary).
// On the web, Start's Files route renders the screen (home/route-area.tsx); this entry only prepares the host.
import { useEffect } from "react";
import { mountIsland } from "@/lib/mount";
import { takeOver } from "@/lib/bridge";
import { hosted } from "@/lib/router/host";
import { HomeScreen } from "./home/home-screen";
import { library } from "./home/library";
import "./home/home.css";

// Ids the island renders itself; legacy elements keep their handlers under `legacy-<id>`.
const TAKEN = [
  "workspace-profile",
  "library-new-folder",
  "library-new-file",
  "library-grid",
  "library-list",
  "library-search",
  "library-files",
  "folder-breadcrumb",
];

function container() {
  const home = document.getElementById("file-home") as HTMLElement;
  // The breadcrumb only renders inside a folder, so it must not hold back the UI-ready signal. Hosted, the whole
  // screen only renders on the Files route, so none of the ids may.
  for (const id of TAKEN)
    takeOver(id, {
      park: id !== "library-files" && id !== "folder-breadcrumb",
      deferred: hosted || id === "folder-breadcrumb",
    });
  // Legacy filter buttons stay in the hidden filter bar; free `[data-filter]` for the island's buttons.
  home.querySelectorAll<HTMLElement>(".home-filterbar [data-filter]").forEach((button) => {
    button.dataset.legacyFilter = button.dataset.filter;
    delete button.dataset.filter;
  });
  const root = document.createElement("div");
  root.id = "bd-home-root";
  home.insertBefore(root, document.getElementById("library-status"));
  return root;
}

function Island() {
  useEffect(() => library().attachView(), []);
  return <HomeScreen />;
}

if (document.getElementById("file-home") && window.fileLibrary) {
  if (hosted) {
    // The screen is Start's (it mounts and unmounts with the Files route); the legacy library stops rendering its
    // own file list for the whole page.
    const root = container();
    root.setAttribute("data-bd", "");
    root.dataset.island = "home";
    library().attachView();
  } else mountIsland("home", container, () => <Island />);
}
