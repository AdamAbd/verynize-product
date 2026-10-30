// Cloud files in the Files home: rooms of the active workspace (`/api/orgs/:id/rooms`) plus rooms
// shared with the account directly (`/api/me/rooms`), merged with this device's cloud-backed
// library records so each room appears once. Opening a listed room joins it through
// `window.cloudWorkspace.openRoom`, which creates the library record on first open.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  cloudAccount,
  useActiveOrganization,
  useCloudAccount,
  useOrganizations,
} from "@/lib/cloud-account";
import type { DesignDocument } from "@/lib/bridge";
import type { CloudRoom, LibraryFile } from "./library";

type RoomRow = {
  id: string;
  title?: string;
  role?: string;
  updatedAt?: number;
  organizationId?: string | null;
  organizationName?: string | null;
};
type CloudWorkspaceApi = {
  openRoom(info: { server: string; id: string }): Promise<void>;
};

const RANK: Record<string, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const higher = (a = "", b = "") => ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b);

/** Rooms of the active workspace and rooms shared with you; empty when signed out. */
export function useCloudRooms(active: boolean) {
  const account = useCloudAccount();
  const organization = useActiveOrganization();
  const { organizations } = useOrganizations();
  const [rooms, setRooms] = useState<CloudRoom[]>([]);
  const [error, setError] = useState("");
  const organizationName = organizations.find((org) => org.id === organization)?.name ?? null;
  useEffect(() => {
    const api = cloudAccount();
    if (!active || !api || !account?.emailAccount) {
      setRooms([]);
      return;
    }
    let live = true;
    const server = account.server;
    Promise.all([
      organization
        ? api.request<{ role: string; rooms: RoomRow[] }>(`/api/orgs/${organization}/rooms`)
        : Promise.resolve({ role: "", rooms: [] as RoomRow[] }),
      api.request<{ rooms: RoomRow[] }>("/api/me/rooms"),
    ]).then(
      ([workspace, mine]) => {
        if (!live) return;
        const byId = new Map<string, CloudRoom>();
        const roleIn = new Map(mine.rooms.map((room) => [room.id, room.role ?? ""]));
        for (const room of workspace.rooms)
          byId.set(room.id, {
            id: room.id,
            server,
            title: room.title || "Untitled",
            role: higher(workspace.role, roleIn.get(room.id)),
            updatedAt: room.updatedAt ?? 0,
            organizationName: organizationName ?? "Workspace",
          });
        // Direct shares: rooms outside any of your organizations.
        for (const room of mine.rooms)
          if (!room.organizationId && !byId.has(room.id))
            byId.set(room.id, {
              id: room.id,
              server,
              title: room.title || "Untitled",
              role: room.role ?? "viewer",
              updatedAt: room.updatedAt ?? 0,
              organizationName: null,
            });
        setRooms([...byId.values()]);
        setError("");
      },
      (e: unknown) => {
        if (!live) return;
        setRooms([]);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [active, account, organization, organizationName]);
  return { rooms, error };
}

const emptyDocument = (name: string): DesignDocument =>
  ({ version: 2, name, activePage: "", pages: [], tokens: {} }) as unknown as DesignDocument;

/** Library files with their room's role, plus listed rooms that have no file here yet. */
export function mergeCloudFiles(files: LibraryFile[], rooms: CloudRoom[]): LibraryFile[] {
  const byKey = new Map(rooms.map((room) => [`${room.server}|${room.id}`, room]));
  const merged = files.map((file) => {
    const room = file.cloud && byKey.get(`${file.cloud.server}|${file.cloud.roomId}`);
    if (!room) return file;
    byKey.delete(`${room.server}|${room.id}`);
    return { ...file, cloud: { ...file.cloud!, role: room.role }, room };
  });
  for (const room of byKey.values())
    merged.push({
      id: `room:${room.id}`,
      name: room.title,
      document: emptyDocument(room.title),
      updated: room.updatedAt,
      folder: null,
      archived: false,
      cloud: { server: room.server, roomId: room.id, role: room.role },
      room,
    });
  return merged;
}

/** True for a listed room that has no library record on this device. */
export const isRemoteRoom = (file: LibraryFile) => !!file.room && file.id.startsWith("room:");

/** Open a file, or join a listed room (its file is created on first open). */
export function openEntry(file: LibraryFile, open: (id: string) => unknown) {
  if (!isRemoteRoom(file)) return void open(file.id);
  const workspace = (window as unknown as { cloudWorkspace?: CloudWorkspaceApi }).cloudWorkspace;
  void workspace
    ?.openRoom({ server: file.room!.server, id: file.room!.id })
    .catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};
