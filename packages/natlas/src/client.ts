import {
  NAtlasAbortError,
  NAtlasAPIError,
  NAtlasConnectionError,
  NAtlasError,
  NAtlasRateLimitError,
  NAtlasTimeoutError,
  NAtlasValidationError,
  errorFromResponse,
} from "./errors.js";
import { LANGUAGES, normalizeLanguage, detectLanguage, type LanguageCode } from "./languages.js";
import {
  DEFAULT_SYSTEM_PROMPT,
  buildTranslationMessages,
  cleanTranslation,
  replyInInstruction,
} from "./prompts.js";
import { parseSSE } from "./sse.js";
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResult,
  FetchLike,
  HealthResult,
  NAtlasOptions,
  TranslateOptions,
  TranslationResult,
  Usage,
} from "./types.js";

export const VERSION = "0.1.0";

const DEFAULT_MODEL = "n-atlas";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
/** Repetition penalty used in the official N-ATLaS model card example. */
const DEFAULT_REPETITION_PENALTY = 1.12;
const VALID_ROLES = new Set(["system", "user", "assistant"]);

function env(name: string): string | undefined {
  try {
    const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const v = p?.env?.[name];
    return v && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Strip whitespace, trailing slashes and a trailing `/v1` so paths can be appended. */
export function normalizeBaseUrl(url: string): string {
  let u = url.trim();
  while (u.endsWith("/")) u = u.slice(0, -1);
  if (u.toLowerCase().endsWith("/v1")) u = u.slice(0, -3);
  while (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new NAtlasAbortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new NAtlasAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

function mapUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const r = u as Record<string, number>;
  return {
    promptTokens: r.prompt_tokens ?? 0,
    completionTokens: r.completion_tokens ?? 0,
    totalTokens: r.total_tokens ?? (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
  };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Per-attempt abort controller that merges a user signal with a (resettable) timeout. */
class AttemptController {
  readonly controller = new AbortController();
  timedOut = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly onUserAbort = () => this.controller.abort();

  constructor(
    private readonly timeoutMs: number,
    private readonly userSignal?: AbortSignal,
  ) {
    if (userSignal?.aborted) this.controller.abort();
    userSignal?.addEventListener("abort", this.onUserAbort, { once: true });
    this.reset();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.timeoutMs > 0 && Number.isFinite(this.timeoutMs)) {
      this.timer = setTimeout(() => {
        this.timedOut = true;
        this.controller.abort();
      }, this.timeoutMs);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.userSignal?.removeEventListener("abort", this.onUserAbort);
  }

  /** Translate a low-level fetch/read failure into a typed error. */
  toError(err: unknown, url: string): NAtlasError {
    if (err instanceof NAtlasError) return err;
    if (this.timedOut) return new NAtlasTimeoutError(this.timeoutMs);
    if (this.userSignal?.aborted) return new NAtlasAbortError();
    const msg = err instanceof Error ? err.message : String(err);
    return new NAtlasConnectionError(`Could not reach N-ATLaS endpoint at ${url}: ${msg}`, { cause: err });
  }
}

/**
 * Client for an OpenAI-compatible N-ATLaS server (llama.cpp `llama-server`,
 * llama-cpp-python, vLLM, ...). Zero dependencies: uses the platform `fetch`.
 *
 * @example
 * const natlas = new NAtlas({ baseUrl: "https://xyz.trycloudflare.com" });
 * const { content } = await natlas.chat("Báwo ni?");
 */
export class NAtlas {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly systemPrompt: string;
  /** The four languages N-ATLaS supports. */
  readonly languages = LANGUAGES;
  private readonly apiKey?: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: NAtlasOptions = {}) {
    const baseUrl = options.baseUrl ?? env("NATLAS_BASE_URL");
    if (!baseUrl || !baseUrl.trim()) {
      throw new NAtlasValidationError(
        "Missing baseUrl. Pass { baseUrl } or set NATLAS_BASE_URL to your N-ATLaS server (e.g. https://xyz.trycloudflare.com).",
      );
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = options.apiKey ?? env("NATLAS_API_KEY");
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.defaultHeaders = options.defaultHeaders ?? {};
    const f = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new NAtlasValidationError("No fetch implementation found. Use Node 18+ or pass { fetch }.");
    }
    this.fetchImpl = (input, init) => f(input, init);
  }

  /** Full URL for an API path, e.g. `url("/v1/chat/completions")`. */
  url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json, text/event-stream", ...this.defaultHeaders };
    if (json) h["Content-Type"] = "application/json";
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private backoff(attempt: number, err: NAtlasError): number {
    if (err instanceof NAtlasRateLimitError && err.retryAfterMs !== undefined) {
      return Math.min(err.retryAfterMs, MAX_RETRY_DELAY_MS * 4);
    }
    const exp = this.retryDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.retryDelayMs;
    return Math.min(exp + jitter, MAX_RETRY_DELAY_MS);
  }

  /**
   * Low-level request with timeout and retries. Resolves with an OK Response
   * plus the attempt controller (so streaming can keep resetting the idle timer).
   */
  private async send(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
    opts: { signal?: AbortSignal; timeoutMs?: number; maxRetries?: number } = {},
  ): Promise<{ res: Response; ctl: AttemptController }> {
    const url = this.url(path);
    const retries = opts.maxRetries ?? this.maxRetries;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let lastErr: NAtlasError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new NAtlasAbortError();
      const ctl = new AttemptController(timeoutMs, opts.signal);
      try {
        const res = await this.fetchImpl(url, {
          method: init.method,
          headers: this.headers(init.body !== undefined),
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: ctl.signal,
        });
        if (res.ok) return { res, ctl };
        const body = await readBody(res);
        ctl.dispose();
        throw errorFromResponse(res.status, body, res.headers);
      } catch (e) {
        ctl.dispose();
        const err = ctl.toError(e, url);
        if (err instanceof NAtlasAbortError || !err.retryable || attempt === retries) throw err;
        lastErr = err;
        await sleep(this.backoff(attempt, err), opts.signal);
      }
    }
    /* istanbul ignore next */
    throw lastErr ?? new NAtlasError("Request failed");
  }

  /** Normalise input into a validated message list with a system prompt. */
  buildMessages(input: string | ChatMessage[], opts: ChatOptions = {}): ChatMessage[] {
    const list: ChatMessage[] =
      typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? [...input] : [];
    if (list.length === 0) throw new NAtlasValidationError("messages must be a non-empty string or array");
    for (const [i, m] of list.entries()) {
      if (!m || typeof m !== "object" || !VALID_ROLES.has(m.role) || typeof m.content !== "string") {
        throw new NAtlasValidationError(
          `messages[${i}] must be { role: "system" | "user" | "assistant", content: string }`,
        );
      }
    }
    if (typeof input === "string" && !input.trim()) {
      throw new NAtlasValidationError("message text must not be empty");
    }
    if (opts.replyIn !== undefined && !LANGUAGES[opts.replyIn as LanguageCode]) {
      throw new NAtlasValidationError(`Unsupported replyIn language "${String(opts.replyIn)}"`);
    }
    const first = list[0];
    if (first && first.role === "system") {
      if (opts.replyIn) {
        list[0] = { role: "system", content: `${first.content}\n${replyInInstruction(opts.replyIn)}` };
      }
      return list;
    }
    let system = opts.system ?? this.systemPrompt;
    if (opts.replyIn) {
      system = `${system}\n${replyInInstruction(opts.replyIn)}`;
    } else {
      // Auto: answer in the language of the user's latest message.
      const lastUser = [...list].reverse().find((m) => m.role === "user");
      const detected = lastUser ? detectLanguage(lastUser.content) : "en";
      system =
        detected === "en"
          ? `${system}\nReply in the same language as the user's latest message.`
          : `${system}\nThe user is writing in ${LANGUAGES[detected].name}. ${replyInInstruction(detected)}`;
    }
    return [{ role: "system", content: system }, ...list];
  }

  /** The exact JSON body that will be POSTed to `/v1/chat/completions`. */
  buildRequestBody(messages: ChatMessage[], opts: ChatOptions, stream: boolean): Record<string, unknown> {
    return compact({
      model: this.model,
      messages,
      stream,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      top_p: opts.topP,
      repeat_penalty: opts.repetitionPenalty ?? DEFAULT_REPETITION_PENALTY,
      frequency_penalty: opts.frequencyPenalty,
      presence_penalty: opts.presencePenalty,
      stop: opts.stop,
      seed: opts.seed,
      ...(opts.extraBody ?? {}),
    });
  }

  /**
   * Send a chat completion and wait for the full reply.
   * @param input a user message string, or an OpenAI-style message array.
   */
  async chat(input: string | ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const messages = this.buildMessages(input, opts);
    const body = this.buildRequestBody(messages, opts, false);
    const { res, ctl } = await this.send(
      "/v1/chat/completions",
      { method: "POST", body },
      { signal: opts.signal, timeoutMs: opts.timeoutMs },
    );
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch (e) {
      if (ctl.timedOut || opts.signal?.aborted) throw ctl.toError(e, this.url("/v1/chat/completions"));
      throw new NAtlasAPIError("N-ATLaS endpoint returned invalid JSON", res.status);
    } finally {
      ctl.dispose();
    }
    const choice = (json.choices as Array<Record<string, any>> | undefined)?.[0];
    if (!choice) throw new NAtlasAPIError("N-ATLaS response had no choices", res.status, json);
    return {
      content: String(choice.message?.content ?? choice.text ?? ""),
      finishReason: choice.finish_reason ?? null,
      usage: mapUsage(json.usage),
      model: typeof json.model === "string" ? json.model : undefined,
      id: typeof json.id === "string" ? json.id : undefined,
      raw: json,
    };
  }

  /**
   * Stream a chat completion token-by-token as an async iterator.
   *
   * @example
   * for await (const chunk of natlas.chatStream("Sannu!")) process.stdout.write(chunk.delta);
   */
  async *chatStream(input: string | ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<ChatChunk, string> {
    const messages = this.buildMessages(input, opts);
    const body = this.buildRequestBody(messages, opts, true);
    const url = this.url("/v1/chat/completions");
    const { res, ctl } = await this.send(
      "/v1/chat/completions",
      { method: "POST", body },
      { signal: opts.signal, timeoutMs: opts.timeoutMs },
    );
    let text = "";
    try {
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.body || contentType.includes("application/json")) {
        // Server ignored stream=true: emit the whole reply as one chunk.
        const json = (await res.json()) as Record<string, any>;
        const choice = json.choices?.[0];
        text = String(choice?.message?.content ?? "");
        yield { delta: text, text, finishReason: choice?.finish_reason ?? "stop", raw: json };
        return text;
      }
      for await (const evt of parseSSE(res.body, ctl.signal)) {
        ctl.reset(); // idle timeout: restart on every event
        const data = evt.data.trim();
        if (!data) continue;
        if (data === "[DONE]") break;
        let json: Record<string, any>;
        try {
          json = JSON.parse(data);
        } catch {
          continue; // ignore non-JSON keep-alives
        }
        if (json.error) {
          const msg = typeof json.error === "string" ? json.error : json.error.message ?? "Stream error";
          throw new NAtlasAPIError(msg, Number(json.error.code) || 500, json);
        }
        const choice = json.choices?.[0];
        const delta: string = choice?.delta?.content ?? choice?.text ?? "";
        const finishReason: string | null = choice?.finish_reason ?? null;
        if (!delta && !finishReason) continue;
        text += delta;
        yield { delta, text, finishReason, raw: json };
      }
      if (opts.signal?.aborted) throw new NAtlasAbortError();
      if (ctl.timedOut) throw new NAtlasTimeoutError(opts.timeoutMs ?? this.timeoutMs);
      return text;
    } catch (e) {
      throw ctl.toError(e, url);
    } finally {
      ctl.dispose();
    }
  }

  private resolveTranslation(text: string, opts: TranslateOptions): { from: LanguageCode | "auto"; to: LanguageCode } {
    if (typeof text !== "string" || !text.trim()) {
      throw new NAtlasValidationError("text to translate must be a non-empty string");
    }
    if (!opts || opts.to === undefined) throw new NAtlasValidationError('translate() requires a target language: { to: "yo" }');
    const to = normalizeLanguage(String(opts.to));
    if (!to) throw new NAtlasValidationError(`Unsupported target language "${String(opts.to)}". Use en, yo, ha or ig.`);
    const rawFrom = opts.from ?? "auto";
    const from = rawFrom === "auto" ? "auto" : normalizeLanguage(String(rawFrom));
    if (!from) throw new NAtlasValidationError(`Unsupported source language "${String(rawFrom)}". Use en, yo, ha, ig or auto.`);
    return { from, to };
  }

  private translationChatOptions(text: string, opts: TranslateOptions): ChatOptions {
    const { from: _f, to: _t, domain: _d, tone: _tone, ...rest } = opts;
    return {
      temperature: 0.1,
      maxTokens: Math.min(2048, Math.max(256, Math.ceil(text.length * 1.5))),
      ...rest,
    };
  }

  /**
   * Translate between English, Yoruba, Hausa and Igbo.
   *
   * @example
   * const { text } = await natlas.translate("Good morning, mother", { from: "en", to: "yo" });
   */
  async translate(text: string, opts: TranslateOptions): Promise<TranslationResult> {
    const { from, to } = this.resolveTranslation(text, opts);
    if (from === to) return { text, from, to, raw: null };
    const messages = buildTranslationMessages({ text, from, to, domain: opts.domain, tone: opts.tone });
    const result = await this.chat(messages, this.translationChatOptions(text, opts));
    return { text: cleanTranslation(result.content), from, to, raw: result.raw };
  }

  /** Streaming variant of {@link translate}. Chunks carry raw (uncleaned) model output. */
  async *translateStream(text: string, opts: TranslateOptions): AsyncGenerator<ChatChunk, string> {
    const { from, to } = this.resolveTranslation(text, opts);
    if (from === to) {
      yield { delta: text, text, finishReason: "stop", raw: null };
      return text;
    }
    const messages = buildTranslationMessages({ text, from, to, domain: opts.domain, tone: opts.tone });
    const full = yield* this.chatStream(messages, this.translationChatOptions(text, opts));
    return cleanTranslation(full);
  }

  /** List models exposed by the server (`GET /v1/models`). */
  async models(opts: { signal?: AbortSignal } = {}): Promise<Array<{ id: string; [k: string]: unknown }>> {
    const { res, ctl } = await this.send("/v1/models", { method: "GET" }, { signal: opts.signal, timeoutMs: 15_000 });
    try {
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      return json.data ?? [];
    } finally {
      ctl.dispose();
    }
  }

  /**
   * Probe the server without throwing. Tries llama.cpp's `/health`, then falls
   * back to `/v1/models` (llama-cpp-python has no /health route).
   */
  async health(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<HealthResult> {
    const started = Date.now();
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const probe = async (path: string) => this.send(path, { method: "GET" }, { ...opts, timeoutMs, maxRetries: 0 });
    const done = (r: Omit<HealthResult, "latencyMs" | "ok">): HealthResult => ({
      ...r,
      ok: r.status === "online",
      latencyMs: Date.now() - started,
    });
    for (const path of ["/health", "/v1/models"]) {
      try {
        const { res, ctl } = await probe(path);
        ctl.dispose();
        return done({ status: "online", httpStatus: res.status });
      } catch (e) {
        if (e instanceof NAtlasAbortError) throw e;
        if (e instanceof NAtlasAPIError) {
          if (e.code === "model_loading") return done({ status: "loading", httpStatus: e.status, detail: e.message });
          if (e.code === "auth_error") return done({ status: "unauthorized", httpStatus: e.status, detail: e.message });
          if (e.status === 404 && path === "/health") continue;
          return done({ status: "offline", httpStatus: e.status, detail: e.message });
        }
        const err = e as NAtlasError & { status?: number };
        return done({ status: "offline", httpStatus: err.status, detail: err.message });
      }
    }
    return done({ status: "offline", detail: "No health endpoint responded" });
  }
}
