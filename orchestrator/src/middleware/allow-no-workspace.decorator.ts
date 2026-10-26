import { SetMetadata } from "@nestjs/common";

export const ALLOW_NO_WORKSPACE_MEMBERSHIP_KEY = "allowNoWorkspaceMembership";

/**
 * Allows an authenticated user with no workspace memberships to reach a route.
 *
 * The global guard normally rejects such users with 403 so no workspace-scoped
 * data is reachable before onboarding. Invitations are the exception: an
 * invited user must be able to look up and accept an invitation before they
 * belong to any workspace. The token is still verified and req.user is still
 * populated; only the zero-membership rejection is skipped.
 */
export const AllowNoWorkspaceMembership = () =>
  SetMetadata(ALLOW_NO_WORKSPACE_MEMBERSHIP_KEY, true);
