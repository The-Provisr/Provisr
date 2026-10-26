import { Injectable } from "@nestjs/common";
import { ClerkAuthService, type ClerkSessionClaims } from "./clerk-auth.service";
import { DbService } from "../db/db.service";

/** Internal Provisr user record created from a verified Clerk identity. */
export interface ProvisionedUser {
  /** Internal Provisr user id (UUID). */
  userId: string;
  /** Clerk user id this record maps to. */
  clerkId: string;
  email: string | undefined;
  createdAt: string;
}

interface WorkspaceContext {
  workspaceId: string;
  role: string;
}

/** Persist verified Clerk subjects and resolve live Provisr memberships. */
@Injectable()
export class IdentityService {
  constructor(private readonly db: DbService, private readonly clerk: ClerkAuthService) {}

  async getOrCreateUser(claims: ClerkSessionClaims, _correlationId?: string): Promise<ProvisionedUser> {
    const email = await this.clerk.getVerifiedEmail(claims.sub, _correlationId);
    const result = await this.db.query<{ id: string; clerk_id: string; email: string; created_at: Date }>(
      `INSERT INTO provisr_identity.users (clerk_id,name,email)
       VALUES ($1,'',$2) ON CONFLICT (clerk_id) DO UPDATE SET email=EXCLUDED.email
       RETURNING id,clerk_id,email,created_at`, [claims.sub, email ?? ""],
    );
    const row = result.rows[0]!;
    return { userId: row.id, clerkId: row.clerk_id, email, createdAt: new Date(row.created_at).toISOString() };
  }

  async resolveMemberships(clerkId: string, _correlationId?: string): Promise<WorkspaceContext[]> {
    const result = await this.db.query<{ workspace_id: string; role: string }>(
      `SELECT m.workspace_id,m.role FROM provisr_identity.memberships m
       JOIN provisr_identity.users u ON u.id=m.user_id
       JOIN provisr_identity.workspaces w ON w.id=m.workspace_id
       WHERE u.clerk_id=$1 AND w.deleted_at IS NULL`, [clerkId],
    );
    return result.rows.map(row => ({ workspaceId: row.workspace_id, role: row.role }));
  }
}
