#!/usr/bin/env node
// Runs examples/eval/prompts.json against your N-ATLaS endpoint and writes a JSONL + CSV for human rating.
//   NATLAS_BASE_URL=https://xyz.trycloudflare.com node examples/eval/run-eval.mjs
import { readFile, writeFile } from "node:fs/promises";
import { NAtlas } from "@olaxbonnke/natlas-js";

const here = new URL(".", import.meta.url);
const set = JSON.parse(await readFile(new URL("prompts.json", here), "utf8"));
const natlas = new NAtlas({ timeoutMs: 180_000 });

const health = await natlas.health();
if (!health.ok) {
  console.error(`Endpoint is ${health.status}. Start the notebook first.`);
  process.exit(1);
}

const rows = [];
async function timed(id, kind, fn) {
  const t0 = performance.now();
  let first;
  let out = "";
  let tokens = 0;
  for await (const c of fn()) {
    if (first === undefined && c.delta) first = performance.now() - t0;
    out = c.text;
    if (c.delta) tokens++;
  }
  const total = performance.now() - t0;
  const row = {
    id,
    kind,
    output: out.trim(),
    ttft_ms: Math.round(first ?? total),
    total_ms: Math.round(total),
    chunks: tokens,
    chunks_per_s: +(tokens / Math.max(0.001, (total - (first ?? 0)) / 1000)).toFixed(1),
  };
  rows.push(row);
  console.log(`${id}: ${row.total_ms} ms, ~${row.chunks_per_s} chunks/s\n  ${row.output.slice(0, 160).replace(/\n/g, " ")}`);
}

for (const t of set.translation) {
  await timed(t.id, "translation", () => natlas.translateStream(t.text, { from: t.from, to: t.to }));
  Object.assign(rows.at(-1), { source: t.text, reference: t.reference ?? "", from: t.from, to: t.to });
}
for (const c of set.chat) {
  await timed(c.id, "chat", () => natlas.chatStream(c.prompt, { replyIn: c.replyIn, maxTokens: 300, temperature: 0.2 }));
  Object.assign(rows.at(-1), { source: c.prompt, replyIn: c.replyIn });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeFile(new URL(`results-${stamp}.jsonl`, here), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const header = ["id", "kind", "from", "to", "replyIn", "source", "reference", "output", "ttft_ms", "total_ms", "fluency_1to5", "adequacy_1to5", "orthography_1to5", "rater", "notes"];
const csv = [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n");
await writeFile(new URL(`rating-sheet-${stamp}.csv`, here), csv + "\n");
console.log(`\nSaved results-${stamp}.jsonl and rating-sheet-${stamp}.csv in examples/eval/`);
