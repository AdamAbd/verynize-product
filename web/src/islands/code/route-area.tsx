// The Code workspace as Start's routes render it on the web: the Code route (web-start/src/routes/_editor/code.tsx),
// and the settings route while settings is open over Code. Being rendered means Code mode is on. The code island
// keeps what lives for the whole page (the controller, window.codeWorkspace, the design-mode chat sidebar). Desktop
// keeps the island-rendered workspace, switched by the shell router through agentWorkspace.applyCodeMode.
import { StrictMode, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { IslandProviders } from "@/lib/mount";
import { useChatState } from "../chat/store";
import { CodeWorkspace } from "./workspace";

type RoutedWorkspace = { syncCodeMode?(on: boolean): void };
const routedWorkspace = () => window.agentWorkspace as unknown as RoutedWorkspace | undefined;

function host() {
  let root = document.getElementById("bd-code-route-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "bd-code-route-root";
    root.setAttribute("data-bd", "");
    document.body.append(root);
  }
  return root;
}

/** Renders `#code-workspace` into a body-level root, as the code island does on desktop (same ids and CSS). */
export function CodeArea() {
  const state = useChatState();
  // Code mode while mounted. The workspace's chat host has attached by now (child refs run first), so syncCodeMode
  // moves the chat section into it.
  useLayoutEffect(() => {
    document.body.classList.add("code-mode");
    routedWorkspace()?.syncCodeMode?.(true);
    return () => {
      document.body.classList.remove("code-mode");
      routedWorkspace()?.syncCodeMode?.(false);
    };
  }, []);
  if (!state) return null;
  return createPortal(
    <StrictMode>
      <IslandProviders>
        <CodeWorkspace state={state} routed />
      </IslandProviders>
    </StrictMode>,
    host(),
  );
}
