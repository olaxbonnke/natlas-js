"use client";
/**
 * React bindings for natlas-js.
 *
 *   import { useNatlas, useTranslate } from "@olaxbonnke/natlas-js/react";
 *
 * SSR-safe: nothing touches `window` and the client is created lazily on the
 * first `send()` / `translate()`, so rendering on the server never throws even
 * when `baseUrl` is only known in the browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NAtlas,
  NAtlasAbortError,
  NAtlasError,
  normalizeLanguage,
  type ChatMessage,
  type ChatOptions,
  type LanguageCode,
  type NAtlasOptions,
  type TranslateOptions,
  type TranslationResult,
} from "@olaxbonnke/natlas-js";

export type { ChatMessage, LanguageCode, TranslateOptions, TranslationResult } from "@olaxbonnke/natlas-js";

/** Options shared by both hooks: either pass a ready `client`, or the `NAtlas` constructor options. */
export interface NatlasClientOptions extends NAtlasOptions {
  /** Use an existing client instead of creating one from the options. */
  client?: NAtlas;
}

/** Per-call chat options accepted by the hook (the hook owns `signal`). */
export type HookChatOptions = Omit<ChatOptions, "signal">;

export interface UseNatlasOptions extends NatlasClientOptions {
  /** Messages to start the conversation with (e.g. restored from storage). */
  initialMessages?: ChatMessage[];
  /** Default chat options for every `send()` (temperature, maxTokens, system, ...). */
  chatOptions?: HookChatOptions;
  /** Default reply language for every `send()`. */
  replyIn?: LanguageCode;
  /** Called with each streamed chunk's delta and the text so far. */
  onToken?: (delta: string, text: string) => void;
  /** Called once the assistant reply is complete. */
  onFinish?: (message: ChatMessage) => void;
  /** Called when a request fails (not called for `stop()`). */
  onError?: (error: NAtlasError) => void;
}

export interface UseNatlasResult {
  /** The conversation (user + assistant turns). The last assistant message grows while streaming. */
  messages: ChatMessage[];
  /** Send a user message and stream the reply. Resolves with the reply text (partial if stopped), or `undefined` on error. */
  send: (text: string, options?: HookChatOptions) => Promise<string | undefined>;
  /** Translate text without touching the conversation. Resolves `undefined` on error or stop. */
  translate: (text: string, options: Omit<TranslateOptions, "signal">) => Promise<TranslationResult | undefined>;
  /** True from the moment a request starts until it settles. */
  isLoading: boolean;
  /** True once the first token has arrived and until the stream ends. */
  isStreaming: boolean;
  /** The last error, cleared on the next request. */
  error: NAtlasError | null;
  /** Abort the in-flight request. Text streamed so far is kept. */
  stop: () => void;
  /** Abort and restore `initialMessages`, clearing the error. */
  reset: () => void;
  /** Replace the conversation (e.g. to edit or trim history). */
  setMessages: (messages: ChatMessage[]) => void;
}

function toNatlasError(e: unknown): NAtlasError {
  if (e instanceof NAtlasError) return e;
  if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") return new NAtlasAbortError();
  const msg = e instanceof Error ? e.message : String(e);
  return new NAtlasError(msg, "natlas_error", false, { cause: e });
}

function isAbort(e: unknown): boolean {
  return e instanceof NAtlasAbortError || (!!e && typeof e === "object" && (e as { name?: string }).name === "AbortError");
}

function clientKey(o: NatlasClientOptions): string {
  return JSON.stringify([o.baseUrl, o.apiKey, o.model, o.timeoutMs, o.maxRetries, o.retryDelayMs, o.systemPrompt, o.defaultHeaders]);
}

/** Lazily create (and re-create when its options change) a `NAtlas` client. Never runs during render. */
function useLazyClient(options: NatlasClientOptions): () => NAtlas {
  const optsRef = useRef(options);
  optsRef.current = options;
  const cache = useRef<{ key: string; fetch?: unknown; client: NAtlas } | null>(null);
  return useCallback(() => {
    const o = optsRef.current;
    if (o.client) return o.client;
    const key = clientKey(o);
    const c = cache.current;
    if (c && c.key === key && c.fetch === o.fetch) return c.client;
    const { client: _ignored, ...ctor } = o;
    const client = new NAtlas({
      baseUrl: ctor.baseUrl,
      apiKey: ctor.apiKey,
      model: ctor.model,
      timeoutMs: ctor.timeoutMs,
      maxRetries: ctor.maxRetries,
      retryDelayMs: ctor.retryDelayMs,
      systemPrompt: ctor.systemPrompt,
      defaultHeaders: ctor.defaultHeaders,
      fetch: ctor.fetch,
    });
    cache.current = { key, fetch: o.fetch, client };
    return client;
  }, []);
}

/** Track mounted state and expose an abort-controller slot that is aborted on unmount. */
function useAbortSlot() {
  const ctl = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ctl.current?.abort();
    };
  }, []);
  const begin = useCallback(() => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    return c;
  }, []);
  const stop = useCallback(() => ctl.current?.abort(), []);
  return { ctl, mounted, begin, stop };
}

/**
 * Streaming chat with N-ATLaS as React state.
 *
 * @example
 * const { messages, send, isLoading, stop } = useNatlas({ baseUrl: "/api", replyIn: "yo" });
 */
export function useNatlas(options: UseNatlasOptions = {}): UseNatlasResult {
  const getClient = useLazyClient(options);
  const optsRef = useRef(options);
  optsRef.current = options;

  const initialRef = useRef<ChatMessage[]>(options.initialMessages ?? []);
  const [messages, setMessagesState] = useState<ChatMessage[]>(initialRef.current);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const [isLoading, setLoading] = useState(false);
  const [isStreaming, setStreaming] = useState(false);
  const [error, setError] = useState<NAtlasError | null>(null);
  const { ctl, mounted, begin, stop } = useAbortSlot();

  const setMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    if (mounted.current) setMessagesState(next);
  }, [mounted]);

  const fail = useCallback((e: unknown) => {
    const err = toNatlasError(e);
    if (mounted.current) setError(err);
    optsRef.current.onError?.(err);
  }, [mounted]);

  const settle = useCallback((c: AbortController) => {
    if (ctl.current === c) {
      ctl.current = null;
      if (mounted.current) {
        setLoading(false);
        setStreaming(false);
      }
    }
  }, [ctl, mounted]);

  const send = useCallback<UseNatlasResult["send"]>(async (text, callOptions) => {
    const content = typeof text === "string" ? text.trim() : "";
    if (!content) return undefined;
    const c = begin();
    setError(null);
    setLoading(true);
    setStreaming(false);

    const history: ChatMessage[] = [...messagesRef.current, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    const o = optsRef.current;
    const chatOpts: ChatOptions = { replyIn: o.replyIn, ...o.chatOptions, ...callOptions, signal: c.signal };

    let reply = "";
    const write = (t: string) => {
      if (ctl.current !== c) return; // superseded by a newer send/reset
      reply = t;
      setMessages([...history, { role: "assistant", content: t }]);
    };
    try {
      const client = getClient();
      for await (const chunk of client.chatStream(history, chatOpts)) {
        if (ctl.current !== c) break;
        if (mounted.current) setStreaming(true);
        write(chunk.text);
        if (chunk.delta) optsRef.current.onToken?.(chunk.delta, chunk.text);
      }
      if (ctl.current === c) optsRef.current.onFinish?.({ role: "assistant", content: reply });
      return reply;
    } catch (e) {
      if (isAbort(e)) return reply;
      // Drop the empty assistant placeholder but keep the user's turn so they can retry.
      if (ctl.current === c && !reply) setMessages(history);
      fail(e);
      return undefined;
    } finally {
      settle(c);
    }
  }, [begin, ctl, fail, getClient, mounted, setMessages, settle]);

  const translate = useCallback<UseNatlasResult["translate"]>(async (text, tOptions) => {
    const c = begin();
    setError(null);
    setLoading(true);
    setStreaming(false);
    try {
      return await getClient().translate(text, { ...tOptions, signal: c.signal });
    } catch (e) {
      if (!isAbort(e)) fail(e);
      return undefined;
    } finally {
      settle(c);
    }
  }, [begin, fail, getClient, settle]);

  const reset = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setMessages(initialRef.current);
    setError(null);
    setLoading(false);
    setStreaming(false);
  }, [ctl, setMessages]);

  return { messages, send, translate, isLoading, isStreaming, error, stop, reset, setMessages };
}

export interface UseTranslateOptions extends NatlasClientOptions {
  /** Stream the translation so `translation` fills in token by token. Default false. */
  stream?: boolean;
  /** Default translate options (from, to, domain, tone, ...). */
  defaults?: Partial<Omit<TranslateOptions, "signal">>;
}

export interface UseTranslateResult {
  /** The latest translation text (partial while streaming). */
  translation: string;
  /** The full result of the last completed translation. */
  result: TranslationResult | null;
  translate: (text: string, options?: Partial<Omit<TranslateOptions, "signal">>) => Promise<TranslationResult | undefined>;
  isLoading: boolean;
  error: NAtlasError | null;
  stop: () => void;
  reset: () => void;
}

/**
 * Translation as React state.
 *
 * @example
 * const { translation, translate, isLoading } = useTranslate({ baseUrl: "/api", defaults: { to: "ha" } });
 */
export function useTranslate(options: UseTranslateOptions = {}): UseTranslateResult {
  const getClient = useLazyClient(options);
  const optsRef = useRef(options);
  optsRef.current = options;
  const [translation, setTranslation] = useState("");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<NAtlasError | null>(null);
  const { ctl, mounted, begin, stop } = useAbortSlot();

  const translate = useCallback<UseTranslateResult["translate"]>(async (text, callOptions) => {
    const c = begin();
    const o = optsRef.current;
    const merged = { ...o.defaults, ...callOptions, signal: c.signal } as TranslateOptions;
    const live = () => ctl.current === c && mounted.current;
    setError(null);
    setLoading(true);
    setTranslation("");
    try {
      const client = getClient();
      let res: TranslationResult;
      if (o.stream) {
        const gen = client.translateStream(text, merged);
        let step = await gen.next();
        while (!step.done) {
          if (live()) setTranslation(step.value.text);
          step = await gen.next();
        }
        const from = !merged.from || merged.from === "auto" ? "auto" : normalizeLanguage(String(merged.from)) ?? "auto";
        const to = normalizeLanguage(String(merged.to)) ?? (merged.to as LanguageCode);
        res = { text: step.value, from, to, raw: null };
      } else {
        res = await client.translate(text, merged);
      }
      if (live()) {
        setTranslation(res.text);
        setResult(res);
      }
      return res;
    } catch (e) {
      if (!isAbort(e) && live()) setError(toNatlasError(e));
      return undefined;
    } finally {
      if (ctl.current === c) {
        ctl.current = null;
        if (mounted.current) setLoading(false);
      }
    }
  }, [begin, ctl, getClient, mounted]);

  const reset = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setTranslation("");
    setResult(null);
    setError(null);
    setLoading(false);
  }, [ctl]);

  return { translation, result, translate, isLoading, error, stop, reset };
}
