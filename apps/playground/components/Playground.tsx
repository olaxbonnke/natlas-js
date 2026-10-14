"use client";

import { useCallback, useState } from "react";
import { useEndpointHealth, type FriendlyError } from "@/lib/client";
import type { SnippetInput } from "@/lib/snippets";
import ChatPanel from "./ChatPanel";
import CodePanel from "./CodePanel";
import StatusPill, { StatusNotice } from "./StatusPill";
import TranslatePanel from "./TranslatePanel";
import { Github } from "./icons";

type Mode = "chat" | "translate";
type View = Mode | "code";

const VIEWS: Array<[View, string]> = [
  ["chat", "Chat"],
  ["translate", "Translate"],
  ["code", "Code"],
];

export default function Playground() {
  const [view, setView] = useState<View>("chat");
  const [mode, setMode] = useState<Mode>("chat");
  const [snippet, setSnippet] = useState<SnippetInput | null>(null);
  const { status, latencyMs, refresh } = useEndpointHealth();

  const onSnippet = useCallback((s: SnippetInput) => setSnippet(s), []);
  const onEndpointProblem = useCallback(
    (kind: FriendlyError["kind"]) => {
      if (kind === "offline" || kind === "loading" || kind === "config") void refresh();
    },
    [refresh],
  );

  function choose(v: View) {
    setView(v);
    if (v !== "code") setMode(v);
  }

  // On desktop the code panel is always visible, so "code" falls back to the last mode.
  const show = (m: Mode) => (view === m ? "" : view === "code" && mode === m ? "hidden lg:block" : "hidden");
  const idx = VIEWS.findIndex(([v]) => v === view);
  const deskIdx = mode === "chat" ? 0 : 1;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="hairline glass sticky top-0 z-20 border-b">
        <div className="flag-stripe h-[3px] w-full opacity-90" aria-hidden />
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-gradient-to-b from-[#13a066] to-[#006e43] text-[15px] font-bold text-white shadow-[0_1px_0_rgba(255,255,255,0.3)_inset,0_4px_10px_-4px_rgba(0,135,81,0.6)]">
              N
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em]">N-ATLaS Playground</h1>
              <p className="text-subtle hidden truncate text-[12px] sm:block">Built on natlas-js</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusPill status={status} latencyMs={latencyMs} onRefresh={refresh} />
            <a
              href="https://github.com/olaxbonnke/natlas-js"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost !min-h-[40px] !px-3"
              aria-label="natlas-js on GitHub"
            >
              <Github />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-6 pt-4 sm:px-6 sm:pt-7">
        <div className="mb-4 flex flex-col gap-4 sm:mb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="animate-rise px-1">
            <p className="text-accent text-[11.5px] font-semibold uppercase tracking-[0.12em]">Nigeria&apos;s multilingual LLM</p>
            <h2 className="mt-1 text-[24px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[34px]">
              Yorùbá, Hausa, Igbo &amp; English.{" "}
              <span className="text-muted sm:block">One SDK call away.</span>
            </h2>
          </div>

          {/* Segmented control: Chat / Translate (+ Code on phones) */}
          <div className="flex justify-center sm:justify-start">
            <div className="segmented grid w-full max-w-[360px] grid-cols-3 lg:hidden" role="tablist" aria-label="Playground mode">
              <span
                className="segmented-thumb"
                style={{ width: "calc((100% - 8px) / 3)", left: 4, transform: `translateX(${idx * 100}%)` }}
                aria-hidden
              />
              {VIEWS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => choose(id)} className="min-h-[40px]">
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented hidden grid-cols-2 lg:grid" role="tablist" aria-label="Playground mode">
              <span
                className="segmented-thumb"
                style={{ width: "calc((100% - 8px) / 2)", left: 4, transform: `translateX(${deskIdx * 100}%)` }}
                aria-hidden
              />
              {VIEWS.slice(0, 2).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => choose(id)} className="min-h-[40px] min-w-[120px]">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <StatusNotice status={status} onRefresh={refresh} />

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:gap-6">
          <div className="min-w-0">
            <div className={show("chat")}>
              <ChatPanel onSnippet={onSnippet} onEndpointProblem={onEndpointProblem} active={mode === "chat"} />
            </div>
            <div className={show("translate")}>
              <TranslatePanel onSnippet={onSnippet} onEndpointProblem={onEndpointProblem} active={mode === "translate"} />
            </div>
          </div>
          <div className={`min-w-0 lg:sticky lg:top-[84px] ${view === "code" ? "animate-rise" : "hidden lg:block"}`}>
            <CodePanel input={snippet} />
            <p className="text-subtle mt-3 px-2 text-[12px] leading-relaxed">
              The playground calls N-ATLaS through the same{" "}
              <code className="whitespace-nowrap rounded bg-[var(--fill)] px-1 py-0.5 font-mono text-[11px]">@olaxbonnke/natlas-js</code> package
              you install from npm.
            </p>
          </div>
        </div>
      </main>

      <footer className={`hairline border-t ${view === "chat" ? "pb-28 lg:pb-0" : ""}`}>
        <div className="text-subtle mx-auto max-w-7xl space-y-2 px-4 py-6 text-[12px] leading-relaxed sm:px-6">
          <p>
            <strong className="font-semibold text-[var(--muted)]">Every response on this page is generated by N-ATLaS</strong>; no
            other foundation model is used. N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and
            Digital Economy, and powered by Awarri Technologies, with NCAIR/NITDA. Model use is subject to the{" "}
            <a className="underline decoration-[var(--hairline)] underline-offset-2 hover:text-[var(--fg)]" href="https://huggingface.co/NCAIR1/N-ATLaS" target="_blank" rel="noreferrer">
              N-ATLaS Terms of Use
            </a>
            .
          </p>
          <p>
            natlas-js is open source (MIT) by{" "}
            <a className="underline decoration-[var(--hairline)] underline-offset-2 hover:text-[var(--fg)]" href="https://github.com/olaxbonnke" target="_blank" rel="noreferrer">
              Bonnke Olaitan
            </a>{" "}
            for the Nigeria AI Challenge (PS1 · Developer Infrastructure) ·{" "}
            <a className="underline decoration-[var(--hairline)] underline-offset-2 hover:text-[var(--fg)]" href="https://github.com/olaxbonnke/natlas-js" target="_blank" rel="noreferrer">
              GitHub
            </a>
            . Outputs can be wrong; check important content with a fluent speaker.
          </p>
        </div>
      </footer>
    </div>
  );
}
