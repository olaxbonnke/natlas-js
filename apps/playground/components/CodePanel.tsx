"use client";

import { useMemo, useState } from "react";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/client";
import { curlSnippet, tsSnippet, type SnippetInput } from "@/lib/snippets";

const TABS = [
  ["ts", "TS"],
  ["curl", "cURL"],
  ["install", "Install"],
] as const;

export default function CodePanel({ input, className = "" }: { input: SnippetInput | null; className?: string }) {
  const [tab, setTab] = useState<"ts" | "curl" | "install">("ts");
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (tab === "install") {
      return `# Install the SDK (zero dependencies, ESM + CJS)
npm install @olaxbonnke/natlas-js

# Point it at your N-ATLaS server
export NATLAS_BASE_URL="https://<your-tunnel>.trycloudflare.com"

# Or try the CLI
npx @olaxbonnke/natlas-js "Báwo ni?"
npx @olaxbonnke/natlas-js --translate --from en --to ha "Where is the market?"`;
    }
    if (!input) return "";
    return tab === "ts" ? tsSnippet(input) : curlSnippet(input, DEFAULT_SYSTEM_PROMPT);
  }, [tab, input]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const idx = TABS.findIndex(([id]) => id === tab);

  return (
    <aside
      className={`code-surface relative overflow-hidden rounded-[24px] text-slate-100 ring-1 ring-white/10 shadow-[0_30px_60px_-25px_rgba(0,40,25,0.55),0_8px_20px_-10px_rgba(0,0,0,0.35)] ${className}`}
      aria-label="Live SDK code"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div
          className="relative grid grid-cols-3 rounded-full bg-white/[0.07] p-0.5"
          role="tablist"
          aria-label="Code language"
        >
          <span
            className="segmented-thumb !bottom-0.5 !top-0.5 !bg-white/[0.14] !shadow-none"
            style={{ width: "calc((100% - 4px) / 3)", left: 2, transform: `translateX(${idx * 100}%)` }}
            aria-hidden
          />
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`press focus-ring relative z-10 min-h-[32px] rounded-full px-2.5 text-[12px] font-semibold sm:px-3 ${
                tab === id ? "text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {id === "ts" ? (
                <>
                  <span className="sm:hidden">{label}</span>
                  <span className="hidden sm:inline">TypeScript</span>
                </>
              ) : (
                label
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className="press focus-ring min-h-[32px] rounded-full bg-white/[0.07] px-3 text-[12px] font-semibold text-slate-200 hover:bg-white/[0.12]"
          aria-live="polite"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="code-scroll max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-[1.7] text-emerald-50/90 lg:max-h-[calc(100dvh-260px)]">
        <code>{code}</code>
      </pre>
      <div className="flex items-center gap-2 border-t border-white/[0.07] px-5 py-3 text-[11.5px] text-slate-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-breathe absolute inset-0 rounded-full bg-emerald-400" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        Live: the exact SDK call for your current request.
      </div>
    </aside>
  );
}
