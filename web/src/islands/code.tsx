// Island entry: code. The Code workspace (Wonder code mode): repositories with per-chat worktrees, the chat column,
// the file tree / editor and the terminal panel. Full window while `body.code-mode` is set (Design/Code switch in the
// title bar); the canvas stays mounted underneath. Chat state stays in web/desktop-panel.js (window.agentWorkspace).
import { useEffect } from "react";
import { mountIsland } from "@/lib/mount";
import { useChatState } from "./chat/store";
import { addRepository, newChat, newQuickChat, openChat, refresh, start } from "./code/controller";
import { openMemory } from "./code/editor-state";
import { CodeWorkspace } from "./code/workspace";
import "./code/code.css";

window.codeWorkspace = { addRepository, newChat: () => newChat(), newQuickChat, openChat, openMemory: () => void openMemory(), refresh };

function Island() {
  const state = useChatState();
  useEffect(() => {
    void start();
  }, []);
  if (!state) return null;
  return <CodeWorkspace state={state} />;
}

mountIsland(
  "code",
  () => {
    const root = document.createElement("div");
    root.id = "bd-code-root";
    document.body.append(root);
    return root;
  },
  () => <Island />,
);
