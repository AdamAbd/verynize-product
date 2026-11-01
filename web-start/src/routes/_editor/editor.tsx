import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";

export const Route = createFileRoute("/_editor/editor")({ component: EditorArea });

function EditorArea() {
  useShellArea("/editor");
  return null;
}
