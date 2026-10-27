"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WorkspaceRoleBadge } from "@/components/layout/workspace-switcher";
import { Button } from "@/components/ui/button";
import {
  acceptInvitation,
  errorMessage,
  isTeamError,
  lookupInvitation,
} from "@/lib/team/client";
import type { Invitation } from "@/lib/team/types";

type Stage =
  | { kind: "enter-code" }
  | { kind: "looking-up" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; invitation: Invitation }
  | { kind: "joining"; invitation: Invitation };

const INPUT_CLASS = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

function readCodeFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("code")?.trim() ?? "";
}

/** Switches the session claim to the joined workspace via the shell's existing handoff. */
async function claimWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch("/api/workspace/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!res.ok) throw new Error("Joined, but could not switch to the workspace. Please retry.");
  const body = (await res.json()) as { workspaceId?: string };
  if (body.workspaceId !== workspaceId) {
    throw new Error("Joined, but could not switch to the workspace. Please retry.");
  }
}

export default function AcceptInvitationPage() {
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();

  const [code, setCode] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "looking-up" });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const signedInEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  useEffect(() => {
    if (nameTouched || !user) return;
    setName([user.firstName, user.lastName].filter(Boolean).join(" "));
  }, [user, nameTouched]);

  const lookup = useCallback(async (value: string) => {
    setError(null);
    setStage({ kind: "looking-up" });
    try {
      const invitation = await lookupInvitation(value);
      setStage({ kind: "ready", invitation });
    } catch (err) {
      setStage({ kind: "invalid", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    const initial = readCodeFromUrl();
    setCode(initial);
    if (initial) {
      void lookup(initial);
    } else {
      setStage({ kind: "enter-code" });
    }
  }, [lookup]);

  function submitCode(event: FormEvent) {
    event.preventDefault();
    const value = code.trim();
    if (value) void lookup(value);
  }

  async function join(invitation: Invitation) {
    await claimWorkspace(invitation.workspace_id);
    router.push("/post-auth");
  }

  async function submitAccept(event: FormEvent) {
    event.preventDefault();
    if (stage.kind !== "ready") return;
    const { invitation } = stage;
    const trimmed = name.trim();
    if (!trimmed) {
      setError({ message: "Enter your name." });
      return;
    }
    setError(null);
    setStage({ kind: "joining", invitation });
    try {
      await acceptInvitation(invitation.code, trimmed);
      await join(invitation);
    } catch (err) {
      setError({ code: isTeamError(err) ? err.code : undefined, message: errorMessage(err) });
      setStage({ kind: "ready", invitation });
    }
  }

  async function goToWorkspace(invitation: Invitation) {
    setError(null);
    setStage({ kind: "joining", invitation });
    try {
      await join(invitation);
    } catch (err) {
      setError({ message: errorMessage(err) });
      setStage({ kind: "ready", invitation });
    }
  }

  function switchAccount() {
    const returnUrl = typeof window !== "undefined" ? window.location.href : "/invitations/accept";
    void signOut({ redirectUrl: `/sign-in?redirect_url=${encodeURIComponent(returnUrl)}` });
  }

  const invitation = stage.kind === "ready" || stage.kind === "joining" ? stage.invitation : null;
  const joining = stage.kind === "joining";

  return (
    <main className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-16">
      <div className="w-full max-w-[460px] rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Provisr</p>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">Join a workspace</h1>

        {stage.kind === "looking-up" ? (
          <p className="mt-4 text-sm text-gray-500">Checking your invitation…</p>
        ) : null}

        {stage.kind === "enter-code" || stage.kind === "invalid" ? (
          <form className="mt-4 space-y-3" onSubmit={submitCode}>
            {stage.kind === "invalid" ? (
              <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700" role="alert">
                {stage.message}
              </p>
            ) : (
              <p className="text-sm text-gray-600">Enter the invitation code from your invite link.</p>
            )}
            <input
              aria-label="Invitation code"
              className={INPUT_CLASS}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Invitation code"
              value={code}
            />
            <div className="flex justify-end">
              <Button disabled={!code.trim()} type="submit" variant="primary">
                Look up invitation
              </Button>
            </div>
          </form>
        ) : null}

        {invitation ? (
          <form className="mt-4 space-y-4" onSubmit={submitAccept}>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
              <div className="flex items-center justify-between gap-2">
                <span>You&apos;ve been invited as</span>
                <WorkspaceRoleBadge role={invitation.role} />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Sent to <span className="font-medium text-gray-700">{invitation.email}</span> ·
                expires {new Date(invitation.expires_at).toLocaleDateString()}
              </div>
            </div>

            <label className="block text-xs font-medium text-gray-700">
              Your name
              <input
                className={`${INPUT_CLASS} mt-1`}
                disabled={joining}
                onChange={(event) => {
                  setNameTouched(true);
                  setName(event.target.value);
                }}
                value={name}
              />
            </label>

            {error ? (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700" role="alert">
                <p>
                  {error.code === "email_mismatch"
                    ? `This invitation was sent to ${invitation.email}, but you're signed in as ${signedInEmail ?? "a different account"}.`
                    : error.message}
                </p>
                {error.code === "email_mismatch" ? (
                  <Button className="mt-2" onClick={switchAccount}>
                    Sign in with a different account
                  </Button>
                ) : null}
                {error.code === "already_member" ? (
                  <Button className="mt-2" onClick={() => void goToWorkspace(invitation)}>
                    Go to workspace
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={joining} type="submit" variant="primary">
                {joining ? "Joining…" : "Accept invitation"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </main>
  );
}
