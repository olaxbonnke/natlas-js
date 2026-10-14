"use client";

import { useMemo, useState } from "react";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/client";
import { curlSnippet, tsSnippet, type SnippetInput } from "@/lib/snippets";

export default function CodePanel({ input }: { input: SnippetInput | null }) {
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
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <aside className="overflow-hidden rounded-2xl border border-naija-900/40 bg-[#0b1f17] text-slate-100 shadow-lg lg:sticky lg:top-6">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex gap-1" role="tablist" aria-label="Code language">
          {(
            [
              ["ts", "TypeScript"],
              ["curl", "cURL"],
              ["install", "Install"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                tab === id ? "bg-naija-600 text-white" : "text-slate-300 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="code-scroll max-h-[540px] overflow-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="border-t border-white/10 px-4 py-2.5 text-[11px] text-slate-400">
        Live: this is the exact SDK call for your current request.
      </div>
    </aside>
  );
}
