// Typed access to the desktop IPC for named accounts, Verynize tool config, chat autonomy, global search and
// workspace moves (desktop/agent-profiles.cjs, agent-tool-config.cjs, agent-autonomy.cjs, project-search.cjs,
// repository-moves.cjs). The calls are typed by DesktopApi (@/lib/desktop-api); the plain web build has no desktop bridge.
import { platform } from "@/lib/platform";

export type Agent = "claude" | "codex";
export type Profile = {
  id: string;
  agent: Agent;
  name: string;
  createdAt: number;
  system: boolean;
};
export type ProfileList = { profiles: Profile[]; defaults: Record<Agent, string> };
export type ProfileStatus = {
  agent: Agent;
  installed: boolean;
  loggedIn: boolean;
  method: string;
  profile?: string;
  configDir?: string;
  email?: string;
  plan?: string;
};
export type ToolServer = {
  id: string;
  name: string;
  scope: "global" | "project";
  project: string | null;
  agents: Agent[];
  enabled: boolean;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  envKeys?: string[];
  url?: string;
  tokenEnv?: string;
};
export type PermissionRule = {
  tool: string;
  decision: "allow" | "ask" | "deny";
  scope: "global" | "project";
  project: string | null;
};
export type Autonomy = {
  allowedTools: string[];
  deniedTools: string[];
  autoApprove: { tool: string; match: string }[];
  maxTurns: number | null;
  maxBudgetUsd: number | null;
  planFirst: boolean;
};
export type SearchHit = {
  projectId: string | null;
  project: string;
  root: string;
  path: string;
  line: number;
  column: number;
  preview: string;
};
export type DesignHit = {
  projectId: string | null;
  project: string;
  root: string;
  path: string;
  pageId: string;
  page: string;
  nodeId: string | null;
  name: string;
  match: string;
  kind: string;
};
export type SearchResult = {
  engine: "ripgrep" | "node";
  ripgrep?: "bundled" | "system" | null;
  results: SearchHit[];
  design: DesignHit[];
  truncated: boolean;
  errors: { project: string; error: string }[];
};
export type Repository = { id: string; name: string; root: string; git?: boolean };
export type MoveResult = {
  moved: { id: string; from: string; to: string }[];
  root?: string;
  name?: string;
};

export const desktopApi = () => platform.desktop;
export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
export const AGENT_NAMES: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

/**
 * After a repository (or a registered project nested in it) moved, re-key the chats the renderer stored under
 * the old root (`better-agent-chats:<root>`, drafts, the last opened chat) so they stay with the project.
 */
export function migrateChatStorage(moved: { from: string; to: string }[]) {
  for (const { from, to } of moved) {
    for (const prefix of ["better-agent-chats:", "better-agent-drafts:"]) {
      const value = localStorage.getItem(prefix + from);
      if (value === null) continue;
      let next = value;
      if (prefix === "better-agent-chats:") {
        try {
          const chats = JSON.parse(value) as { worktree?: { path?: string } }[];
          for (const chat of Array.isArray(chats) ? chats : []) {
            const p = chat?.worktree?.path;
            if (typeof p === "string" && (p === from || p.startsWith(from + "/")))
              chat.worktree!.path = to + p.slice(from.length);
          }
          next = JSON.stringify(chats);
        } catch {
          /* keep the stored text */
        }
      }
      localStorage.setItem(prefix + to, next);
      localStorage.removeItem(prefix + from);
    }
    try {
      const last = JSON.parse(localStorage.getItem("verynize-code-last") || "null") as {
        key?: string;
      } | null;
      if (last?.key === from)
        localStorage.setItem("verynize-code-last", JSON.stringify({ ...last, key: to }));
    } catch {
      /* ignore */
    }
  }
}
