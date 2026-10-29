// Typed access to the desktop APIs the Code workspace uses (desktop/preload.cjs) and to the chat workspace
// (web/desktop-panel.js, typed in ../chat/store).
import { workspace } from "../chat/store";

export { workspace };
export type Repository = { id: string; name: string; root: string; addedAt: number; git?: boolean };
export type Worktree = { path: string; branch: string | null; shared: boolean };
export type DevServerStatus = {
  state: "stopped" | "starting" | "running" | "exited" | "failed";
  root: string | null;
  url?: string | null;
  error?: string;
  tail?: string;
  detected?: { command: string[] } | null;
  config?: { command: string[] } | null;
};
export type ProjectFile = { path: string; size: number };
export type ChangedFile = { path: string; status: string };

export type DesktopApi = {
  repositories?: {
    list(): Promise<{ repositories: Repository[]; active: { root: string } | null }>;
    addLocal(): Promise<Repository | null>;
    create(options: { name: string; repository?: string }): Promise<Repository | null>;
    archive(id: string): Promise<boolean>;
    createChatWorktree(options: { repoId: string; chatId: string }): Promise<Worktree>;
    removeChatWorktree(options: { repoId: string; chatId: string; force?: boolean }): Promise<boolean>;
    activate(root: string | null): Promise<unknown>;
  };
  devServer?: { status(): Promise<DevServerStatus>; start(): Promise<DevServerStatus>; stop(): Promise<DevServerStatus> };
  listFiles?(): Promise<ProjectFile[]>;
  readFile?(path: string): Promise<string>;
  writeFile?(path: string, text: string): Promise<boolean>;
  readMemory?(): Promise<string>;
  writeMemory?(text: string): Promise<boolean>;
  gitChanges?(options: { root?: string }): Promise<{ files: ChangedFile[] }>;
  gitBranchChanges?(options: { root?: string }): Promise<{ base: string | null; files: ChangedFile[] }>;
  previewApp?(options: { url: string }): Promise<unknown>;
};

export const desktop = () => (window as unknown as { desktop?: DesktopApi }).desktop;

/** "Error invoking remote method 'desktop:x': Error: message" → "message". */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

export function setStatus(text: string) {
  workspace()?.setStatus?.(text);
}
