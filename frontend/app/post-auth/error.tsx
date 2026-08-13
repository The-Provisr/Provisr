"use client";

export default function PostAuthError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div role="alert">
      <h2>We couldn&apos;t finish signing you in.</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
