import type { ChatMessage, LanguageCode } from "@olaxbonnke/natlas-js";

export interface ChatSnippetInput {
  kind: "chat";
  messages: ChatMessage[];
  replyIn?: LanguageCode;
  temperature: number;
  maxTokens: number;
}

export interface TranslateSnippetInput {
  kind: "translate";
  text: string;
  from: LanguageCode | "auto";
  to: LanguageCode;
}

export type SnippetInput = ChatSnippetInput | TranslateSnippetInput;

const js = (v: unknown, indent = 0) =>
  JSON.stringify(v, null, 2)
    .split("\n")
    .map((l, i) => (i === 0 ? l : " ".repeat(indent) + l))
    .join("\n");

export function tsSnippet(input: SnippetInput): string {
  const header = `import { NAtlas } from "@olaxbonnke/natlas-js";

// The trycloudflare.com URL printed by the Kaggle notebook
const natlas = new NAtlas({ baseUrl: process.env.NATLAS_BASE_URL });
`;
  if (input.kind === "translate") {
    return `${header}
const { text } = await natlas.translate(${JSON.stringify(input.text || "…")}, {
  from: ${JSON.stringify(input.from)},
  to: ${JSON.stringify(input.to)},
});

console.log(text);
`;
  }
  const msgs = input.messages.length ? input.messages : [{ role: "user", content: "…" }];
  const opts: Record<string, unknown> = {};
  if (input.replyIn) opts.replyIn = input.replyIn;
  opts.temperature = input.temperature;
  opts.maxTokens = input.maxTokens;
  return `${header}
const messages = ${js(msgs)};

for await (const chunk of natlas.chatStream(messages, ${js(opts)})) {
  process.stdout.write(chunk.delta);
}
`;
}

export function curlSnippet(input: SnippetInput, systemPrompt: string): string {
  let messages: ChatMessage[];
  let extra: Record<string, unknown>;
  if (input.kind === "translate") {
    messages = [
      { role: "system", content: "<natlas-js translation template>" },
      { role: "user", content: input.text || "…" },
    ];
    extra = { temperature: 0.1, repeat_penalty: 1.12 };
  } else {
    messages = [{ role: "system", content: systemPrompt }, ...input.messages];
    extra = { temperature: input.temperature, max_tokens: input.maxTokens, repeat_penalty: 1.12 };
  }
  const body = { model: "n-atlas", stream: input.kind === "chat", messages, ...extra };
  const json = JSON.stringify(body, null, 2).replace(/'/g, "'\\''");
  return `curl "$NATLAS_BASE_URL/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
}
