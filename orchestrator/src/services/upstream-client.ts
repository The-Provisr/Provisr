import { DependencyError, UpstreamError } from "../common/errors/typed-errors";

export interface UpstreamResult<T = unknown> {
  status: number;
  body: T;
}

export interface UpstreamRequestOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

interface UpstreamErrorBody {
  error?: unknown;
  message?: unknown;
}

/**
 * Thin HTTP adapter for the internal Go services. It builds the request, maps
 * connection/timeout failures to a 502 dependency error, and — crucially —
 * preserves the upstream status and domain error slug on non-2xx responses
 * without ever copying an upstream body (which may carry decrypted metadata or
 * credential material) into an error message or log line.
 */
export class UpstreamClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15000,
  ) {}

  async request<T = unknown>(path: string, options: UpstreamRequestOptions): Promise<UpstreamResult<T>> {
    const url = this.buildUrl(path, options.query);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method,
        headers,
        signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      // Never surface the underlying cause: it can contain the internal URL.
      throw new DependencyError("An internal service is unavailable. Please try again.");
    }

    const raw = await response.text();

    if (!response.ok) {
      // Parse defensively: a malformed error body must not hide the upstream
      // status/slug behind a generic dependency error.
      const upstream = this.tryParse(raw) as UpstreamErrorBody | undefined;
      const code = typeof upstream?.error === "string" && upstream.error.length > 0 ? upstream.error : "upstream_error";
      const message =
        typeof upstream?.message === "string" && upstream.message.length > 0
          ? upstream.message
          : "An internal service rejected the request.";
      throw new UpstreamError(response.status, code, message);
    }

    return { status: response.status, body: this.parse(raw) as T };
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private tryParse(raw: string): unknown {
    if (raw.length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  private parse(raw: string): unknown {
    if (raw.length === 0) {
      return undefined;
    }
    const parsed = this.tryParse(raw);
    if (parsed === undefined) {
      throw new DependencyError("An internal service returned an unreadable response.");
    }
    return parsed;
  }
}
