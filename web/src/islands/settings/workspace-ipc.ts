// Typed access to the desktop IPC for named accounts, Verynize tool config, chat autonomy, global search and
// workspace moves (desktop/agent-profiles.cjs, agent-tool-config.cjs, agent-autonomy.cjs, project-search.cjs,
// repository-moves.cjs). Everything is optional: the plain web build has no `window.desktop`.

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

type Desktop = {
  agentProfiles?: {
    list(): Promise<ProfileList>;
    add(o: { agent: Agent; name: string }): Promise<Profile>;
    rename(o: { id: string; name: string }): Promise<Profile>;
    remove(o: { id: string }): Promise<unknown>;
    setDefault(o: { agent: Agent; id: string }): Promise<unknown>;
    setChat(o: {
      chatId: string;
      agent: Agent;
      id: string | null;
    }): Promise<{ accounts: Partial<Record<Agent, string>> }>;
    chat(o: { chatId: string }): Promise<Partial<Record<Agent, string>>>;
  };
  agentAccountStatus?(o: { agent: Agent; profile?: string }): Promise<ProfileStatus>;
  startAgentLogin?(o: { agent: Agent; profile?: string }): Promise<{ id: string }>;
  cancelAgentLogin?(o: { id: string }): Promise<unknown>;
  agentLogout?(o: { agent: Agent; profile?: string }): Promise<unknown>;
  onAuthEvent?(
    callback: (event: {
      id: string;
      agent: string;
      profile?: string;
      type: string;
      message: string;
    }) => void,
  ): () => void;
  agentToolConfig?: {
    list(): Promise<{ servers: ToolServer[]; permissions: PermissionRule[] }>;
    saveServer(o: Record<string, unknown>): Promise<ToolServer>;
    setEnabled(o: { id: string; enabled: boolean }): Promise<ToolServer>;
    removeServer(o: { id: string }): Promise<unknown>;
    setPermission(o: Record<string, unknown>): Promise<unknown>;
  };
  agentAutonomy?: {
    get(o: { chatId: string }): Promise<Autonomy>;
    set(o: { chatId: string; settings: Autonomy }): Promise<Autonomy>;
  };
  projectSearch?: {
    search(o: {
      query: string;
      regex?: boolean;
      caseSensitive?: boolean;
      projectIds?: string[];
      designFiles?: boolean;
    }): Promise<SearchResult>;
    open(o: { root: string; path: string; reveal?: boolean }): Promise<unknown>;
  };
  repositoryMoves?: {
    moveInside(o: { repoId: string; from: string; to: string }): Promise<MoveResult>;
    relocate(o: { repoId: string; name?: string; destination?: string }): Promise<MoveResult>;
    moveAcross(o: {
      sourceRepoId: string;
      path: string;
      targetRepoId: string;
      to: string;
      strategy: "patches" | "subtree";
    }): Promise<MoveResult>;
    chooseDestination(): Promise<string | null>;
  };
  repositories?: { list(): Promise<{ repositories: Repository[] }> };
};

export const desktopApi = () => (window as unknown as { desktop?: Desktop }).desktop ?? null;
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
