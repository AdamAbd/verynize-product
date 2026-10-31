import { createFileRoute } from "@tanstack/react-router";
import { useShellArea } from "../../legacy/shell-host";

export const Route = createFileRoute("/_editor/")({ component: FilesHomeArea });

function FilesHomeArea() {
  useShellArea("/");
  return null;
}
