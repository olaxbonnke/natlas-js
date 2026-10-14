"use client";

import { LANGUAGES, type ChatMessage, type LanguageCode } from "@olaxbonnke/natlas-js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHAT_SAMPLES } from "@/lib/samples";
import { friendlyError, natlas, type FriendlyError } from "@/lib/client";
import type { ChatSnippetInput } from "@/lib/snippets";
import LanguageSelect from "./LanguageSelect";
import { ArrowUp, Chevron, Sliders, Stop } from "./icons";

type Reply = "auto" | LanguageCode;

const SAMPLE_LANGS: LanguageCode[] = ["yo", "ha", "ig", "en"];

export default function ChatPanel({
  onSnippet,
  onEndpointProblem,
  active = true,
}: {
  onSnippet: (s: ChatSnippetInput) => void;
  onEndpointProblem: (kind: FriendlyError["kind"]) => void;
  active?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [replyIn, setReplyIn] = useState<Reply>("auto");
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(512);
  const [sampleLang, setSampleLang] = useState<LanguageCode>("yo");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const pending = useMemo<ChatMessage[]>(
    () => (draft.trim() ? [...messages, { role: "user", content: draft.trim() }] : messages),
    [messages, draft],
  );

  useEffect(() => {
    if (!active) return;
    onSnippet({
      kind: "chat",
      messages: pending.filter((m) => m.content),
      replyIn: replyIn === "auto" ? undefined : replyIn,
      temperature,
      maxTokens,
    });
  }, [active, pending, replyIn, temperature, maxTokens, onSnippet]);

  // Keep the newest message in view: the list scrolls on desktop, the page scrolls on phones.
  useEffect(() => {
    if (!messages.length) return;
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    if (desktop) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, error]);

  // Auto-grow the composer without layout jumps.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSettingsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  async function send(text?: string, base: ChatMessage[] = messages) {
    const content = (text ?? draft).trim();
    if (!content || streaming) return;
    const history: ChatMessage[] = [...base, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for await (const chunk of natlas.chatStream(history, {
        replyIn: replyIn === "auto" ? undefined : replyIn,
        temperature,
        maxTokens,
        signal: ac.signal,
      })) {
        setMessages([...history, { role: "assistant", content: chunk.text }]);
      }
    } catch (e) {
      const fe = friendlyError(e);
      if (fe.kind !== "aborted") {
        setError(fe);
        onEndpointProblem(fe.kind);
        // drop the empty assistant bubble so the user can retry cleanly
        setMessages((m) => (m.at(-1)?.role === "assistant" && !m.at(-1)?.content ? m.slice(0, -1) : m));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function retry() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const idx = messages.lastIndexOf(lastUser);
    void send(lastUser.content, messages.slice(0, idx));
  }

  function clear() {
    setMessages([]);
    setError(null);
    setSettingsOpen(false);
  }

  const samples = CHAT_SAMPLES.filter((s) => s.lang === sampleLang);
  const soft = error && (error.kind === "offline" || error.kind === "loading" || error.kind === "config" || error.kind === "rate");

  return (
    <section className="panel flex min-h-[calc(100dvh-230px)] flex-col lg:h-[max(560px,calc(100dvh-300px))]">
      {/* Toolbar */}
      <div className="hairline relative flex items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
        <LanguageSelect<Reply>
          id="reply-in"
          label="Reply in"
          value={replyIn}
          onChange={setReplyIn}
          extra={{ value: "auto", label: "Auto" }}
          className="min-w-0"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {messages.length ? (
            <button type="button" className="btn-ghost animate-fade" onClick={clear} disabled={streaming}>
              New chat
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost !min-h-[40px] !px-3"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            aria-controls="chat-settings"
            aria-label="Generation settings"
          >
            <Sliders />
            <span className="hidden tabular-nums sm:inline">
              {temperature.toFixed(2)} · {maxTokens}
            </span>
          </button>
        </div>

        {settingsOpen ? (
          <>
            <div
              className="animate-fade fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] sm:bg-transparent sm:backdrop-blur-0"
              onClick={() => setSettingsOpen(false)}
              aria-hidden
            />
            <div
              id="chat-settings"
              role="dialog"
              aria-label="Generation settings"
              className="glass animate-sheet pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] border border-[var(--glass-border)] px-5 pt-3 shadow-2xl sm:animate-rise sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-[calc(100%+8px)] sm:w-80 sm:rounded-[22px] sm:pb-4 sm:pt-4"
              style={{ background: "var(--glass-strong)" }}
            >
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--fill-strong)] sm:hidden" aria-hidden />
              <p className="text-[15px] font-semibold tracking-tight">Generation</p>
              <p className="text-muted mt-0.5 text-[13px]">The defaults suit most prompts.</p>

              <label className="mt-4 block" title="Lower is more focused; the model card recommends low values.">
                <span className="flex items-baseline justify-between text-[14px]">
                  <span className="font-medium">Temperature</span>
                  <span className="text-muted tabular-nums">{temperature.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="range mt-3"
                  style={{ ["--pct" as string]: `${temperature * 100}%` }}
                />
                <span className="text-subtle mt-1.5 flex justify-between text-[11.5px]">
                  <span>Focused</span>
                  <span>Creative</span>
                </span>
              </label>

              <div className="mt-4">
                <span className="text-[14px] font-medium">Max tokens</span>
                <div className="segmented mt-2 grid w-full grid-cols-4" role="radiogroup" aria-label="Max tokens">
                  <span
                    className="segmented-thumb"
                    style={{
                      width: "calc((100% - 8px) / 4)",
                      left: 4,
                      transform: `translateX(${[128, 256, 512, 1024].indexOf(maxTokens) * 100}%)`,
                    }}
                    aria-hidden
                  />
                  {[128, 256, 512, 1024].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={maxTokens === n}
                      aria-selected={maxTokens === n}
                      onClick={() => setMaxTokens(n)}
                      className="!px-0 tabular-nums"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  className="btn-ghost flex-1 !min-h-[44px]"
                  onClick={() => {
                    setTemperature(0.3);
                    setMaxTokens(512);
                  }}
                >
                  Reset
                </button>
                <button type="button" className="btn-primary flex-1" onClick={() => setSettingsOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Conversation */}
      <div
        ref={listRef}
        className="flex-1 space-y-3.5 px-3 py-5 pb-28 sm:px-5 lg:overflow-y-auto lg:pb-5"
        aria-live="polite"
        aria-busy={streaming}
      >
        {messages.length === 0 ? (
          <div className="animate-rise mx-auto max-w-2xl pt-2 sm:pt-6">
            <div className="text-center">
              <p className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">
                Ẹ káàbọ̀ · Barka · Nnọọ
              </p>
              <p className="text-muted mt-2 text-[15px]">Tap a prompt and N-ATLaS replies, or type your own below.</p>
            </div>

            <div className="mt-6 flex justify-center">
              <div className="segmented grid grid-cols-4" role="tablist" aria-label="Sample language">
                <span
                  className="segmented-thumb"
                  style={{
                    width: "calc((100% - 8px) / 4)",
                    left: 4,
                    transform: `translateX(${SAMPLE_LANGS.indexOf(sampleLang) * 100}%)`,
                  }}
                  aria-hidden
                />
                {SAMPLE_LANGS.map((l) => (
                  <button key={l} type="button" role="tab" aria-selected={sampleLang === l} onClick={() => setSampleLang(l)} className="!px-3 sm:!px-4">
                    {LANGUAGES[l].name}
                  </button>
                ))}
              </div>
            </div>

            <div key={sampleLang} className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
              {samples.map((s, i) => (
                <button
                  key={s.prompt}
                  type="button"
                  className={`chip animate-rise group min-h-[64px] w-full justify-between !rounded-[18px] !px-4 !py-3.5 ${
                    samples.length % 2 === 1 && i === samples.length - 1 ? "sm:col-span-2" : ""
                  }`}
                  style={{ animationDelay: `${i * 45}ms` }}
                  onClick={() => send(s.prompt)}
                  disabled={streaming}
                >
                  <span className="min-w-0">
                    <span className="text-accent block text-[11px] font-semibold uppercase tracking-[0.08em]">{s.label}</span>
                    <span className="mt-0.5 block text-[15px] leading-snug">{s.prompt}</span>
                  </span>
                  <span className="text-subtle grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--fill)] transition group-hover:bg-[var(--accent)] group-hover:text-white">
                    <Chevron />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const thinking = streaming && isLast && m.role === "assistant" && !m.content;
            return (
              <div key={i} className={`animate-rise flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] whitespace-pre-wrap break-words rounded-[22px] px-4 py-2.5 text-[15.5px] leading-relaxed sm:max-w-[80%] ${
                    m.role === "user"
                      ? "rounded-br-[8px] bg-gradient-to-b from-[#13a066] to-[#008751] text-white shadow-[0_6px_16px_-8px_rgba(0,135,81,0.6)]"
                      : "hairline rounded-bl-[8px] border bg-[var(--bubble-ai)]"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <span className="text-accent mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.08em]">N-ATLaS</span>
                  ) : null}
                  {thinking ? (
                    <span className="flex h-6 items-center gap-1" aria-label="N-ATLaS is thinking">
                      {[0, 1, 2].map((d) => (
                        <span
                          key={d}
                          className="h-2 w-2 animate-bounce rounded-full bg-[var(--subtle)]"
                          style={{ animationDelay: `${d * 140}ms` }}
                        />
                      ))}
                    </span>
                  ) : (
                    m.content
                  )}
                  {streaming && isLast && m.role === "assistant" && m.content ? <span className="caret" aria-hidden /> : null}
                </div>
              </div>
            );
          })
        )}
        {error ? (
          <div
            className={`animate-rise flex items-start justify-between gap-3 rounded-[18px] border px-4 py-3 text-[14px] ${
              soft
                ? "border-amber-300/50 bg-amber-100/60 text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
                : "border-rose-300/50 bg-rose-100/60 text-rose-950 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100"
            }`}
          >
            <span className="leading-relaxed">{error.message}</span>
            <button type="button" className="btn-ghost shrink-0" onClick={retry}>
              Retry
            </button>
          </div>
        ) : null}
        <div ref={endRef} className="h-px scroll-mb-28" aria-hidden />
      </div>

      {/* Composer: pinned to the bottom on phones, docked in the card on desktop */}
      <form
        className="hairline glass pb-safe fixed inset-x-0 bottom-0 z-30 border-t px-3 pt-3 lg:static lg:z-auto lg:rounded-b-[24px] lg:bg-transparent lg:px-4 lg:pb-4 lg:backdrop-blur-0"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[26px] border border-[var(--hairline)] bg-[var(--field)] p-1.5 pl-4 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.15)] transition focus-within:border-[color-mix(in_srgb,var(--accent)_55%,transparent)] focus-within:shadow-[0_0_0_4px_var(--accent-soft)] lg:max-w-none">
          <textarea
            ref={inputRef}
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-6 placeholder:text-[var(--subtle)] focus:outline-none sm:text-[15.5px]"
            rows={1}
            value={draft}
            placeholder="Message N-ATLaS in any language…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label="Message"
            enterKeyHint="send"
          />
          {streaming ? (
            <button
              type="button"
              className="press focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--fg)] text-[var(--bg)]"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop generating"
            >
              <Stop />
            </button>
          ) : (
            <button
              type="submit"
              className="btn-primary h-11 w-11 shrink-0 !rounded-full !p-0"
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <ArrowUp />
            </button>
          )}
        </div>
        <p className="text-subtle mt-2 hidden text-center text-[11.5px] sm:block">
          Enter to send · Shift+Enter for a new line · Every reply is generated by N-ATLaS
        </p>
      </form>
    </section>
  );
}
