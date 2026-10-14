"use client";

import { LANGUAGES, type ChatMessage, type LanguageCode } from "@olaxbonnke/natlas-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAT_SAMPLES } from "@/lib/samples";
import { friendlyError, natlas, type FriendlyError } from "@/lib/client";
import type { ChatSnippetInput } from "@/lib/snippets";
import LanguageSelect from "./LanguageSelect";

type Reply = "auto" | LanguageCode;

export default function ChatPanel({
  onSnippet,
  onEndpointProblem,
}: {
  onSnippet: (s: ChatSnippetInput) => void;
  onEndpointProblem: (kind: FriendlyError["kind"]) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [replyIn, setReplyIn] = useState<Reply>("auto");
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(512);
  const [sampleLang, setSampleLang] = useState<LanguageCode>("yo");
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pending = useMemo<ChatMessage[]>(
    () => (draft.trim() ? [...messages, { role: "user", content: draft.trim() }] : messages),
    [messages, draft],
  );

  useEffect(() => {
    onSnippet({
      kind: "chat",
      messages: pending.filter((m) => m.content),
      replyIn: replyIn === "auto" ? undefined : replyIn,
      temperature,
      maxTokens,
    });
  }, [pending, replyIn, temperature, maxTokens, onSnippet]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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

  const samples = CHAT_SAMPLES.filter((s) => s.lang === sampleLang);

  return (
    <section className="card flex min-h-[620px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <LanguageSelect<Reply>
          id="reply-in"
          label="Reply in"
          value={replyIn}
          onChange={setReplyIn}
          extra={{ value: "auto", label: "Same as my message" }}
        />
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <label className="flex items-center gap-2" title="Lower is more focused; the model card recommends low values.">
            <span className="font-medium">Temp</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-20 accent-naija-600"
            />
            <span className="w-8 tabular-nums">{temperature.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="font-medium">Max</span>
            <select className="select" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))}>
              {[128, 256, 512, 1024].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-ghost" onClick={() => setMessages([])} disabled={streaming || !messages.length}>
            Clear
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-xl py-6 text-center">
            <p className="text-lg font-semibold text-slate-900">Ẹ káàbọ̀ · Barka da zuwa · Nnọọ</p>
            <p className="mt-1 text-sm text-slate-500">
              Ask N-ATLaS anything in Yoruba, Hausa, Igbo or English, or start from a sample.
            </p>
            <div className="mt-5 flex justify-center gap-1.5">
              {(["yo", "ha", "ig", "en"] as LanguageCode[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setSampleLang(l)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    sampleLang === l ? "bg-naija-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {LANGUAGES[l].name}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-col items-stretch gap-2">
              {samples.map((s) => (
                <button key={s.prompt} type="button" className="chip justify-between" onClick={() => send(s.prompt)}>
                  <span>{s.prompt}</span>
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-naija-600">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  m.role === "user" ? "rounded-br-md bg-naija-600 text-white" : "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-900"
                }`}
              >
                {m.role === "assistant" ? (
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-naija-700">N-ATLaS</span>
                ) : null}
                {m.content}
                {streaming && i === messages.length - 1 && m.role === "assistant" ? (
                  <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-naija-600" />
                ) : null}
              </div>
            </div>
          ))
        )}
        {error ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <span>{error.message}</span>
            <button type="button" className="btn-ghost shrink-0 text-rose-800 hover:bg-rose-100" onClick={retry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="border-t border-slate-100 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            className="field min-h-[52px] resize-none"
            rows={2}
            value={draft}
            placeholder="Kọ ìbéèrè rẹ… / Rubuta tambayarka… / Dee ajụjụ gị… / Type your message…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label="Message"
          />
          {streaming ? (
            <button type="button" className="btn-primary bg-slate-800 hover:bg-slate-900" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">Enter to send · Shift+Enter for a new line · Every reply is generated by N-ATLaS.</p>
      </form>
    </section>
  );
}
