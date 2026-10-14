"use client";

import type { EndpointStatus } from "@/lib/client";

const LABELS: Record<EndpointStatus, { text: string; short: string; dot: string; tone: string; breathe?: boolean }> = {
  checking: { text: "Checking model…", short: "Checking", dot: "bg-slate-400", tone: "text-muted", breathe: true },
  online: { text: "N-ATLaS online", short: "Online", dot: "bg-emerald-500", tone: "text-emerald-700 dark:text-emerald-300" },
  loading: { text: "Model waking up", short: "Waking", dot: "bg-amber-500", tone: "text-amber-700 dark:text-amber-300", breathe: true },
  offline: { text: "Model waking up", short: "Waking", dot: "bg-amber-500", tone: "text-amber-700 dark:text-amber-300", breathe: true },
  unauthorized: { text: "Key mismatch", short: "Key", dot: "bg-rose-500", tone: "text-rose-700 dark:text-rose-300" },
  not_configured: { text: "Demo mode", short: "Demo", dot: "bg-sky-500", tone: "text-sky-700 dark:text-sky-300" },
};

export default function StatusPill({ status, latencyMs, onRefresh }: { status: EndpointStatus; latencyMs?: number; onRefresh: () => void }) {
  const l = LABELS[status];
  return (
    <button
      type="button"
      onClick={onRefresh}
      title="Re-check the model endpoint"
      aria-label={`${l.text}. Re-check the model endpoint`}
      className={`press focus-ring inline-flex min-h-[36px] items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold ${l.tone}`}
      style={{ background: "var(--fill)" }}
    >
      <span className="relative flex h-2 w-2">
        {l.breathe ? <span className={`animate-breathe absolute inset-0 rounded-full ${l.dot}`} /> : null}
        <span className={`relative h-2 w-2 rounded-full ${l.dot}`} />
      </span>
      <span className="hidden sm:inline">{l.text}</span>
      <span className="sm:hidden">{l.short}</span>
      {status === "online" && latencyMs !== undefined ? <span className="font-normal opacity-60">{latencyMs} ms</span> : null}
    </button>
  );
}

export function StatusNotice({ status, onRefresh }: { status: EndpointStatus; onRefresh?: () => void }) {
  if (status === "online" || status === "checking") return null;
  const content: Record<string, { title: string; short: string; body: string; dot: string; accent: string }> = {
    loading: {
      title: "N-ATLaS is waking up",
      short: "Usually one to three minutes. This page re-checks on its own.",
      body: "The model is loading onto a free Kaggle T4 GPU. This usually takes one to three minutes, and this page re-checks automatically.",
      dot: "bg-amber-500",
      accent: "from-amber-300/30",
    },
    offline: {
      title: "Model waking up",
      short: "Samples and SDK code still work while it rests.",
      body: "This demo runs for free on a Kaggle GPU notebook that is switched on for demo sessions, so it may be resting right now. Meanwhile, browse the samples and copy the live SDK code, or run your own server in about ten minutes with the guide in the repo.",
      dot: "bg-amber-500",
      accent: "from-amber-300/30",
    },
    unauthorized: {
      title: "API key mismatch",
      short: "The playground key doesn't match the notebook.",
      body: "The playground's NATLAS_API_KEY does not match the key the notebook was started with.",
      dot: "bg-rose-500",
      accent: "from-rose-300/30",
    },
    not_configured: {
      title: "Demo mode",
      short: "Model endpoint not connected yet. Samples and SDK code still work.",
      body: "To go live, set NATLAS_BASE_URL to the trycloudflare.com URL printed by the notebook (Vercel → Settings → Environment Variables), then redeploy. Or run your own server in about ten minutes with the guide in the repo.",
      dot: "bg-sky-500",
      accent: "from-sky-300/30",
    },
  };
  const c = content[status];
  if (!c) return null;
  return (
    <details role="status" className="panel animate-rise group mb-4 overflow-hidden !rounded-[20px]">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-r ${c.accent} to-transparent`} aria-hidden />
      <summary className="relative flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className={`animate-breathe absolute inset-0 rounded-full ${c.dot}`} />
          <span className={`relative h-2.5 w-2.5 rounded-full ${c.dot}`} />
        </span>
        <span className="min-w-0 flex-1 text-[13.5px] leading-snug">
          <span className="font-semibold">{c.title}</span>
          <span className="text-muted"> · {c.short}</span>
        </span>
        <span className="text-subtle shrink-0 text-[12.5px] font-medium">
          <span className="group-open:hidden">Details</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="relative px-4 pb-3.5 pl-[42px] text-[13.5px]">
        <p className="text-muted leading-relaxed">{c.body}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {onRefresh ? (
            <button type="button" className="btn-ghost" onClick={onRefresh}>
              Check again
            </button>
          ) : null}
          <a className="btn-ghost" href="https://github.com/olaxbonnke/natlas-js/tree/main/server" target="_blank" rel="noreferrer">
            Server guide →
          </a>
        </div>
      </div>
    </details>
  );
}
