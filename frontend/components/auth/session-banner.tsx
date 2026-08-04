"use client";

import { useAuth } from "@clerk/nextjs";

export function SessionBanner() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return null;

  return (
    <div role="status">
      Your session expired.{" "}
      <a href={`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`}>
        Sign in again
      </a>
    </div>
  );
}
