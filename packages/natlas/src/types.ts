import type { LanguageCode } from "./languages.js";

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/** `fetch`-compatible function. Lets you inject undici, a mock, or a proxy. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NAtlasOptions {
  /**
   * Base URL of an OpenAI-compatible N-ATLaS server, e.g.
   * `https://random-words.trycloudflare.com` (with or without `/v1`).
   * Relative URLs such as `/api` work in the browser.
   * Defaults to `process.env.NATLAS_BASE_URL` when available.
   */
  baseUrl?: string;
  /** Bearer token if the server was started with `--api-key`. Defaults to `process.env.NATLAS_API_KEY`. */
  apiKey?: string;
  /** Model name sent in the request body. llama.cpp ignores it; default `"n-atlas"`. */
  model?: string;
  /** Per-attempt timeout in milliseconds. Default 120000 (an 8B model on a T4 is not instant). */
  timeoutMs?: number;
  /** Retries for connection errors, timeouts, 408/429/5xx. Default 2. */
  maxRetries?: number;
  /** Base back-off delay in ms (exponential with jitter). Default 500. */
  retryDelayMs?: number;
  /** System prompt used by `chat()` when the conversation has none. */
  systemPrompt?: string;
  /** Extra headers sent with every request. */
  defaultHeaders?: Record<string, string>;
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}

export interface ChatOptions {
  /** Sampling temperature. The model card recommends low values (0.1-0.3) for factual answers. */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  topP?: number;
  /** llama.cpp `repeat_penalty`. The model card uses 1.12. */
  repetitionPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  seed?: number;
  /** Override the system prompt for this call (ignored if `messages` already has one). */
  system?: string;
  /** Ask the model to answer in this language (adds an instruction to the system prompt). */
  replyIn?: LanguageCode;
  /** Abort the request. */
  signal?: AbortSignal;
  /** Override client timeout for this call. */
  timeoutMs?: number;
  /** Extra JSON fields merged into the request body (server-specific knobs). */
  extraBody?: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  /** The assistant's reply text. */
  content: string;
  finishReason: string | null;
  usage?: Usage;
  model?: string;
  id?: string;
  /** Raw JSON from the server. */
  raw: unknown;
}

export interface ChatChunk {
  /** New text in this chunk (may be empty). */
  delta: string;
  /** Concatenated text so far. */
  text: string;
  finishReason: string | null;
  /** Raw parsed SSE JSON payload. */
  raw: unknown;
}

export interface TranslateOptions extends Omit<ChatOptions, "system" | "replyIn"> {
  /** Source language, or `"auto"` to let the model detect it. Default `"auto"`. */
  from?: LanguageCode | "auto" | string;
  /** Target language (required). */
  to: LanguageCode | string;
  /** Optional domain hint, e.g. "health", "agriculture", "legal". */
  domain?: string;
  /** Formality / style hint, e.g. "formal", "conversational". */
  tone?: string;
}

export interface TranslationResult {
  text: string;
  from: LanguageCode | "auto";
  to: LanguageCode;
  raw: unknown;
}

export type HealthStatus = "online" | "loading" | "offline" | "unauthorized";

export interface HealthResult {
  status: HealthStatus;
  ok: boolean;
  latencyMs: number;
  /** HTTP status of the probe, if any response came back. */
  httpStatus?: number;
  detail?: string;
}
