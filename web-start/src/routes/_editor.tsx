import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { bootLegacyEditor } from "../legacy/boot";

// Every editor path shares this pathless layout, so moving between them never remounts the
// editor. `ssr: false` (inherited by the children) keeps the editor out of server rendering: the
// server sends the document shell only and the editor boots after hydration. The child routes
// render nothing; the legacy shell router (web/src/lib/router/shell-router.ts) switches views.
export const Route = createFileRoute("/_editor")({
  ssr: false,
  component: EditorHost,
});

function EditorHost() {
  useEffect(() => {
    void bootLegacyEditor();
  }, []);
  return null;
}
