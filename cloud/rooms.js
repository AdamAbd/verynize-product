// One SQLite Durable Object per shared design room: capability links with roles, account
// members, operation-based merging, revision-checked snapshots (legacy clients), WebSocket
// presence, comments and frozen public snapshots.
import { DurableObject, acceptWebSocket } from "#cloud-runtime";
import "../web/cloud-ops.js";
import {
  json,
  fail,
  readJson,
  documentText,
  randomHex,
  digestHex,
  errorResponse,
  atLeast,
  roleRank,
  ROLES,
  MAX_JSON,
  rpcFail,
} from "./http.js";

const Ops = globalThis.VerynizeOps;
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SOCKETS = 32;
const FUTURE_SKEW = 5 * 60 * 1000;
const TOKEN_ROLES = ["viewer", "commenter", "editor", "owner"];
const ORG_ROLES = ["viewer", "commenter", "editor", "owner"];
const bestRole = (...roles) =>
  roles.filter(Boolean).sort((a, b) => roleRank(b) - roleRank(a))[0] || null;

export class DesignRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL, public_nonce TEXT, public_document TEXT, public_revision INTEGER);
      CREATE TABLE IF NOT EXISTS capabilities (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members (account_id TEXT PRIMARY KEY, email TEXT NOT NULL, handle TEXT, role TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stamps (path TEXT PRIMARY KEY, stamp TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY, last_batch INTEGER NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, author TEXT NOT NULL, account_id TEXT, page_id TEXT, node_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.clock = Ops.createClock("server");
    this.migrateLegacyToken();
  }

  // Rooms created before roles stored one capability hash as a JSON byte array on the room row.
  // It becomes an owner capability, so existing invite links keep their full rights.
  migrateLegacyToken() {
    const row = this.row();
    if (!row || row.token_hash === "migrated") return;
    const bytes = JSON.parse(row.token_hash);
    const hex = bytes.map((n) => n.toString(16).padStart(2, "0")).join("");
    this.sql.exec(
      "INSERT OR IGNORE INTO capabilities (id,hash,role,label,created_at) VALUES (?,?,?,?,?)",
      crypto.randomUUID(),
      hex,
      "owner",
      "Original invite link",
      Date.now(),
    );
    this.sql.exec("UPDATE room SET token_hash='migrated' WHERE id=1");
  }

  row() {
    return this.sql.exec("SELECT * FROM room WHERE id=1").toArray()[0];
  }
  snapshot() {
    const row = this.row();
    return { document: JSON.parse(row.document), revision: row.revision };
  }
  title() {
    try {
      const doc = JSON.parse(this.row().document);
      return typeof doc?.name === "string" ? doc.name.slice(0, 120) : "Shared design";
    } catch {
      return "Shared design";
    }
  }

  async issueToken(role, label) {
    if (!TOKEN_ROLES.includes(role)) fail(400, "Unknown role");
    const secret = randomHex(32),
      id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO capabilities (id,hash,role,label,created_at) VALUES (?,?,?,?,?)",
      id,
      await digestHex(secret),
      role,
      typeof label === "string" ? label.slice(0, 80) : null,
      Date.now(),
    );
    return { id, token: secret, role };
  }

  /**
   * Role granted by a capability token, the signed-in account's membership and/or its
   * organization (x-verynize-org-role, computed by the router from D1; clients cannot send it).
   */
  async access(request, url) {
    const header = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    const secret = /^[0-9a-f]{64}$/.test(header) ? header : url.searchParams.get("token") || "";
    let capability = null;
    if (/^[0-9a-f]{64}$/.test(secret))
      capability =
        this.sql
          .exec("SELECT id,role FROM capabilities WHERE hash=?", await digestHex(secret))
          .toArray()[0] || null;
    let account = null;
    try {
      account = JSON.parse(request.headers.get("x-verynize-account") || "null");
    } catch {}
    const member = account?.id
      ? this.sql.exec("SELECT role FROM members WHERE account_id=?", account.id).toArray()[0]
      : null;
    const org = request.headers.get("x-verynize-org-role");
    const orgRole = ORG_ROLES.includes(org) ? org : null;
    return {
      role: bestRole(capability?.role, member?.role, orgRole),
      capability: capability?.id || null,
      account,
      orgRole,
    };
  }

  async create(data, account) {
    if (this.row()) fail(409, "Room exists");
    const text = documentText(data.document);
    this.sql.exec(
      "INSERT INTO room (id,token_hash,document,revision) VALUES (1,'migrated',?,0)",
      text,
    );
    const issued = await this.issueToken("owner", "Original invite link");
    if (account?.id) this.addMember(account, "owner");
    return json({ token: issued.token, revision: 0, role: "owner", title: this.title() }, 201);
  }

  addMember(account, role) {
    this.sql.exec(
      "INSERT OR REPLACE INTO members (account_id,email,handle,role,added_at) VALUES (?,?,?,?,?)",
      account.id,
      account.email || "",
      account.handle || null,
      role,
      Date.now(),
    );
  }

  broadcast(value, except) {
    const message = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets())
      if (socket !== except) {
        try {
          socket.send(message);
        } catch {}
      }
  }

  stampStore() {
    const cache = new Map(),
      dirty = new Set();
    let cleared = false;
    return {
      get: (path) => {
        if (!cache.has(path))
          cache.set(
            path,
            cleared
              ? undefined
              : this.sql.exec("SELECT stamp FROM stamps WHERE path=?", path).toArray()[0]?.stamp,
          );
        return cache.get(path);
      },
      set: (path, stamp) => {
        cache.set(path, stamp);
        dirty.add(path);
      },
      clear: () => {
        cleared = true;
        cache.clear();
        dirty.clear();
        this.sql.exec("DELETE FROM stamps");
      },
      flush: () => {
        for (const path of dirty)
          this.sql.exec(
            "INSERT OR REPLACE INTO stamps (path,stamp) VALUES (?,?)",
            path,
            cache.get(path),
          );
      },
    };
  }

  /** Legacy whole-document write: revision-checked, then stamped so later operations order after it. */
  update(document, baseRevision) {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0)
      fail(400, "baseRevision must be a nonnegative integer");
    const text = documentText(document);
    const row = this.row();
    if (row.revision !== baseRevision)
      return json({ error: "Revision conflict", ...this.snapshot() }, 409);
    const stamp = this.clock.next();
    const store = this.stampStore();
    Ops.apply(
      JSON.parse(row.document),
      Ops.diff(JSON.parse(row.document), document).map((op) => ({ ...op, s: stamp })),
      { stamps: store },
    );
    store.flush();
    this.sql.exec(
      "UPDATE room SET document=?,revision=revision+1 WHERE id=1 AND revision=?",
      text,
      baseRevision,
    );
    const result = this.snapshot();
    this.broadcast({ type: "snapshot", ...result });
    return json(result);
  }

  /** Apply one client batch of operations. Returns the message describing the outcome. */
  applyBatch(data, role) {
    const client = data?.client,
      batch = data?.batch,
      ops = data?.ops;
    if (typeof client !== "string" || !CLIENT.test(client)) fail(400, "Invalid client id");
    if (!Number.isSafeInteger(batch) || batch < 1) fail(400, "Invalid batch number");
    if (!Array.isArray(ops) || ops.length > 5000) fail(400, "A batch holds 1–5000 operations");
    const revision = this.row().revision;
    const last =
      this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
        ?.last_batch ?? 0;
    if (batch <= last)
      return { type: "ops", client, batch, revision, ops: [], rejected: 0, duplicate: true };
    this.sql.exec(
      "INSERT OR REPLACE INTO clients (client_id,last_batch,seen_at) VALUES (?,?,?)",
      client,
      batch,
      Date.now(),
    );
    if (!atLeast(role, "editor"))
      return {
        type: "ops",
        client,
        batch,
        revision,
        ops: [],
        rejected: ops.length,
        error: "Your role in this room cannot edit",
      };
    const limit = Date.now() + FUTURE_SKEW;
    const stamped = ops.map((op) => {
      const parsed = Ops.decode(op?.s);
      // Missing or far-future stamps would win forever; the server restamps them.
      const s = parsed && parsed.wall <= limit ? op.s : this.clock.next();
      this.clock.observe(s);
      return { ...op, s };
    });
    const store = this.stampStore();
    const current = this.snapshot();
    const result = Ops.apply(current.document, stamped, {
      stamps: store,
      normalize: true,
      stamp: this.clock.next(),
    });
    if (!result.applied.length)
      return { type: "ops", client, batch, revision, ops: [], rejected: result.rejected.length };
    const text = documentText(result.doc);
    store.flush();
    this.sql.exec("UPDATE room SET document=?,revision=revision+1 WHERE id=1", text);
    return {
      type: "ops",
      client,
      batch,
      revision: revision + 1,
      ops: result.applied,
      rejected: result.rejected.length,
      reasons: result.rejected.slice(0, 20),
    };
  }

  /** Role of a signed-in account here: its membership and/or organization role (no links). */
  memberRole(accountId, orgRole) {
    const member = accountId
      ? this.sql.exec("SELECT role FROM members WHERE account_id=?", accountId).toArray()[0]
      : null;
    return bestRole(member?.role, ORG_ROLES.includes(orgRole) ? orgRole : null);
  }

  /** Hosted MCP read (cloud/mcp.js): the snapshot and the caller's role. */
  agentRead({ accountId, orgRole } = {}) {
    const role = this.row() ? this.memberRole(accountId, orgRole) : null;
    if (!role) rpcFail(404, "Room not found, or you have no access to it");
    return { ...this.snapshot(), role, title: this.title() };
  }

  /**
   * Hosted MCP write (cloud/mcp.js): a server-originated batch, computed by the Worker as a diff
   * from `baseRevision`, applied with the caller's role and broadcast to live sockets as `ops`.
   * A newer revision returns {conflict:true} so the caller recomputes its edit.
   */
  agentApply({ accountId, orgRole, baseRevision, ops } = {}) {
    const row = this.row();
    const role = row ? this.memberRole(accountId, orgRole) : null;
    if (!role) rpcFail(404, "Room not found, or you have no access to it");
    if (!atLeast(role, "editor"))
      rpcFail(403, `Your role in this room (${role}) cannot edit; ask an owner for editor access`);
    if (row.revision !== baseRevision) return { conflict: true, revision: row.revision };
    const client = `mcp-${String(accountId)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 56)}`;
    const last =
      this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
        ?.last_batch ?? 0;
    const message = this.applyBatch({ client, batch: last + 1, ops }, role);
    if (message.error) rpcFail(403, message.error);
    if (message.ops.length) this.broadcast(message);
    return {
      applied: message.ops.length,
      rejected: message.rejected,
      reasons: message.reasons || [],
      ...this.snapshot(),
    };
  }

  accessSummary(role) {
    const members = this.sql
      .exec("SELECT account_id,email,handle,role,added_at FROM members ORDER BY added_at")
      .toArray()
      .map((row) => ({
        accountId: row.account_id,
        email: row.email,
        handle: row.handle,
        role: row.role,
      }));
    const result = { role, members, title: this.title() };
    if (role === "owner")
      result.links = this.sql
        .exec("SELECT id,role,label,created_at FROM capabilities ORDER BY created_at")
        .toArray()
        .map((row) => ({
          id: row.id,
          role: row.role,
          label: row.label || "",
          createdAt: row.created_at,
        }));
    return result;
  }

  /** Re-evaluate every live socket after links or members change; revoked peers are disconnected. */
  refreshSockets() {
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() || {};
      const capability = state.capability
        ? this.sql.exec("SELECT role FROM capabilities WHERE id=?", state.capability).toArray()[0]
        : null;
      const member = state.accountId
        ? this.sql.exec("SELECT role FROM members WHERE account_id=?", state.accountId).toArray()[0]
        : null;
      const role = bestRole(capability?.role, member?.role, state.orgRole);
      if (!role) {
        try {
          socket.send(
            JSON.stringify({ type: "revoked", error: "Your access to this room was revoked" }),
          );
          socket.close(4401, "Access revoked");
        } catch {}
        continue;
      }
      if (role !== state.role) {
        socket.serializeAttachment({
          ...state,
          role,
          capability: capability ? state.capability : null,
        });
        try {
          socket.send(JSON.stringify({ type: "role", role }));
        } catch {}
      }
    }
    this.broadcast({ type: "presence", peers: this.peers() });
  }

  async fetch(request) {
    try {
      const url = new URL(request.url),
        action = url.pathname,
        method = request.method;
      const row = this.row();
      if (action === "/create" && method === "POST") {
        let account = null;
        try {
          account = JSON.parse(request.headers.get("x-verynize-account") || "null");
        } catch {}
        return await this.create(await readJson(request), account);
      }
      if (action === "/public" && method === "GET") {
        if (!row || !row.public_nonce || url.searchParams.get("nonce") !== row.public_nonce)
          return json({ error: "Not found" }, 404);
        return json({ document: JSON.parse(row.public_document), revision: row.public_revision });
      }
      if (!row) return json({ error: "Unauthorized" }, 401);
      const { role, capability, account, orgRole } = await this.access(request, url);
      if (!role) return json({ error: "Unauthorized" }, 401);
      const need = (wanted) => {
        if (!atLeast(role, wanted)) fail(403, `This needs the ${wanted} role; you are a ${role}`);
      };

      if (action === "/socket" && method === "GET") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return json({ error: "WebSocket upgrade required" }, 426);
        if (this.ctx.getWebSockets().length >= MAX_SOCKETS)
          return json({ error: "Room connection limit reached" }, 429);
        const client = CLIENT.test(url.searchParams.get("client") || "")
          ? url.searchParams.get("client")
          : null;
        const acked = client
          ? (this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
              ?.last_batch ?? 0)
          : 0;
        const { socket: server, response } = acceptWebSocket(this.ctx);
        const id = crypto.randomUUID();
        server.serializeAttachment({
          id,
          name: account?.displayName || "Guest",
          role,
          capability,
          orgRole,
          accountId: account?.id || null,
          handle: account?.handle || null,
          client,
        });
        server.send(JSON.stringify({ type: "welcome", id, protocol: Ops.PROTOCOL, role, acked }));
        server.send(JSON.stringify({ type: "snapshot", ...this.snapshot(), acked }));
        this.broadcast({ type: "presence", peers: this.peers() });
        return response;
      }
      if (action === "/room" && method === "GET")
        return json({ ...this.snapshot(), role, protocol: Ops.PROTOCOL, title: this.title() });
      if (action === "/room" && method === "PUT") {
        need("editor");
        const data = await readJson(request);
        return this.update(data.document, data.baseRevision);
      }
      if (action === "/ops" && method === "POST") {
        const message = this.applyBatch(await readJson(request), role);
        if (message.ops.length) this.broadcast(message);
        return json(message, message.error ? 403 : 200);
      }
      if (action === "/publish" && method === "POST") {
        need("editor");
        const nonce = randomHex(32);
        this.sql.exec(
          "UPDATE room SET public_nonce=?,public_document=document,public_revision=revision WHERE id=1",
          nonce,
        );
        return json({ nonce, revision: this.row().revision, title: this.title() });
      }
      if (action === "/publish" && method === "DELETE") {
        need("editor");
        this.sql.exec(
          "UPDATE room SET public_nonce=NULL,public_document=NULL,public_revision=NULL WHERE id=1",
        );
        return json({ unpublished: true });
      }
      if (action === "/access" && method === "GET") return json(this.accessSummary(role));
      if (action === "/members" && method === "POST") {
        need("owner");
        const data = await readJson(request);
        const target = data.account;
        if (!target?.id || !["viewer", "commenter", "editor", "owner"].includes(data.role))
          fail(400, "Choose an account and a role");
        this.addMember(target, data.role);
        this.refreshSockets();
        return json({
          member: {
            accountId: target.id,
            email: target.email,
            handle: target.handle,
            role: data.role,
          },
          title: this.title(),
        });
      }
      const memberMatch = action.match(/^\/members\/([0-9a-f-]{36})$/);
      if (memberMatch && method === "DELETE") {
        if (account?.id !== memberMatch[1]) need("owner"); // anyone may leave; owners may remove others
        const owners = this.sql.exec("SELECT account_id FROM members WHERE role='owner'").toArray();
        const ownerLinks = this.sql
          .exec("SELECT COUNT(*) AS n FROM capabilities WHERE role='owner'")
          .one().n;
        if (owners.length === 1 && owners[0].account_id === memberMatch[1] && !ownerLinks)
          fail(409, "Add another owner before removing the last one");
        this.sql.exec("DELETE FROM members WHERE account_id=?", memberMatch[1]);
        this.refreshSockets();
        return json({ removed: memberMatch[1] });
      }
      if (action === "/claim" && method === "POST") {
        need("owner");
        if (!account?.id) fail(401, "Sign in to attach this room to your account");
        this.addMember(account, "owner");
        return json({ role: "owner", title: this.title() });
      }
      if (action === "/tokens" && method === "POST") {
        need("owner");
        const data = await readJson(request);
        return json(await this.issueToken(data.role, data.label), 201);
      }
      if (action === "/tokens/rotate" && method === "POST") {
        need("owner");
        // Every capability link stops working; account members keep their access.
        const revoked = this.sql.exec("SELECT COUNT(*) AS n FROM capabilities").one().n;
        this.sql.exec("DELETE FROM capabilities");
        const issued = await this.issueToken("owner", "Rotated owner link");
        this.refreshSockets();
        return json({ token: issued.token, role: "owner", revoked });
      }
      const tokenMatch = action.match(/^\/tokens\/([0-9a-f-]{36})$/);
      if (tokenMatch && method === "DELETE") {
        need("owner");
        this.sql.exec("DELETE FROM capabilities WHERE id=?", tokenMatch[1]);
        this.refreshSockets();
        return json({ revoked: tokenMatch[1] });
      }
      if (action === "/comments" && method === "GET") {
        return json({
          comments: this.sql
            .exec(
              "SELECT id,author,page_id,node_id,text,created_at FROM comments ORDER BY created_at DESC LIMIT 200",
            )
            .toArray()
            .map((c) => ({
              id: c.id,
              author: c.author,
              pageId: c.page_id,
              nodeId: c.node_id,
              text: c.text,
              createdAt: c.created_at,
            })),
        });
      }
      if (action === "/comments" && method === "POST") {
        need("commenter");
        const data = await readJson(request, 64 * 1024);
        const text = typeof data.text === "string" ? data.text.trim() : "";
        if (!text || text.length > 4000) fail(400, "Comments use 1–4000 characters");
        const comment = {
          id: crypto.randomUUID(),
          author:
            account?.displayName ||
            (typeof data.author === "string" && data.author.trim().slice(0, 80)) ||
            "Guest",
          pageId: typeof data.pageId === "string" ? data.pageId.slice(0, 200) : null,
          nodeId: typeof data.nodeId === "string" ? data.nodeId.slice(0, 200) : null,
          text,
          createdAt: Date.now(),
        };
        this.sql.exec(
          "INSERT INTO comments (id,author,account_id,page_id,node_id,text,created_at) VALUES (?,?,?,?,?,?,?)",
          comment.id,
          comment.author,
          account?.id || null,
          comment.pageId,
          comment.nodeId,
          comment.text,
          comment.createdAt,
        );
        this.broadcast({ type: "comment", comment });
        return json({ comment }, 201);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  /** Account ids of the live sockets, so the router can recompute their organization roles. */
  connectedAccounts() {
    const ids = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      const id = socket.deserializeAttachment()?.accountId;
      if (id) ids.add(id);
    }
    return [...ids];
  }

  /**
   * Organization roles changed ({accountId: role|null}): live sockets of those accounts are
   * re-evaluated and downgraded, promoted or disconnected like after a membership change.
   */
  applyOrgRoles(roles) {
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() || {};
      if (!state.accountId || !Object.hasOwn(roles, state.accountId)) continue;
      const next = ORG_ROLES.includes(roles[state.accountId]) ? roles[state.accountId] : null;
      socket.serializeAttachment({ ...state, orgRole: next });
    }
    this.refreshSockets();
    return { updated: true };
  }

  peers() {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter(Boolean)
      .map((state) => ({
        id: state.id,
        name: state.name,
        role: state.role,
        pageId: state.pageId ?? null,
        cursor: state.cursor ?? null,
        handle: state.handle ?? null,
      }));
  }

  async webSocketMessage(ws, message) {
    try {
      if (typeof message !== "string" || message.length > MAX_JSON)
        throw Error("Invalid message size");
      const data = JSON.parse(message);
      const state = ws.deserializeAttachment() || {};
      if (data.type === "update") {
        if (!atLeast(state.role, "editor")) throw Error("Your role in this room cannot edit");
        const response = this.update(data.document, data.baseRevision);
        if (response.status !== 200)
          ws.send(JSON.stringify({ type: "conflict", ...(await response.json()) }));
      } else if (data.type === "ops") {
        const result = this.applyBatch(
          { ...data, client: state.client || data.client },
          state.role,
        );
        if (result.ops.length) this.broadcast(result);
        else ws.send(JSON.stringify(result));
      } else if (data.type === "presence") {
        const presence = {
          name: typeof data.name === "string" ? data.name.slice(0, 80) : "Guest",
          pageId: typeof data.pageId === "string" ? data.pageId.slice(0, 120) : null,
          cursor:
            data.cursor && Number.isFinite(data.cursor.x) && Number.isFinite(data.cursor.y)
              ? { x: data.cursor.x, y: data.cursor.y }
              : null,
        };
        ws.serializeAttachment({ ...state, ...presence });
        this.broadcast({ type: "presence", peers: this.peers() });
      } else throw Error("Unknown message type");
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: error.message }));
    }
  }

  webSocketClose(ws) {
    const id = ws.deserializeAttachment()?.id;
    this.broadcast({ type: "presence", peers: this.peers().filter((peer) => peer.id !== id) }, ws);
  }

  webSocketError(ws) {
    try {
      ws.close(1011, "Connection error");
    } catch {}
  }
}

export { ROLES };
