import { useEffect } from "react";
import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router";
import { bootLegacyEditor } from "../legacy/boot";
import { installShellHost } from "../legacy/shell-host";

// Every editor path shares this pathless layout, so moving between them never remounts the
// editor. `ssr: false` (inherited by the children) keeps the editor out of server rendering: the
// server sends the document shell only and the editor boots after hydration. This router is the
// page's only router: the host is registered before the boot, and the child routes name the area
// the legacy views show (legacy/shell-host.ts).
export const Route = createFileRoute("/_editor")({
  ssr: false,
  component: EditorHost,
});

function EditorHost() {
  const router = useRouter();
  useEffect(() => {
    installShellHost(router);
    void bootLegacyEditor();
  }, [router]);
  return <Outlet />;
}
