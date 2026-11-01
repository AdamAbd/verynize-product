// The registered router for the renderer's own program (tsconfig.json): the standalone shell router. Not imported by
// any module, so the web app's program (web-start/tsconfig.json), which registers Start's router (same public
// paths), does not see it.
import type { ShellRouter } from "./shell-router";

declare module "@tanstack/react-router" {
  interface Register {
    router: ShellRouter;
  }
}
