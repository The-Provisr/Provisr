"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ROLE_LABELS,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "@/components/layout/permissions";
import { WorkspaceRoleBadge } from "@/components/layout/workspace-switcher";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  AppShell,
  DataTable,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";
import { Toast } from "@/components/ui/toast";
import {
  changeMemberRole,
  createInvitation,
  errorMessage,
  invitationLink,
  isForbidden,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
} from "@/lib/team/client";
import type { Invitation, Member } from "@/lib/team/types";
import { useWorkspaceRole } from "@/lib/team/use-workspace-role";

type ViewState = "loading" | "ready" | "forbidden" | "error";

type PendingAction =
  | { kind: "role"; member: Member }
  | { kind: "remove"; member: Member }
  | { kind: "invite" }
  | { kind: "revoke"; invitation: Invitation }
  | null;

const INPUT_CLASS = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatExpiry(value: string, now = Date.now()): string {
  const ms = new Date(value).getTime() - now;
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

function RoleSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: WorkspaceRole;
  onChange: (role: WorkspaceRole) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className={INPUT_CLASS}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as WorkspaceRole)}
      value={value}
    >
      {WORKSPACE_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700" role="alert">
      {message}
    </p>
  );
}

export default function TeamPage() {
  const roleState = useWorkspaceRole();
  const isAdmin = roleState.status === "ready" && roleState.role === "admin";

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const [action, setAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [nextRole, setNextRole] = useState<WorkspaceRole>("engineer");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("engineer");
  const [createdInvite, setCreatedInvite] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [memberList, invitationList] = await Promise.all([listMembers(), listInvitations()]);
      setMembers(memberList);
      setInvitations(invitationList);
      setViewState("ready");
    } catch (error) {
      if (isForbidden(error)) {
        setViewState("forbidden");
        return;
      }
      setLoadError(errorMessage(error));
      setViewState("error");
    }
  }, []);

  useEffect(() => {
    if (roleState.status !== "ready") return;
    if (roleState.role !== "admin") {
      // Only admins hold member.* / invitation.* permissions (BE-A03); skip
      // calls that would 403 and show the explanatory notice instead.
      setViewState("forbidden");
      return;
    }
    void load();
  }, [roleState, load]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setAction(null);
    setActionError(null);
    setCreatedInvite(null);
    setCopied(false);
  }, [busy]);

  function openRoleDialog(member: Member) {
    setNextRole(member.role);
    setActionError(null);
    setAction({ kind: "role", member });
  }

  function openInviteDialog() {
    setInviteEmail("");
    setInviteRole("engineer");
    setCreatedInvite(null);
    setCopied(false);
    setActionError(null);
    setAction({ kind: "invite" });
  }

  async function run(task: () => Promise<void>, success: string, keepOpen = false) {
    setBusy(true);
    setActionError(null);
    try {
      await task();
      setFeedback(success);
      if (!keepOpen) setAction(null);
      await load();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function submitRoleChange() {
    if (action?.kind !== "role") return;
    const { member } = action;
    if (nextRole === member.role) {
      setAction(null);
      return;
    }
    void run(
      () => changeMemberRole(member.id, nextRole),
      `${member.name || member.email} is now ${ROLE_LABELS[nextRole]}.`,
    );
  }

  function submitRemove() {
    if (action?.kind !== "remove") return;
    const { member } = action;
    void run(() => removeMember(member.id), `${member.name || member.email} was removed.`);
  }

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      setActionError("Enter an email address.");
      return;
    }
    void run(
      async () => {
        setCreatedInvite(await createInvitation(email, inviteRole));
      },
      `Invitation created for ${email}.`,
      true,
    );
  }

  function submitRevoke() {
    if (action?.kind !== "revoke") return;
    const { invitation } = action;
    void run(() => revokeInvitation(invitation.id), `Invitation for ${invitation.email} revoked.`);
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <AppShell sidebar={<WorkspaceSidebar active="Team" />}>
      <PageHeader
        actions={
          isAdmin && viewState === "ready" ? (
            <Button onClick={openInviteDialog} variant="primary">
              Invite member
            </Button>
          ) : undefined
        }
        description="Manage workspace members, roles, and pending invitations."
        title="Team"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          {viewState === "loading" ? (
            <SectionCard>
              <p className="text-sm text-gray-500">Loading team…</p>
            </SectionCard>
          ) : null}

          {viewState === "forbidden" ? (
            <SectionCard title="Admins only">
              <p className="text-sm text-gray-600">
                Only workspace admins can view and manage members and invitations. Ask an admin
                if you need a role change or want to invite someone.
              </p>
            </SectionCard>
          ) : null}

          {viewState === "error" ? (
            <SectionCard title="Couldn't load the team">
              <p className="text-sm text-gray-600" role="alert">
                {loadError}
              </p>
              <Button className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </SectionCard>
          ) : null}

          {viewState === "ready" ? (
            <>
              <SectionCard title="Members">
                {members.length === 0 ? (
                  <p className="text-sm text-gray-500">No members yet.</p>
                ) : (
                  <DataTable
                    columns={["Name", "Email", "Role", "Joined", "Actions"]}
                    rows={members.map((member) => [
                      <span className="font-medium text-gray-900" key={`${member.id}-name`}>
                        {member.name || "—"}
                      </span>,
                      member.email,
                      <WorkspaceRoleBadge key={`${member.id}-role`} role={member.role} />,
                      formatDate(member.joined_at),
                      <div className="flex flex-wrap gap-2" key={`${member.id}-actions`}>
                        <Button
                          aria-label={`Change role for ${member.email}`}
                          onClick={() => openRoleDialog(member)}
                        >
                          Change role
                        </Button>
                        <Button
                          aria-label={`Remove ${member.email}`}
                          onClick={() => {
                            setActionError(null);
                            setAction({ kind: "remove", member });
                          }}
                          variant="ghost"
                        >
                          Remove
                        </Button>
                      </div>,
                    ])}
                  />
                )}
              </SectionCard>

              <SectionCard title="Pending invitations">
                {invitations.length === 0 ? (
                  <p className="text-sm text-gray-500">No pending invitations.</p>
                ) : (
                  <DataTable
                    columns={["Email", "Role", "Sent", "Expires", "Actions"]}
                    rows={invitations.map((invitation) => [
                      <span className="font-medium text-gray-900" key={`${invitation.id}-email`}>
                        {invitation.email}
                      </span>,
                      <WorkspaceRoleBadge key={`${invitation.id}-role`} role={invitation.role} />,
                      formatDate(invitation.created_at),
                      <StatusBadge key={`${invitation.id}-exp`} tone="amber">
                        {formatExpiry(invitation.expires_at)}
                      </StatusBadge>,
                      <div className="flex flex-wrap gap-2" key={`${invitation.id}-actions`}>
                        <Button
                          aria-label={`Copy invite link for ${invitation.email}`}
                          onClick={() => void copyLink(invitationLink(origin, invitation.code))}
                        >
                          Copy link
                        </Button>
                        <Button
                          aria-label={`Revoke invitation for ${invitation.email}`}
                          onClick={() => {
                            setActionError(null);
                            setAction({ kind: "revoke", invitation });
                          }}
                          variant="ghost"
                        >
                          Revoke
                        </Button>
                      </div>,
                    ])}
                  />
                )}
              </SectionCard>
            </>
          ) : null}
        </div>
      </PageBody>

      <Dialog
        description={action?.kind === "role" ? `${action.member.name || action.member.email} · ${action.member.email}` : undefined}
        footer={
          <>
            <Button disabled={busy} onClick={closeDialog} variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy} onClick={submitRoleChange} variant="primary">
              {busy ? "Saving…" : "Save role"}
            </Button>
          </>
        }
        onClose={closeDialog}
        open={action?.kind === "role"}
        title="Change role"
      >
        <RoleSelect disabled={busy} label="New role" onChange={setNextRole} value={nextRole} />
        <InlineError message={actionError} />
      </Dialog>

      <Dialog
        description={
          action?.kind === "remove"
            ? `${action.member.name || action.member.email} will lose access to this workspace.`
            : undefined
        }
        footer={
          <>
            <Button disabled={busy} onClick={closeDialog} variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy} onClick={submitRemove} variant="primary">
              {busy ? "Removing…" : "Remove member"}
            </Button>
          </>
        }
        onClose={closeDialog}
        open={action?.kind === "remove"}
        title="Remove member"
      >
        <InlineError message={actionError} />
      </Dialog>

      <Dialog
        description={
          action?.kind === "revoke"
            ? `The invitation link sent to ${action.invitation.email} will stop working.`
            : undefined
        }
        footer={
          <>
            <Button disabled={busy} onClick={closeDialog} variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy} onClick={submitRevoke} variant="primary">
              {busy ? "Revoking…" : "Revoke invitation"}
            </Button>
          </>
        }
        onClose={closeDialog}
        open={action?.kind === "revoke"}
        title="Revoke invitation"
      >
        <InlineError message={actionError} />
      </Dialog>

      <Dialog
        description="Invitations expire after 7 days."
        onClose={closeDialog}
        open={action?.kind === "invite"}
        title="Invite member"
      >
        {createdInvite ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Share this link with <span className="font-medium">{createdInvite.email}</span>. They
              must sign in with that email to accept.
            </p>
            <input
              aria-label="Invitation link"
              className={INPUT_CLASS}
              readOnly
              value={invitationLink(origin, createdInvite.code)}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={() => void copyLink(invitationLink(origin, createdInvite.code))}>
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button onClick={closeDialog} variant="primary">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submitInvite}>
            <label className="block text-xs font-medium text-gray-700">
              Email
              <input
                autoComplete="off"
                className={`${INPUT_CLASS} mt-1`}
                disabled={busy}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@company.com"
                type="email"
                value={inviteEmail}
              />
            </label>
            <label className="block text-xs font-medium text-gray-700">
              Role
              <div className="mt-1">
                <RoleSelect disabled={busy} label="Invite role" onChange={setInviteRole} value={inviteRole} />
              </div>
            </label>
            <InlineError message={actionError} />
            <div className="flex justify-end gap-2 pt-2">
              <Button disabled={busy} onClick={closeDialog} variant="ghost">
                Cancel
              </Button>
              <Button disabled={busy} type="submit" variant="primary">
                {busy ? "Sending…" : "Create invitation"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {feedback && action === null ? (
        <Toast message={feedback} onDismiss={() => setFeedback(null)} />
      ) : null}
    </AppShell>
  );
}
