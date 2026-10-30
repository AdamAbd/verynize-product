// Organizations as room owners (D1). Every room created by a Better Auth user belongs to one
// organization (`room` table, cloud/migrations/0002_rooms.sql); each user gets a personal
// organization on first use. Organization membership grants a room role:
//   owner, admin -> owner;  member -> the organization's metadata.roomRole (default editor).
// The router computes that role from D1 and forwards it to the room as x-verynize-org-role. The
// room keeps it per live socket, so organization changes are pushed with applyOrgRoles.
import { APIError } from "better-auth/api";

export const MEMBER_ROOM_ROLES = ["viewer", "commenter", "editor"];
const directory = (env) => env.ACCOUNTS.getByName("directory");

const parseMetadata = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "null") || {};
  } catch {
    return {};
  }
};
/** The default room role of plain members, from the organization's metadata. */
export const memberRoomRole = (metadata) => {
  const role = parseMetadata(metadata).roomRole;
  return MEMBER_ROOM_ROLES.includes(role) ? role : "editor";
};
/** Room role for an organization member role (Better Auth stores several as "a,b"). */
export function roomRoleFor(memberRole, metadata) {
  const roles = String(memberRole || "")
    .split(",")
    .map((role) => role.trim());
  if (roles.includes("owner") || roles.includes("admin")) return "owner";
  return roles.includes("member") ? memberRoomRole(metadata) : null;
}
export const isPersonal = (metadata) => parseMetadata(metadata).personal === true;

/** The organization a room belongs to, or null for rooms outside D1 (legacy or anonymous). */
export async function roomOrganization(env, roomId) {
  if (!env.DB) return null;
  return await env.DB.prepare(
    'SELECT r."organizationId" AS id, o."name" AS name, o."metadata" AS metadata FROM "room" r JOIN "organization" o ON o."id" = r."organizationId" WHERE r."id" = ?',
  )
    .bind(roomId)
    .first();
}

/** The user's membership role in an organization, or null. */
export async function membership(env, organizationId, userId) {
  const row = await env.DB.prepare(
    'SELECT "role" FROM "member" WHERE "organizationId" = ? AND "userId" = ?',
  )
    .bind(organizationId, userId)
    .first();
  return row?.role || null;
}

/** The room role the user's organization grants for a room, or null. */
export async function orgRoomRole(env, roomId, userId) {
  if (!env.DB || !userId) return null;
  const row = await env.DB.prepare(
    'SELECT m."role" AS role, o."metadata" AS metadata FROM "room" r JOIN "member" m ON m."organizationId" = r."organizationId" AND m."userId" = ? JOIN "organization" o ON o."id" = r."organizationId" WHERE r."id" = ?',
  )
    .bind(userId, roomId)
    .first();
  return row ? roomRoleFor(row.role, row.metadata) : null;
}

/** The user's personal organization, created on first use. */
export async function ensurePersonalOrganization(env, auth, user) {
  const find = () =>
    env.DB.prepare(
      `SELECT o."id" AS id FROM "organization" o JOIN "member" m ON m."organizationId" = o."id" WHERE m."userId" = ? AND m."role" = 'owner' AND json_extract(o."metadata", '$.personal') = 1 LIMIT 1`,
    )
      .bind(user.id)
      .first();
  const existing = await find();
  if (existing) return existing.id;
  const name = `${(user.name || user.email.split("@")[0]).slice(0, 60)}'s workspace`;
  try {
    const created = await auth.api.createOrganization({
      body: {
        name,
        slug: `personal-${user.id.toLowerCase()}`,
        metadata: { personal: true },
        userId: user.id,
        keepCurrentActiveOrganization: true,
      },
    });
    return created.id;
  } catch (error) {
    // A concurrent first request may have created it.
    const raced = await find();
    if (raced) return raced.id;
    throw error;
  }
}

export async function addRoom(env, { id, organizationId, title, userId }) {
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO "room" ("id", "organizationId", "title", "createdBy", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, organizationId, String(title || "Shared design").slice(0, 120), userId, now, now)
    .run();
}
export async function moveRoom(env, roomId, organizationId) {
  await env.DB.prepare('UPDATE "room" SET "organizationId" = ?, "updatedAt" = ? WHERE "id" = ?')
    .bind(organizationId, Date.now(), roomId)
    .run();
}
/** Keep the listed title current when a room response reports a different one. */
export async function syncTitle(env, roomId, title) {
  if (!env.DB || typeof title !== "string") return;
  await env.DB.prepare(
    'UPDATE "room" SET "title" = ?, "updatedAt" = ? WHERE "id" = ? AND "title" <> ?',
  )
    .bind(title.slice(0, 120), Date.now(), roomId, title.slice(0, 120))
    .run();
}

/** Rooms of one organization, newest first. */
export async function organizationRooms(env, organizationId) {
  const { results } = await env.DB.prepare(
    'SELECT "id", "title", "createdAt", "updatedAt" FROM "room" WHERE "organizationId" = ? ORDER BY "updatedAt" DESC',
  )
    .bind(organizationId)
    .all();
  return results;
}

/** Rooms the user reaches through organizations, with the granted role. */
export async function userOrganizationRooms(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT r."id" AS id, r."title" AS title, r."updatedAt" AS updatedAt, o."id" AS organizationId, o."name" AS organizationName, o."metadata" AS metadata, m."role" AS memberRole FROM "member" m JOIN "organization" o ON o."id" = m."organizationId" JOIN "room" r ON r."organizationId" = o."id" WHERE m."userId" = ? ORDER BY r."updatedAt" DESC',
  )
    .bind(userId)
    .all();
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    role: roomRoleFor(row.memberRole, row.metadata),
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    updatedAt: row.updatedAt,
  }));
}

export async function organizationHasRooms(env, organizationId) {
  return !!(await env.DB.prepare('SELECT 1 AS found FROM "room" WHERE "organizationId" = ? LIMIT 1')
    .bind(organizationId)
    .first());
}

// ---- pushing organization changes to live sockets ----

/** Organization room roles for directory accounts ({accountId: role|null}) in one organization. */
async function rolesForAccounts(env, organizationId, accountIds) {
  const roles = {};
  if (!accountIds.length) return roles;
  const accounts = await directory(env).accountsById(accountIds);
  const org = organizationId
    ? await env.DB.prepare('SELECT "metadata" FROM "organization" WHERE "id" = ?')
        .bind(organizationId)
        .first()
    : null;
  for (const account of accounts) {
    roles[account.id] = null;
    if (!org) continue;
    const row = await env.DB.prepare(
      'SELECT m."role" AS role FROM "member" m JOIN "user" u ON u."id" = m."userId" WHERE m."organizationId" = ? AND u."email" = ?',
    )
      .bind(organizationId, account.email)
      .first();
    roles[account.id] = row ? roomRoleFor(row.role, org.metadata) : null;
  }
  return roles;
}

/** Re-evaluate every live socket of one room against its (new) organization. */
export async function refreshRoom(env, roomId, organizationId) {
  const stub = env.ROOMS.getByName(roomId);
  const accountIds = await stub.connectedAccounts();
  if (accountIds.length)
    await stub.applyOrgRoles(await rolesForAccounts(env, organizationId, accountIds));
}

/** Re-evaluate every room of an organization (default member role changed). */
export async function refreshOrganization(env, organizationId) {
  for (const room of await organizationRooms(env, organizationId))
    await refreshRoom(env, room.id, organizationId);
}

/** One user's membership changed (added, removed, new role): update their live sockets. */
export async function refreshMember(env, organizationId, userId) {
  const user = await env.DB.prepare('SELECT "email" FROM "user" WHERE "id" = ?')
    .bind(userId)
    .first();
  if (!user) return;
  const accountId = await directory(env).accountIdForEmail(user.email);
  if (!accountId) return;
  const memberRole = await membership(env, organizationId, userId);
  const org = await env.DB.prepare('SELECT "metadata" FROM "organization" WHERE "id" = ?')
    .bind(organizationId)
    .first();
  const role = memberRole && org ? roomRoleFor(memberRole, org.metadata) : null;
  for (const room of await organizationRooms(env, organizationId))
    await env.ROOMS.getByName(room.id).applyOrgRoles({ [accountId]: role });
}

/** Organization hooks for cloud/auth.js. Failures to push live updates never undo the change. */
export function organizationHooks(env) {
  const safely = (task) => async (data) => {
    try {
      await task(data);
    } catch (error) {
      console.error("organization access refresh failed", error?.message);
    }
  };
  return {
    afterAddMember: safely(({ member }) =>
      refreshMember(env, member.organizationId, member.userId),
    ),
    afterAcceptInvitation: safely(({ member }) =>
      refreshMember(env, member.organizationId, member.userId),
    ),
    afterRemoveMember: safely(({ member }) =>
      refreshMember(env, member.organizationId, member.userId),
    ),
    afterUpdateMemberRole: safely(({ member }) =>
      refreshMember(env, member.organizationId, member.userId),
    ),
    afterUpdateOrganization: safely(({ organization }) =>
      organization ? refreshOrganization(env, organization.id) : undefined,
    ),
    // "personal-<user id>" is reserved for each user's personal organization.
    beforeCreateOrganization: async ({ organization: data, user }) => {
      const own = `personal-${user.id.toLowerCase()}`;
      const slug = typeof data.slug === "string" ? data.slug : "";
      if ((slug.startsWith("personal-") || data.metadata?.personal !== undefined) && slug !== own)
        throw new APIError("BAD_REQUEST", { message: "This organization slug is reserved" });
      if (
        data.metadata?.roomRole !== undefined &&
        !MEMBER_ROOM_ROLES.includes(data.metadata.roomRole)
      )
        throw new APIError("BAD_REQUEST", {
          message: "roomRole must be viewer, commenter or editor",
        });
    },
    // Metadata updates keep the personal marker as it is and accept only member room roles.
    beforeUpdateOrganization: async ({ organization: data, member }) => {
      if (!data.metadata || typeof data.metadata !== "object") return;
      const metadata = { ...data.metadata };
      if (metadata.roomRole !== undefined && !MEMBER_ROOM_ROLES.includes(metadata.roomRole))
        throw new APIError("BAD_REQUEST", {
          message: "roomRole must be viewer, commenter or editor",
        });
      const current = await env.DB.prepare('SELECT "metadata" FROM "organization" WHERE "id" = ?')
        .bind(member.organizationId)
        .first();
      delete metadata.personal;
      if (isPersonal(current?.metadata)) metadata.personal = true;
      return { data: { metadata } };
    },
    beforeDeleteOrganization: async ({ organization }) => {
      if (await organizationHasRooms(env, organization.id))
        throw new APIError("CONFLICT", {
          message: "Move this organization's rooms to another organization first",
        });
    },
  };
}
