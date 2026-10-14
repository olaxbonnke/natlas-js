"use client";

import type { EndpointStatus } from "@/lib/client";

const LABELS: Record<EndpointStatus, { text: string; dot: string; ring: string }> = {
  checking: { text: "Checking model…", dot: "bg-slate-400 animate-pulse", ring: "border-slate-200 bg-white text-slate-600" },
  online: { text: "N-ATLaS online", dot: "bg-naija-500", ring: "border-naija-200 bg-naija-50 text-naija-800" },
  loading: { text: "Waking up…", dot: "bg-amber-500 animate-pulse", ring: "border-amber-200 bg-amber-50 text-amber-800" },
  offline: { text: "Model offline", dot: "bg-rose-500", ring: "border-rose-200 bg-rose-50 text-rose-800" },
  unauthorized: { text: "Key mismatch", dot: "bg-rose-500", ring: "border-rose-200 bg-rose-50 text-rose-800" },
  not_configured: { text: "Not configured", dot: "bg-slate-400", ring: "border-slate-200 bg-slate-50 text-slate-700" },
};

export default function StatusPill({ status, latencyMs, onRefresh }: { status: EndpointStatus; latencyMs?: number; onRefresh: () => void }) {
  const l = LABELS[status];
  return (
    <button
      type="button"
      onClick={onRefresh}
      title="Re-check the model endpoint"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:shadow-sm ${l.ring}`}
    >
      <span className={`h-2 w-2 rounded-full ${l.dot}`} />
      {l.text}
      {status === "online" && latencyMs !== undefined ? <span className="font-normal opacity-70">{latencyMs} ms</span> : null}
    </button>
  );
}

export function StatusNotice({ status }: { status: EndpointStatus }) {
  if (status === "online" || status === "checking") return null;
  const content: Record<string, { title: string; body: string; tone: string }> = {
    loading: {
      title: "N-ATLaS is waking up",
      body: "The model is loading onto a free Kaggle T4 GPU. This usually takes one to three minutes; this page re-checks automatically.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    },
    offline: {
      title: "N-ATLaS is resting right now",
      body: "This demo is served for free from a Kaggle GPU notebook, which is switched on for demo sessions. You can still browse the samples and copy the SDK code, or start your own server in about ten minutes with the guide in the repo.",
      tone: "border-rose-200 bg-rose-50 text-rose-900",
    },
    unauthorized: {
      title: "API key mismatch",
      body: "The playground's NATLAS_API_KEY does not match the key the notebook was started with.",
      tone: "border-rose-200 bg-rose-50 text-rose-900",
    },
    not_configured: {
      title: "No model endpoint configured",
      body: "Set NATLAS_BASE_URL to the trycloudflare.com URL printed by the notebook (Vercel → Settings → Environment Variables), then redeploy.",
      tone: "border-slate-200 bg-slate-50 text-slate-800",
    },
  };
  const c = content[status];
  if (!c) return null;
  return (
    <div role="status" className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${c.tone}`}>
      <p className="font-semibold">{c.title}</p>
      <p className="mt-0.5 leading-relaxed opacity-90">
        {c.body}{" "}
        {status === "offline" ? (
          <a className="font-semibold underline underline-offset-2" href="https://github.com/olaxbonnke/natlas-js/tree/main/server" target="_blank" rel="noreferrer">
            Server guide →
          </a>
        ) : null}
      </p>
    </div>
  );
}
