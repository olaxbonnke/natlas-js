"use client";

import { LANGUAGES, cleanTranslation, type LanguageCode } from "@olaxbonnke/natlas-js";
import { useEffect, useRef, useState } from "react";
import { TRANSLATE_SAMPLES } from "@/lib/samples";
import { friendlyError, natlas, type FriendlyError } from "@/lib/client";
import type { TranslateSnippetInput } from "@/lib/snippets";
import LanguageSelect from "./LanguageSelect";
import { Copy, Stop, Swap } from "./icons";

type From = "auto" | LanguageCode;

export default function TranslatePanel({
  onSnippet,
  onEndpointProblem,
  active = true,
}: {
  onSnippet: (s: TranslateSnippetInput) => void;
  onEndpointProblem: (kind: FriendlyError["kind"]) => void;
  active?: boolean;
}) {
  const [from, setFrom] = useState<From>("en");
  const [to, setTo] = useState<LanguageCode>("yo");
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) return;
    onSnippet({ kind: "translate", text, from, to });
  }, [active, text, from, to, onSnippet]);

  async function translate(input = text, f: From = from, t: LanguageCode = to) {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    setOutput("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let raw = "";
      for await (const chunk of natlas.translateStream(input, { from: f, to: t, signal: ac.signal })) {
        raw = chunk.text;
        setOutput(raw);
      }
      setOutput(cleanTranslation(raw));
    } catch (e) {
      const fe = friendlyError(e);
      if (fe.kind !== "aborted") {
        setError(fe);
        onEndpointProblem(fe.kind);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function swap() {
    if (from === "auto") return;
    setFrom(to);
    setTo(from);
    if (output) {
      setText(output);
      setOutput("");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const soft = error && (error.kind === "offline" || error.kind === "loading" || error.kind === "config" || error.kind === "rate");

  return (
    <section className="panel">
      {/* Language bar */}
      <div className="hairline grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b px-3 py-2.5 sm:flex sm:px-4">
        <LanguageSelect<From>
          id="from"
          label="From"
          value={from}
          onChange={setFrom}
          extra={{ value: "auto", label: "Detect" }}
          className="[&>span]:hidden sm:[&>span]:inline"
        />
        <button
          type="button"
          className="press focus-ring grid h-10 w-10 place-items-center rounded-full bg-[var(--fill)] text-[var(--accent)] hover:bg-[var(--fill-strong)] disabled:opacity-35"
          onClick={swap}
          disabled={from === "auto"}
          aria-label="Swap languages"
          title="Swap languages"
        >
          <Swap />
        </button>
        <LanguageSelect<LanguageCode>
          id="to"
          label="To"
          value={to}
          onChange={setTo}
          className="[&>span]:hidden sm:[&>span]:inline"
        />
      </div>

      <div className="grid md:grid-cols-2">
        <div className="hairline border-b p-3 sm:p-4 md:border-b-0 md:border-r">
          <textarea
            className="field min-h-[180px] resize-none md:min-h-[240px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={from === "auto" ? "Type or paste text in any N-ATLaS language…" : `Type ${LANGUAGES[from].name} text…`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void translate();
            }}
            aria-label="Text to translate"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-subtle text-[12px] tabular-nums">
              {text.length} chars<span className="hidden sm:inline"> · Ctrl/⌘+Enter</span>
            </span>
            {busy ? (
              <button type="button" className="btn-dark" onClick={() => abortRef.current?.abort()}>
                <Stop /> Stop
              </button>
            ) : (
              <button type="button" className="btn-primary min-w-[132px]" onClick={() => translate()} disabled={!text.trim()}>
                Translate
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col p-3 sm:p-4">
          <div
            className="relative min-h-[180px] flex-1 whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[16px] leading-relaxed md:min-h-[240px]"
            style={{ background: "var(--accent-soft)" }}
            aria-live="polite"
            aria-busy={busy}
          >
            {output ? (
              <span className="animate-fade">{output}</span>
            ) : busy ? (
              <span className="text-muted flex items-center gap-2">
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)]" style={{ animationDelay: `${d * 140}ms` }} />
                  ))}
                </span>
                N-ATLaS is translating…
              </span>
            ) : (
              <span className="text-subtle">{LANGUAGES[to].nativeName} translation appears here</span>
            )}
            {busy && output ? <span className="caret" aria-hidden /> : null}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-subtle text-[12px] leading-snug">Translated by N-ATLaS · check important text with a fluent speaker</span>
            <button type="button" className="btn-ghost shrink-0" onClick={copy} disabled={!output || busy}>
              <Copy /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div
          className={`animate-rise mx-3 mb-3 rounded-[18px] border px-4 py-3 text-[14px] sm:mx-4 ${
            soft
              ? "border-amber-300/50 bg-amber-100/60 text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
              : "border-rose-300/50 bg-rose-100/60 text-rose-950 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100"
          }`}
        >
          {error.message}
        </div>
      ) : null}

      <div className="hairline border-t px-3 py-4 sm:px-4">
        <p className="text-subtle mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.08em]">Try a sample · one tap</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
          {TRANSLATE_SAMPLES.map((s) => (
            <button
              key={s.text}
              type="button"
              className="chip min-h-[52px] w-full !rounded-[16px]"
              disabled={busy}
              onClick={() => {
                setFrom(s.from);
                setTo(s.to);
                setText(s.text);
                void translate(s.text, s.from, s.to);
              }}
            >
              <span className="text-accent shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide">
                {s.from} → {s.to}
              </span>
              <span className="min-w-0 truncate">{s.text}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
