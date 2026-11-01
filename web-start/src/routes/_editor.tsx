import { Suspense, lazy, useEffect, useState } from "react";
import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router";
import { bootLegacyEditor } from "../legacy/boot";
import { installShellHost } from "../legacy/shell-host";
import type { WebAccess } from "../legacy/web-auth";

// Every editor path shares this pathless layout, so moving between them never remounts the
// editor. `ssr: false` (inherited by the children) keeps the editor out of server rendering: the
// server sends the document shell only and the editor boots after hydration. This router is the
// page's only router: the host is registered before the boot, and the child routes name the area
// the legacy views show (legacy/shell-host.ts).
//
// The web app needs an account: without a session for this server the layout renders the sign-in
// screen instead of booting the editor (legacy/web-auth.ts), at the same address, and boots it
// once signed in.
export const Route = createFileRoute("/_editor")({
  ssr: false,
  component: EditorHost,
});

const auth = () => import("../legacy/web-auth");
const WebSignIn = lazy(() => import("@/islands/onboarding/web-sign-in"));

function EditorHost() {
  const router = useRouter();
  const [access, setAccess] = useState<WebAccess>("checking");
  useEffect(() => {
    let live = true;
    void auth()
      .then(({ webAccess }) => webAccess())
      .then((value) => live && setAccess(value));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.webAuth = access;
    if (access !== "signed-in" && access !== "public") return;
    installShellHost(router);
    void bootLegacyEditor();
    let stop: (() => void) | undefined;
    let live = true;
    void auth().then(({ watchSignOut }) => {
      if (live) stop = watchSignOut();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [access, router]);
  if (access === "checking") return null;
  if (access === "signed-out")
    return (
      <Suspense fallback={null}>
        <WebSignIn onSignedIn={() => setAccess("signed-in")} />
      </Suspense>
    );
  return <Outlet />;
}
