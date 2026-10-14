export function orchestrationBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_ORCHESTRATION_API_URL;
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:4000";
  }
  throw new Error(
    "NEXT_PUBLIC_ORCHESTRATION_API_URL must be configured for client execution",
  );
}
