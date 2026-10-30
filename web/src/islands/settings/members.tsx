// Settings › Members (design/wonder/77): the active workspace's members, roles and invitations,
// the default room access of plain members, invitations addressed to you, and leaving or deleting
// a team. Data comes from the Better Auth organization plugin (cloud/auth.js) through
// window.cloudAccount; room access follows these roles on the server (cloud/orgs.js).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { MailIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import {
  authRequest,
  canManage,
  cloudAccount,
  isPersonal,
  memberRoomRole,
  openSignIn,
  organizationsChanged,
  roleNames,
  useActiveOrganization,
  useOrganizations,
  type FullOrganization,
  type MemberRoomRole,
  type OrganizationInvitation,
} from "@/lib/cloud-account";
import { cn } from "@/lib/utils";
import {
  Card,
  NativeSelect,
  PageHeader,
  Row,
  Section,
  SettingsButton,
  TextField,
} from "./controls";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const ROOM_ROLE_LABEL: Record<MemberRoomRole, string> = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const roleLabel = (role: string) =>
  roleNames(role)
    .map((r) => ROLE_LABEL[r] ?? r)
    .join(", ");

function ago(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 60 / 24)}d ago`;
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-2xs font-medium text-primary-text"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-1 flex-col gap-2 px-4 py-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg text-foreground">{value}</span>
    </div>
  );
}

/** Invitations sent to the signed-in email, from any organization. */
function IncomingInvitations({ onAccepted }: { onAccepted(id: string): void }) {
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const reload = useCallback(() => {
    authRequest<OrganizationInvitation[]>("/organization/list-user-invitations").then(
      (list) => setInvitations(list.filter((i) => i.status === "pending")),
      () => setInvitations([]),
    );
  }, []);
  useEffect(reload, [reload]);
  if (!invitations.length) return null;
  const answer = async (invitation: OrganizationInvitation, accept: boolean) => {
    try {
      await authRequest(`/organization/${accept ? "accept" : "reject"}-invitation`, {
        invitationId: invitation.id,
      });
      await organizationsChanged();
      if (accept) onAccepted(invitation.organizationId);
      toast(accept ? `Joined ${invitation.organizationName}` : "Invitation declined");
    } catch (error) {
      toast(errorText(error));
    }
    reload();
  };
  return (
    <Section id="members-incoming" title="Invitations for you">
      <Card>
        {invitations.map((invitation) => (
          <Row
            key={invitation.id}
            title={invitation.organizationName || "A workspace"}
            description={`Join as ${roleLabel(invitation.role || "member")}`}
            icon={<MailIcon className="mt-0.5 size-4 text-muted-foreground" />}
          >
            <SettingsButton variant="ghost" onClick={() => void answer(invitation, false)}>
              Decline
            </SettingsButton>
            <SettingsButton
              variant="primary"
              data-accept-invitation={invitation.id}
              onClick={() => void answer(invitation, true)}
            >
              Accept
            </SettingsButton>
          </Row>
        ))}
      </Card>
    </Section>
  );
}

export function MembersPage() {
  const { account, organizations, reload: reloadOrganizations } = useOrganizations();
  const activeId = useActiveOrganization();
  const active = organizations.find((org) => org.id === activeId) ?? organizations[0] ?? null;
  const [loaded, setFull] = useState<FullOrganization | null>(null);
  // Never show the previous workspace's members while the active one loads.
  const full = loaded && loaded.id === active?.id ? loaded : null;
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const load = useCallback(async () => {
    if (!active) return setFull(null);
    try {
      setFull(
        await cloudAccount()!.request<FullOrganization>(
          `/api/auth/organization/get-full-organization?organizationId=${encodeURIComponent(active.id)}`,
        ),
      );
    } catch (error) {
      toast(errorText(error));
    }
  }, [active]);
  useEffect(() => {
    void load();
  }, [load]);

  const me = full?.members.find((m) => m.user.email === account?.account.email) ?? null;
  const manager = canManage(me?.role);
  const owner = roleNames(me?.role).includes("owner");
  const personal = active ? isPersonal(active) : false;
  const members = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (full?.members ?? []).filter(
      (m) => !q || m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [full, query]);
  const pending = (full?.invitations ?? []).filter((i) => i.status === "pending");

  const act = async (task: () => Promise<unknown>, done?: string) => {
    try {
      await task();
      if (done) toast(done);
    } catch (error) {
      toast(errorText(error));
    }
    await load();
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!active || !email.trim()) return;
    void act(async () => {
      await authRequest("/organization/invite-member", {
        email: email.trim(),
        role,
        organizationId: active.id,
      });
      setEmail("");
      setInviting(false);
    }, `Invitation sent to ${email.trim()}`);
  };

  if (!account?.emailAccount)
    return (
      <>
        <PageHeader
          title="Members"
          description="Invite people into a workspace to design together."
        />
        <Card>
          <Row
            title="Sign in to manage members"
            description={
              account
                ? "Your passkey session cannot manage workspaces. Sign in with your email and password."
                : "Workspaces, members and shared rooms need a Verynize account."
            }
            icon={<UsersIcon className="mt-0.5 size-4 text-muted-foreground" />}
          >
            <SettingsButton id="members-sign-in" variant="primary" onClick={openSignIn}>
              Sign in
            </SettingsButton>
          </Row>
        </Card>
      </>
    );

  return (
    <div className="flex flex-col gap-10" id="members-page" data-organization={active?.id ?? ""}>
      <PageHeader
        title="Members"
        description={
          active
            ? personal
              ? "Your personal workspace. Rooms you share land here unless you pick a team."
              : `People in ${active.name} reach every room shared in it.`
            : "Loading workspaces…"
        }
      />
      <IncomingInvitations
        onAccepted={(id) => {
          cloudAccount()?.setActiveOrganization(id);
          void reloadOrganizations();
        }}
      />
      <Section id="members-overview" title="Members overview">
        <div className="flex divide-x divide-card-border rounded-2xl border border-card-border bg-card">
          <Stat label="Total members" value={full?.members.length ?? "–"} />
          <Stat label="Pending invitations" value={pending.length} />
          <Stat label="Workspace" value={personal ? "Personal" : "Team"} />
        </div>
      </Section>

      <Section
        id="members-manage"
        title="Manage members"
        description="Manage workspace members, roles, and invitations."
      >
        <div className="mb-3 flex items-center justify-between gap-4 px-4">
          <label className="m-0 flex h-7 w-72 items-center gap-2 rounded-md border border-input px-2 text-subtle-foreground focus-within:border-primary">
            <SearchIcon className="size-3.5 shrink-0" aria-hidden />
            <input
              id="members-search"
              type="search"
              aria-label="Search members"
              placeholder="Search members..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="m-0 h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </label>
          {manager ? (
            <SettingsButton
              id="members-invite"
              variant="primary"
              onClick={() => setInviting((v) => !v)}
            >
              <PlusIcon />
              Invite member
            </SettingsButton>
          ) : null}
        </div>
        {inviting ? (
          <form
            id="members-invite-form"
            onSubmit={invite}
            className="mb-3 flex items-center gap-2 px-4"
          >
            <TextField
              id="members-invite-email"
              type="email"
              required
              placeholder="teammate@studio.com"
              aria-label="Email to invite"
              className="min-w-0 flex-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <NativeSelect
              id="members-invite-role"
              aria-label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </NativeSelect>
            <SettingsButton id="members-invite-send" type="submit" variant="primary">
              Send invite
            </SettingsButton>
          </form>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-card-border bg-card" role="table">
          <div
            role="row"
            className="grid grid-cols-12 gap-3 border-b border-divider px-4 py-2.5 text-sm text-muted-foreground"
          >
            <span role="columnheader" className="col-span-4">
              Member
            </span>
            <span role="columnheader" className="col-span-4">
              Email
            </span>
            <span role="columnheader" className="col-span-2">
              Role
            </span>
            <span role="columnheader" className="col-span-2">
              Added
            </span>
          </div>
          {members.map((member) => {
            const self = member.id === me?.id;
            const memberOwner = roleNames(member.role).includes("owner");
            const editable = manager && !self && (owner || !memberOwner);
            return (
              <div
                key={member.id}
                role="row"
                data-org-member={member.user.email}
                className="group grid grid-cols-12 items-center gap-3 border-t border-divider px-4 py-2.5 first:border-t-0"
              >
                <span
                  role="cell"
                  className="col-span-4 flex min-w-0 items-center gap-2.5 text-foreground"
                >
                  <Initial name={member.user.name || member.user.email} />
                  <span className="truncate">{member.user.name || member.user.email}</span>
                  {self ? <span className="text-muted-foreground">You</span> : null}
                </span>
                <span role="cell" className="col-span-4 truncate text-muted-foreground">
                  {member.user.email}
                </span>
                <span role="cell" className="col-span-2">
                  {editable ? (
                    <NativeSelect
                      aria-label={`Role of ${member.user.email}`}
                      data-org-member-role={member.user.email}
                      value={roleNames(member.role)[0]}
                      onChange={(e) =>
                        void act(
                          () =>
                            authRequest("/organization/update-member-role", {
                              organizationId: active!.id,
                              memberId: member.id,
                              role: e.target.value,
                            }),
                          "Role updated",
                        )
                      }
                    >
                      {owner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </NativeSelect>
                  ) : (
                    <span className="text-foreground">{roleLabel(member.role)}</span>
                  )}
                </span>
                <span
                  role="cell"
                  className="col-span-2 flex items-center justify-between gap-2 text-muted-foreground"
                >
                  <span className="truncate whitespace-nowrap">{ago(member.createdAt)}</span>
                  {editable ? (
                    <SettingsButton
                      variant="ghost"
                      data-org-remove-member={member.user.email}
                      aria-label={`Remove ${member.user.email}`}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        if (!window.confirm(`Remove ${member.user.email} from ${active!.name}?`))
                          return;
                        void act(
                          () =>
                            authRequest("/organization/remove-member", {
                              organizationId: active!.id,
                              memberIdOrEmail: member.id,
                            }),
                          "Member removed",
                        );
                      }}
                    >
                      Remove
                    </SettingsButton>
                  ) : null}
                </span>
              </div>
            );
          })}
          {members.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {full ? "No members match your search." : "Loading members…"}
            </p>
          ) : null}
        </div>
        {manager && pending.length ? (
          <Card className="mt-3" id="members-pending">
            {pending.map((invitation) => (
              <Row
                key={invitation.id}
                title={invitation.email}
                description={`Invited as ${roleLabel(invitation.role || "member")} · expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
              >
                <SettingsButton
                  variant="ghost"
                  data-cancel-invitation={invitation.email}
                  onClick={() =>
                    void act(
                      () =>
                        authRequest("/organization/cancel-invitation", {
                          invitationId: invitation.id,
                        }),
                      "Invitation canceled",
                    )
                  }
                >
                  Cancel
                </SettingsButton>
              </Row>
            ))}
          </Card>
        ) : null}
      </Section>

      {active ? (
        <Section id="members-access" title="Room access">
          <Card>
            <Row
              title="Default access for members"
              description="What members (not admins) can do in rooms shared in this workspace. Owners and admins can always manage them."
              htmlFor="members-room-role"
            >
              <NativeSelect
                id="members-room-role"
                disabled={!manager}
                value={memberRoomRole(active)}
                onChange={(e) =>
                  void act(async () => {
                    await authRequest("/organization/update", {
                      organizationId: active.id,
                      data: { metadata: { roomRole: e.target.value } },
                    });
                    await organizationsChanged();
                  }, "Default access updated")
                }
              >
                {(Object.keys(ROOM_ROLE_LABEL) as MemberRoomRole[]).map((value) => (
                  <option key={value} value={value}>
                    {ROOM_ROLE_LABEL[value]}
                  </option>
                ))}
              </NativeSelect>
            </Row>
          </Card>
        </Section>
      ) : null}

      {active && !personal && me ? (
        <Section id="members-danger" title="Leave or delete">
          <Card>
            <Row
              title={`Leave ${active.name}`}
              description="You lose access to its rooms unless someone shares them with you directly."
            >
              <SettingsButton
                id="members-leave"
                onClick={() => {
                  if (!window.confirm(`Leave ${active.name}?`)) return;
                  void act(async () => {
                    await authRequest("/organization/leave", { organizationId: active.id });
                    await organizationsChanged();
                  }, `You left ${active.name}`);
                }}
              >
                Leave
              </SettingsButton>
            </Row>
            {owner ? (
              <Row
                title="Delete organization"
                description="Only possible once its rooms have moved to another workspace."
              >
                <SettingsButton
                  id="members-delete"
                  className={cn("text-destructive")}
                  onClick={() => {
                    if (!window.confirm(`Delete ${active.name}? This cannot be undone.`)) return;
                    void act(async () => {
                      await authRequest("/organization/delete", { organizationId: active.id });
                      await organizationsChanged();
                    }, `${active.name} deleted`);
                  }}
                >
                  Delete
                </SettingsButton>
              </Row>
            ) : null}
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
