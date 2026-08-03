"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ClaimProbe = {
  refreshed: boolean;
  matchesExpected: boolean;
};

// Freshness probe only — decode the JWT payload to read metadata.workspaceId.
// atob on the payload segment is enough; this is not a trust decision and must
// never be treated as token verification.
function decodeWorkspaceId(token: string): string | null | undefined {
  try {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) return undefined;
    const padded = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded);
    const payload = JSON.parse(json) as { metadata?: { workspaceId?: string | null } };
    return payload.metadata?.workspaceId;
  } catch {
    return undefined;
  }
}

export function PostAuthHandoff(props: {
  target: string;
  expectedWorkspaceId: string | null;
}) {
  const { target, expectedWorkspaceId } = props;
  const { getToken, isLoaded } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const attempted = useRef(false);
  const [status, setStatus] = useState<"refreshing" | "failed">("refreshing");

  useEffect(() => {
    if (!isLoaded || attempted.current) return;
    attempted.current = true;

    let cancelled = false;

    async function probe(): Promise<ClaimProbe> {
      const token = await getToken({ skipCache: true });
      if (!token) return { refreshed: false, matchesExpected: false };
      const claimed = decodeWorkspaceId(token);
      return {
        refreshed: true,
        matchesExpected: claimed === expectedWorkspaceId,
      };
    }

    async function run() {
      let result = await probe();

      // One retry after reloading the user before giving up. The token may lag
      // one refresh cycle behind the metadata write.
      if (result.refreshed && !result.matchesExpected) {
        await user?.reload();
        result = await probe();
      }

      if (cancelled) return;

      if (result.refreshed && result.matchesExpected) {
        router.replace(target);
        return;
      }

      // Surface the failure instead of silently replacing: a silent replace
      // with a stale claim would land the user on /onboarding via middleware
      // with no signal pointing at the token refresh.
      setStatus("failed");
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, router, target, expectedWorkspaceId, user]);

  if (status === "failed") {
    return (
      <div role="alert">
        <h2>We couldn&apos;t refresh your session.</h2>
        <p>
          Please{" "}
          <a href={`/sign-in?redirect_url=${encodeURIComponent("/post-auth")}`}>
            sign in again
          </a>
          .
        </p>
      </div>
    );
  }

  return <p>Setting things up…</p>;
}
