export const GATEWAY_CONFIG = "GATEWAY_CONFIG";

export interface GatewayConfig {
  workspaceServiceUrl: string;
  cloudAccountServiceUrl: string;
  serviceToken: string;
  timeoutMs: number;
}

/** Resolved once at wiring time; never read from process.env inside services. */
export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  // The gateway presents the shared service token on the endpoints that
  // require it (cloud capabilities). Tests boot without a real token so the
  // app can be constructed for auth/validation coverage.
  const serviceToken = env.ORCHESTRATOR_SERVICE_TOKEN ?? (env.NODE_ENV === "test" ? "test-token" : undefined);
  if (!serviceToken) {
    throw new Error("ORCHESTRATOR_SERVICE_TOKEN is required");
  }

  const timeoutMs = Number.parseInt(env.GATEWAY_TIMEOUT_MS ?? "15000", 10);

  return {
    workspaceServiceUrl: env.WORKSPACE_SERVICE_URL ?? "http://localhost:8088",
    cloudAccountServiceUrl: env.CLOUD_ACCOUNT_SERVICE_URL ?? "http://localhost:8089",
    serviceToken,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
  };
}
