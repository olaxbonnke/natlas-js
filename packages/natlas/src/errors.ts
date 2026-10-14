/** Base class for every error thrown by natlas-js. */
export class NAtlasError extends Error {
  /** Machine-readable error code. */
  readonly code: string;
  /** Whether retrying the same request may succeed. */
  readonly retryable: boolean;

  constructor(message: string, code = "natlas_error", retryable = false, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid arguments passed to the SDK (caught before any network call). */
export class NAtlasValidationError extends NAtlasError {
  constructor(message: string) {
    super(message, "validation_error", false);
  }
}

/** The server answered with a non-2xx HTTP status. */
export class NAtlasAPIError extends NAtlasError {
  readonly status: number;
  /** Parsed JSON error body when available, otherwise raw text. */
  readonly body: unknown;
  readonly headers?: Headers;

  constructor(
    message: string,
    status: number,
    body?: unknown,
    headers?: Headers,
    code = "api_error",
    retryable = false,
  ) {
    super(message, code, retryable);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

/** 401 / 403: missing or wrong API key. */
export class NAtlasAuthError extends NAtlasAPIError {
  constructor(message: string, status: number, body?: unknown, headers?: Headers) {
    super(message, status, body, headers, "auth_error", false);
  }
}

/** 429: too many requests. `retryAfterMs` is parsed from Retry-After if sent. */
export class NAtlasRateLimitError extends NAtlasAPIError {
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, body?: unknown, headers?: Headers, retryAfterMs?: number) {
    super(message, status, body, headers, "rate_limited", true);
    this.retryAfterMs = retryAfterMs;
  }
}

/** 503 from llama.cpp while weights are still loading into GPU memory. */
export class NAtlasModelLoadingError extends NAtlasAPIError {
  constructor(message: string, status: number, body?: unknown, headers?: Headers) {
    super(message, status, body, headers, "model_loading", true);
  }
}

/**
 * The endpoint cannot be reached: DNS failure, refused connection, or a
 * Cloudflare tunnel whose origin (the Kaggle/Colab notebook) is not running.
 */
export class NAtlasConnectionError extends NAtlasError {
  readonly status?: number;
  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, "connection_error", true, options);
    this.status = options?.status;
  }
}

/** The request exceeded `timeoutMs`. */
export class NAtlasTimeoutError extends NAtlasError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`, "timeout", true);
    this.timeoutMs = timeoutMs;
  }
}

/** The caller aborted the request via an AbortSignal. Never retried. */
export class NAtlasAbortError extends NAtlasError {
  constructor() {
    super("Request was aborted", "aborted", false);
  }
}

/** Status codes that Cloudflare returns when a tunnel's origin is down. */
const TUNNEL_DOWN_STATUSES = new Set([502, 521, 522, 523, 524, 530]);

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && typeof (err as Record<string, unknown>).message === "string") {
      return (err as Record<string, string>).message as string;
    }
    if (typeof b.message === "string") return b.message;
    if (typeof b.detail === "string") return b.detail;
  }
  if (typeof body === "string" && body.trim() && body.length < 300 && !body.trim().startsWith("<")) {
    return body.trim();
  }
  return fallback;
}

export function parseRetryAfter(headers?: Headers): number | undefined {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Map an HTTP error response to the most specific error class. */
export function errorFromResponse(status: number, body: unknown, headers?: Headers): NAtlasError {
  const message = extractMessage(body, `N-ATLaS endpoint returned HTTP ${status}`);
  if (status === 401 || status === 403) {
    return new NAtlasAuthError(message, status, body, headers);
  }
  if (status === 429) {
    return new NAtlasRateLimitError(message, status, body, headers, parseRetryAfter(headers));
  }
  if (status === 503 && /load/i.test(message)) {
    return new NAtlasModelLoadingError(message, status, body, headers);
  }
  if (TUNNEL_DOWN_STATUSES.has(status)) {
    return new NAtlasConnectionError(
      `N-ATLaS endpoint is offline (HTTP ${status}). The GPU notebook behind the tunnel is probably not running.`,
      { status },
    );
  }
  const retryable = status === 408 || status === 409 || status >= 500;
  return new NAtlasAPIError(message, status, body, headers, "api_error", retryable);
}
