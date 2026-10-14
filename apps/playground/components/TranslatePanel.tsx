"use client";

import { LANGUAGES, cleanTranslation, type LanguageCode } from "@olaxbonnke/natlas-js";
import { useEffect, useRef, useState } from "react";
import { TRANSLATE_SAMPLES } from "@/lib/samples";
import { friendlyError, natlas, type FriendlyError } from "@/lib/client";
import type { TranslateSnippetInput } from "@/lib/snippets";
import LanguageSelect from "./LanguageSelect";

type From = "auto" | LanguageCode;

export default function TranslatePanel({
  onSnippet,
  onEndpointProblem,
}: {
  onSnippet: (s: TranslateSnippetInput) => void;
  onEndpointProblem: (kind: FriendlyError["kind"]) => void;
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
    onSnippet({ kind: "translate", text, from, to });
  }, [text, from, to, onSnippet]);

  async function translate() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setOutput("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let raw = "";
      for await (const chunk of natlas.translateStream(text, { from, to, signal: ac.signal })) {
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
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <LanguageSelect<From> id="from" label="From" value={from} onChange={setFrom} extra={{ value: "auto", label: "Detect language" }} />
        <button
          type="button"
          className="btn-ghost"
          onClick={swap}
          disabled={from === "auto"}
          aria-label="Swap languages"
          title="Swap languages"
        >
          ⇄
        </button>
        <LanguageSelect<LanguageCode> id="to" label="To" value={to} onChange={setTo} />
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b border-slate-100 p-5 md:border-b-0 md:border-r">
          <textarea
            className="field min-h-[220px] resize-y"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={from === "auto" ? "Type or paste text in any N-ATLaS language…" : `Type ${LANGUAGES[from].name} text…`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void translate();
            }}
            aria-label="Text to translate"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">{text.length} chars · Ctrl/⌘+Enter</span>
            {busy ? (
              <button type="button" className="btn-primary bg-slate-800 hover:bg-slate-900" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={translate} disabled={!text.trim()}>
                Translate
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col p-5">
          <div className="relative min-h-[220px] flex-1 whitespace-pre-wrap rounded-xl bg-naija-50/70 px-4 py-3 text-[15px] leading-relaxed text-slate-900">
            {output ? (
              output
            ) : (
              <span className="text-slate-400">{busy ? "N-ATLaS is translating…" : `${LANGUAGES[to].nativeName} translation appears here`}</span>
            )}
            {busy ? <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-naija-600" /> : null}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-400">Translated by N-ATLaS · verify important text with a fluent speaker</span>
            <button type="button" className="btn-ghost" onClick={copy} disabled={!output || busy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mx-5 mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error.message}</div>
      ) : null}

      <div className="border-t border-slate-100 px-5 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Try a sample</p>
        <div className="flex flex-wrap gap-2">
          {TRANSLATE_SAMPLES.map((s) => (
            <button
              key={s.text}
              type="button"
              className="chip"
              onClick={() => {
                setFrom(s.from);
                setTo(s.to);
                setText(s.text);
                setOutput("");
              }}
            >
              <span className="text-[11px] font-bold uppercase text-naija-600">
                {s.from}→{s.to}
              </span>
              <span className="max-w-[260px] truncate">{s.text}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
