import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";

export const Route = createFileRoute("/_editor/code")({ component: CodeArea });

function CodeArea() {
  useShellArea("/code");
  return null;
}
