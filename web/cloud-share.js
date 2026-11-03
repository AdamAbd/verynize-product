// Share service behind the Share popover (web/src/islands/share): adds ensureRoom, access, setVisibility, invite,
// shareLink and state to window.cloudWorkspace (web/cloud-panel.js) and fires `verynize:cloud-state` whenever the
// room, role, visibility or presence changes. Contract: design/wonder/share-audit/CONTRACT.md §1–2.
(() => {
  const ws = window.cloudWorkspace;
  if (!ws) return;
  // Default per-person colours until a peer brings its own (presence, collaboration workstream).
  const COLORS = [
    "#a245d3",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#ec4899",
    "#14b8a6",
    "#8b5cf6",
  ];
  const VISIBILITIES = ["private", "public"];
  const ROLES = ["viewer", "editor", "admin"];
  const EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>().]+(\.[^\s@,;<>().]+)+$/;
  let visibility = "private",
    visibilityRoom = "",
    creating = null,
    lastState = "";

  const roomKey = (room = ws.room()) => (room ? `${room.server}|${room.id}` : "");
  const colorFor = (id) => {
    let hash = 0;
    for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  };
  // A route this server does not have yet answers the Worker's generic 404 (cloud/worker.js).
  const missingRoute = (e) => e?.status === 404 && /^not found$/i.test(String(e.message));
  const unsupported = (what) =>
    Object.assign(Error(`${what} isn't available on this server yet.`), { code: "unsupported" });

  function peers() {
    const { selfId, peers: list } = ws.peers();
    const profile = ws.account();
    return list.map((peer) => {
      const self = peer.id === selfId;
      return {
        id: peer.id,
        name: peer.name || "Guest",
        avatarUrl: peer.avatarUrl || (self && profile?.avatarUrl) || null,
        color: peer.color || colorFor(peer.id),
        self,
        busy: !!peer.busy,
      };
    });
  }
  function state() {
    const room = ws.room();
    return {
      connected: !!room,
      roomId: room?.id ?? null,
      role: room ? ws.role() : null,
      visibility: room ? visibility : null,
      peers: room ? peers() : [],
    };
  }
  function emit() {
    const detail = state();
    const key = JSON.stringify(detail);
    if (key === lastState) return;
    lastState = key;
    window.dispatchEvent(new CustomEvent("verynize:cloud-state", { detail }));
  }

  /** The open file's room; a local file becomes a room in the active workspace (signed in). */
  async function ensureRoom() {
    const room = ws.room();
    if (room) return { server: room.server, roomId: room.id };
    const account = window.cloudAccount?.get();
    if (!account) throw Object.assign(Error("Sign in to share this file."), { code: "sign-in" });
    creating ??= ws.createRoom(account.server).finally(() => (creating = null));
    const created = await creating;
    const current = ws.room();
    if (!created || !current) throw Error("The file could not be shared. Try again.");
    return { server: current.server, roomId: current.id };
  }

  /** Room access (CONTRACT §1), filled in for servers that predate visibility and invitations. */
  async function access() {
    const room = ws.room();
    if (!room) return null;
    const key = roomKey(room);
    const data = await ws.request(`/api/rooms/${room.id}/access`);
    const role = data.you?.role || data.role || ws.role();
    const owner = role === "owner";
    const result = {
      ...data,
      role,
      visibility: data.visibility === "public" ? "public" : "private",
      organization: data.organization ?? null,
      you: {
        role,
        canInvite: data.you?.canInvite ?? owner,
        canChangeVisibility: data.you?.canChangeVisibility ?? owner,
      },
      visibilitySupported: "visibility" in data,
    };
    if (roomKey() === key) {
      visibility = result.visibility;
      visibilityRoom = key;
      emit();
    }
    return result;
  }

  async function setVisibility(next) {
    if (!VISIBILITIES.includes(next)) throw Error("Choose Private or Public");
    const { roomId } = await ensureRoom();
    const key = roomKey();
    let result;
    try {
      result = await ws.request(`/api/rooms/${roomId}/visibility`, {
        method: "PUT",
        body: JSON.stringify({ visibility: next }),
      });
    } catch (e) {
      if (missingRoute(e)) throw unsupported("File visibility");
      throw e;
    }
    const value = result?.visibility === "public" ? "public" : "private";
    if (roomKey() === key) {
      visibility = value;
      visibilityRoom = key;
      emit();
    }
    return value;
  }

  /** Invite people to the file's workspace (CONTRACT §1 share-invitations). */
  async function invite(emails, role = "viewer") {
    if (!ROLES.includes(role)) throw Error("Choose Viewer, Editor or Admin");
    const list = [
      ...new Set((emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)),
    ];
    if (!list.length) throw Error("Enter an email address to invite.");
    if (list.length > 20) throw Error("Invite up to 20 people at a time.");
    const bad = list.filter((email) => !EMAIL.test(email));
    if (bad.length)
      return {
        invited: [],
        errors: bad.map((email) => ({ email, message: "Enter a valid email address" })),
      };
    const { roomId } = await ensureRoom();
    try {
      const result = await ws.request(`/api/rooms/${roomId}/share-invitations`, {
        method: "POST",
        body: JSON.stringify({ emails: list, role }),
      });
      return { invited: result?.invited || [], errors: result?.errors || [] };
    } catch (e) {
      if (!missingRoute(e)) throw e;
    }
    // Servers without workspace invitations: add each address as a direct room member.
    const result = { invited: [], errors: [] };
    for (const email of list)
      try {
        await ws.request(`/api/rooms/${roomId}/members`, {
          method: "POST",
          body: JSON.stringify({ email, role: role === "admin" ? "owner" : role }),
        });
        result.invited.push({ email, status: "invited" });
      } catch (e) {
        if (missingRoute(e)) throw unsupported("Inviting people");
        result.errors.push({ email, message: e.message });
      }
    return result;
  }

  /** The file's link, `<server>/#room=<id>`: members-only unless the file is public, never a token. */
  function shareLink() {
    const room = ws.room();
    if (!room) return "";
    const url = new URL(room.server);
    url.pathname = "/";
    url.search = "";
    url.hash = new URLSearchParams({ room: room.id }).toString();
    return url.href;
  }

  function roomChanged() {
    const key = roomKey();
    if (key !== visibilityRoom) {
      visibility = "private";
      visibilityRoom = key;
      // Learn the room's visibility (and the server's role) in the background.
      if (key) access().catch(() => {});
    }
    emit();
  }

  // Every new file is stored in the active workspace, private until shared: the room is created as soon as the
  // library opens the file (web/wonder-shell.js `library-file-created`). Signed out, the file stays on this device.
  window.addEventListener("library-file-created", (event) => {
    const id = event.detail?.id;
    if (!id || !window.cloudAccount?.get() || ws.room()) return;
    if (window.fileLibrary?.currentId !== id) return;
    ensureRoom().catch((e) => console.warn("Could not store the new file in the workspace:", e));
  });

  Object.assign(ws, {
    ensureRoom,
    access,
    setVisibility,
    invite,
    shareLink,
    /** The current `verynize:cloud-state` detail. */
    state,
  });
  window.addEventListener("cloud-room-changed", roomChanged);
  window.addEventListener("cloud-panel-state", emit);
  window.addEventListener("cloud-account-changed", emit);
  roomChanged();
})();
