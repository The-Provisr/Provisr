import type { Request } from "express";

export interface RequestUser {
  userId: string;
  clerkId: string;
  email: string | undefined;
  workspaceIds: string[];
  roles: Record<string, string>;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
}
