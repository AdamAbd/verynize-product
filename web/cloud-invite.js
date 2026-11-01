// Invite links of the Share panel (web/cloud-panel.js). An owner's invite never carries the owner's
// own capability token: it carries a role-limited link (editor by default, or viewer) issued with
// POST /api/rooms/:id/tokens. The link is kept on this device per room (localStorage, like the
// file's own token) and reused while the room still lists it, so opening Share does not mint a
// new link every time; a revoked or rotated link is replaced by a fresh one.
(() => {
  const KEY = "verynize.cloud.invites";
  const ROLES = ["editor", "viewer"];
  const TOKEN = /^[0-9a-f]{64}$/;
  const pending = new Map();
  const keyOf = (info) => `${info.server} ${info.id}`;
  const load = () => {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  };
  function stored(info, role) {
    const link = load()[keyOf(info)]?.[role];
    return link && typeof link.id === "string" && TOKEN.test(link.token) ? link : null;
  }
  function remember(info, role, link) {
    const all = load(),
      entry = { ...all[keyOf(info)] };
    if (link) entry[role] = { id: link.id, token: link.token };
    else delete entry[role];
    if (Object.keys(entry).length) all[keyOf(info)] = entry;
    else delete all[keyOf(info)];
    localStorage.setItem(KEY, JSON.stringify(all));
  }
  /** `<server>/#room=<id>[&token=<token>]`; without a token it opens only for account members. */
  function url(info, token) {
    const u = new URL(info.server);
    u.hash = new URLSearchParams(token ? { room: info.id, token } : { room: info.id }).toString();
    return u.href;
  }
  /**
   * The invite URL for `role` (owners only). `request(path, options)` is authenticated as the owner
   * (web/cloud-panel.js request() bound to the connection).
   */
  function create(info, role, request) {
    if (!ROLES.includes(role))
      return Promise.reject(Error("Invite links are for editors or viewers"));
    const key = `${keyOf(info)} ${role}`;
    if (!pending.has(key))
      pending.set(
        key,
        (async () => {
          const link = stored(info, role);
          if (link) {
            const access = await request(`/api/rooms/${info.id}/access`);
            if ((access.links || []).some((item) => item.id === link.id))
              return url(info, link.token);
          }
          const label = `${role[0].toUpperCase()}${role.slice(1)} invite`;
          const result = await request(`/api/rooms/${info.id}/tokens`, {
            method: "POST",
            body: JSON.stringify({ role, label }),
          });
          remember(info, role, result);
          return url(info, result.token);
        })().finally(() => pending.delete(key)),
      );
    return pending.get(key);
  }
  /** Forget the room's invite links on this device (after rotation every link is revoked). */
  function forget(info) {
    for (const role of ROLES) remember(info, role, null);
  }
  window.cloudInvites = { url, create, forget };
})();
