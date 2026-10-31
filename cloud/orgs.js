import { and, desc, eq, ne, sql } from "drizzle-orm";
import { database } from "./db.js";
import { room, member } from "./schema.js";
// Organizations as room owners (D1). Every room created by a Better Auth user belongs to one
// organization (`room` table, cloud/migrations/0002_rooms.sql); each user gets a personal
// organization on first use. Organization membership grants a room role:
//   owner, admin -> owner;  member -> the organization's metadata.roomRole (default editor).
// The router computes that role from D1 and forwards it to the room as x-verynize-org-role. The
// room keeps it per live socket, so organization changes are pushed with applyOrgRoles.
import { APIError } from "better-auth/api";
import { profileIdForEmail, profilesById } from "./profiles.js";

export const MEMBER_ROOM_ROLES = ["viewer", "commenter", "editor"];

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
  return await database(env).get(
    sql`SELECT r."organizationId" AS id, o."name" AS name, o."metadata" AS metadata FROM "room" r JOIN "organization" o ON o."id" = r."organizationId" WHERE r."id" = ${roomId}`,
  );
}

/** The user's membership role in an organization, or null. */
export async function membership(env, organizationId, userId) {
  const row = await database(env)
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .get();
  return row?.role || null;
}

/** The room role the user's organization grants for a room, or null. */
export async function orgRoomRole(env, roomId, userId) {
  if (!env.DB || !userId) return null;
  const row = await database(env).get(
    sql`SELECT m."role" AS role, o."metadata" AS metadata FROM "room" r JOIN "member" m ON m."organizationId" = r."organizationId" AND m."userId" = ${userId} JOIN "organization" o ON o."id" = r."organizationId" WHERE r."id" = ${roomId}`,
  );
  return row ? roomRoleFor(row.role, row.metadata) : null;
}

/** The user's personal organization, created on first use. */
export async function ensurePersonalOrganization(env, auth, user) {
  const find = () =>
    database(env).get(
      sql`SELECT o."id" AS id FROM "organization" o JOIN "member" m ON m."organizationId" = o."id" WHERE m."userId" = ${user.id} AND m."role" = 'owner' AND json_extract(o."metadata", '$.personal') = 1 LIMIT 1`,
    );
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
  await database(env)
    .insert(room)
    .values({
      id,
      organizationId,
      title: String(title || "Shared design").slice(0, 120),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
export async function moveRoom(env, roomId, organizationId) {
  await database(env)
    .update(room)
    .set({ organizationId, updatedAt: Date.now() })
    .where(eq(room.id, roomId))
    .run();
}
/** Keep the listed title current when a room response reports a different one. */
export async function syncTitle(env, roomId, title) {
  if (!env.DB || typeof title !== "string") return;
  await database(env)
    .update(room)
    .set({ title: title.slice(0, 120), updatedAt: Date.now() })
    .where(and(eq(room.id, roomId), ne(room.title, title.slice(0, 120))))
    .run();
}

/** Rooms of one organization, newest first. */
export async function organizationRooms(env, organizationId) {
  const results = await database(env)
    .select({
      id: room.id,
      title: room.title,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    })
    .from(room)
    .where(eq(room.organizationId, organizationId))
    .orderBy(desc(room.updatedAt))
    .all();
  return results;
}

/** Rooms the user reaches through organizations, with the granted role. */
export async function userOrganizationRooms(env, userId) {
  const results = await database(env).all(
    sql`SELECT r."id" AS id, r."title" AS title, r."updatedAt" AS updatedAt, o."id" AS organizationId, o."name" AS organizationName, o."metadata" AS metadata, m."role" AS memberRole FROM "member" m JOIN "organization" o ON o."id" = m."organizationId" JOIN "room" r ON r."organizationId" = o."id" WHERE m."userId" = ${userId} ORDER BY r."updatedAt" DESC`,
  );
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
  return !!(await database(env).get(
    sql`SELECT 1 AS found FROM "room" WHERE "organizationId" = ${organizationId} LIMIT 1`,
  ));
}

// ---- pushing organization changes to live sockets ----

/** Organization room roles for directory accounts ({accountId: role|null}) in one organization. */
async function rolesForAccounts(env, organizationId, accountIds) {
  const roles = {};
  if (!accountIds.length) return roles;
  const accounts = await profilesById(env, accountIds);
  const org = organizationId
    ? await database(env).get(
        sql`SELECT "metadata" FROM "organization" WHERE "id" = ${organizationId}`,
      )
    : null;
  for (const account of accounts) {
    roles[account.id] = null;
    if (!org) continue;
    const row = await database(env).get(
      sql`SELECT m."role" AS role FROM "member" m JOIN "user" u ON u."id" = m."userId" WHERE m."organizationId" = ${organizationId} AND u."email" = ${account.email}`,
    );
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
  const user = await database(env).get(sql`SELECT "email" FROM "user" WHERE "id" = ${userId}`);
  if (!user) return;
  const linked = await database(env).get(
    sql`SELECT "id" FROM "profile" WHERE "userId" = ${userId}`,
  );
  const accountId = linked?.id || (await profileIdForEmail(env, user.email));
  if (!accountId) return;
  const memberRole = await membership(env, organizationId, userId);
  const org = await database(env).get(
    sql`SELECT "metadata" FROM "organization" WHERE "id" = ${organizationId}`,
  );
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
      const current = await database(env).get(
        sql`SELECT "metadata" FROM "organization" WHERE "id" = ${member.organizationId}`,
      );
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
