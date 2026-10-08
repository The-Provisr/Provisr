"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SSEEventHandler } from "./event-bus";
import { EventBus } from "./event-bus";
import { SSEClient } from "./sse-client";
import type {
  SSEEventPayloads,
  SSEEventType,
  SSEStatus,
} from "./types";

// Decode metadata.workspaceId from the Clerk session token payload.
// atob on the payload segment is enough here — this is not a trust decision
// (same pattern as components/auth/post-auth-handoff.tsx).
function decodeWorkspaceId(token: string): string | null | undefined {
  try {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) return undefined;
    const padded = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded)) as {
      metadata?: { workspaceId?: string | null };
    };
    return payload.metadata?.workspaceId;
  } catch {
    return undefined;
  }
}

export interface UseSSEResult {
  status: SSEStatus;
  lastEventId: string | null;
  subscribe: <K extends SSEEventType>(
    type: K,
    handler: SSEEventHandler<SSEEventPayloads[K]>,
  ) => () => void;
}

export function useSSE(workspaceId?: string): UseSSEResult {
  const { getToken, isLoaded } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const bus = useMemo(() => new EventBus(), []);
  const [status, setStatus] = useState<SSEStatus>("disconnected");
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [derivedWorkspaceId, setDerivedWorkspaceId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (workspaceId || !isLoaded) return;
    let cancelled = false;
    void (async () => {
      const token = await getTokenRef.current();
      if (cancelled) return;
      setDerivedWorkspaceId(token ? decodeWorkspaceId(token) ?? null : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, workspaceId]);

  const effectiveWorkspaceId = workspaceId ?? derivedWorkspaceId;

  const client = useMemo(() => {
    if (!effectiveWorkspaceId || !isLoaded) return null;
    return new SSEClient({
      workspaceId: effectiveWorkspaceId,
      getToken: () => getTokenRef.current(),
      bus,
    });
  }, [effectiveWorkspaceId, isLoaded, bus]);

  useEffect(() => {
    if (!client) {
      setStatus("disconnected");
      return;
    }
    const unsubscribe = client.subscribe((snapshot) => {
      setStatus(snapshot.status);
      setLastEventId(snapshot.lastEventId);
    });
    void client.connect();
    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [client]);

  const subscribe = useMemo(() => {
    return <K extends SSEEventType>(
      type: K,
      handler: SSEEventHandler<SSEEventPayloads[K]>,
    ) => bus.on(type, handler);
  }, [bus]);

  return { status, lastEventId, subscribe };
}
