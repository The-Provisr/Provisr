/** Nest DI token for the auth configuration. */
export const AUTH_CONFIG = "AUTH_CONFIG";

export interface AuthConfig {
  /** Clerk secret key (sk_test_... / sk_live_...). Required in production. */
  secretKey: string | undefined;
  /**
   * Optional comma-separated allow-list of origins (e.g. https://app.provisr.io)
   * accepted as the JWT's authorized party. When unset, the party check is skipped.
   */
  authorizedParties: string[] | undefined;
  /** TTL for cached verified tokens, milliseconds. */
  tokenCacheTtlMs: number;
  /** TTL for cached Clerk organization memberships, milliseconds. */
  membershipCacheTtlMs: number;
}

const DEFAULT_TOKEN_CACHE_TTL_MS = 60_000;
const DEFAULT_MEMBERSHIP_CACHE_TTL_MS = 60_000;

/**
 * Loads auth configuration from environment variables. Config is read once at
 * module wiring time and passed into services (never read from process.env
 * inside functions). Missing CLERK_SECRET_KEY in production fails fast at boot
 * so a misconfigured deployment can never serve 401-as-success.
 */
export function loadAuthConfig(): AuthConfig {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const tokenCacheTtlMs = parsePositiveInt(
    process.env.CLERK_TOKEN_CACHE_TTL_MS,
    DEFAULT_TOKEN_CACHE_TTL_MS,
  );
  const membershipCacheTtlMs = parsePositiveInt(
    process.env.CLERK_MEMBERSHIP_CACHE_TTL_MS,
    DEFAULT_MEMBERSHIP_CACHE_TTL_MS,
  );

  if (!secretKey && process.env.NODE_ENV === "production") {
    throw new Error("CLERK_SECRET_KEY is required when NODE_ENV is production");
  }

  return {
    secretKey,
    authorizedParties,
    tokenCacheTtlMs,
    membershipCacheTtlMs,
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  // parseInt("5000ms") would silently return 5000; require the whole value to
  // be decimal digits so malformed config falls back instead.
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : fallback;
}
