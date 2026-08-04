export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      workspaceId?: string | null;
    };
  }
}
