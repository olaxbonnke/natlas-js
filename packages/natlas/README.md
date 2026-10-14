# natlas-js

Zero-dependency TypeScript SDK for **N-ATLaS**, Nigeria's multilingual large language model for
**Yoruba, Hausa, Igbo and Nigerian English**.

- `chat()` and `chatStream()` (Server-Sent Events as an async iterator)
- `translate()` / `translateStream()` with tuned prompt templates for `en`, `yo`, `ha`, `ig`
- language constants, aliases and orthography rules (`LANGUAGES`, `normalizeLanguage`)
- typed errors, per-request timeouts, automatic retries with back-off, `health()` probe
- works in Node 18+, browsers, Deno, Bun, Vercel/Cloudflare edge (uses the platform `fetch`)
- ESM + CommonJS + `.d.ts`; a small CLI
- optional React hooks: `useNatlas()` and `useTranslate()` from `@olaxbonnke/natlas-js/react`

It talks to any **OpenAI-compatible** N-ATLaS server: llama.cpp `llama-server`, llama-cpp-python, vLLM.
The repo's [`server/`](../../server) folder runs one for free on a Kaggle T4 GPU behind a Cloudflare quick tunnel.

## Install

```bash
npm install @olaxbonnke/natlas-js
```

## Quick start

```ts
import { NAtlas } from "@olaxbonnke/natlas-js";

const natlas = new NAtlas({
  baseUrl: process.env.NATLAS_BASE_URL, // e.g. https://xyz.trycloudflare.com
  apiKey: process.env.NATLAS_API_KEY,   // optional
});

// Chat (Yoruba in, Yoruba out)
const { content } = await natlas.chat("Báwo ni? Kí ni o lè ṣe fún mi?", { replyIn: "yo" });

// Stream
for await (const chunk of natlas.chatStream("Sannu! Ka gaya mini labari game da Kano.", { replyIn: "ha" })) {
  process.stdout.write(chunk.delta);
}

// Translate
const { text } = await natlas.translate("Wash your hands before eating.", { from: "en", to: "ig", domain: "health" });
```

CommonJS: `const { NAtlas } = require("@olaxbonnke/natlas-js");`

## React

```bash
npm install @olaxbonnke/natlas-js react   # react >= 18 is an optional peer dependency
```

```tsx
"use client";
import { useNatlas } from "@olaxbonnke/natlas-js/react";

export function Chat() {
  const { messages, send, isLoading, isStreaming, error, stop, reset } = useNatlas({
    baseUrl: "/api",   // your N-ATLaS server or a same-origin relay
    replyIn: "yo",      // optional: always answer in Yoruba
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); send(String(f.get("q"))); e.currentTarget.reset(); }}>
      {messages.map((m, i) => <p key={i}><b>{m.role}:</b> {m.content}</p>)}
      {error && <p role="alert">{error.message}</p>}
      <input name="q" placeholder="Báwo ni?" />
      <button disabled={isLoading}>Send</button>
      {isStreaming && <button type="button" onClick={stop}>Stop</button>}
      <button type="button" onClick={reset}>New chat</button>
    </form>
  );
}
```

### `useNatlas(options?)`

Built on `chatStream()`: the last assistant message grows token by token.

| Returns | |
|---|---|
| `messages` | `ChatMessage[]` (user and assistant turns; the system prompt is added per request) |
| `send(text, chatOptions?)` | Appends the user turn, streams the reply, sends the whole history. Resolves with the reply text (partial if stopped) or `undefined` on error. A new `send` aborts the previous one. |
| `translate(text, { to, from?, domain?, tone? })` | Calls `translate()` without touching `messages`. |
| `isLoading` / `isStreaming` | Request in flight / first token received. |
| `error` | The last `NAtlasError` (typed: `NAtlasConnectionError`, `NAtlasAuthError`, ...), cleared on the next request. |
| `stop()` | Aborts the request (`AbortController`); text streamed so far is kept, no error is set. |
| `reset()` | Aborts and restores `initialMessages`. |
| `setMessages(list)` | Replace the history (edit, trim, restore). |

Options: every `new NAtlas()` option (`baseUrl`, `apiKey`, `model`, `timeoutMs`, `fetch`, ...) **or** `client` (an existing `NAtlas`),
plus `initialMessages`, `replyIn`, `chatOptions` (defaults for every `send`), and `onToken`, `onFinish`, `onError` callbacks.

### `useTranslate(options?)`

```tsx
const { translation, translate, isLoading, error, stop, reset } = useTranslate({ baseUrl: "/api", defaults: { to: "ha" }, stream: true });
await translate("Wash your hands before eating.");          // translation fills in as it streams
await translate("Good morning", { from: "en", to: "ig" });  // per-call overrides
```

Notes:

- **SSR-safe.** The client is created lazily on the first `send()`/`translate()`, never during render, so server rendering
  works even when `baseUrl` is only known in the browser. Requests in flight are aborted on unmount.
- **`"use client"`** is kept at the top of `dist/react.js` / `dist/react.cjs`, so the hooks drop straight into Next.js App Router.
- **Tree-shakeable.** The core entry never imports React; the `react` entry imports the core by package name, so your app
  ships one copy of `NAtlas`. `sideEffects: false`.
- Don't put a private `apiKey` in browser code: point `baseUrl` at a server route that adds it (like the playground's relay).

## CLI

```bash
export NATLAS_BASE_URL=https://xyz.trycloudflare.com
npx @olaxbonnke/natlas-js "Báwo ni?"
npx @olaxbonnke/natlas-js --reply-in ha "Tell me about the Durbar festival"
npx @olaxbonnke/natlas-js --translate --from en --to yo "Good morning, mother"
echo "Ina kwana?" | npx @olaxbonnke/natlas-js --translate --to en
npx @olaxbonnke/natlas-js --health
```

## API

### `new NAtlas(options?)`

| Option | Default | |
|---|---|---|
| `baseUrl` | `process.env.NATLAS_BASE_URL` | Server root, with or without `/v1`. Relative (`/api`) works in browsers. |
| `apiKey` | `process.env.NATLAS_API_KEY` | Sent as `Authorization: Bearer …`. |
| `model` | `"n-atlas"` | Sent as `model`; llama.cpp serves whatever it loaded. |
| `timeoutMs` | `120000` | Per attempt. For streams it is an idle timeout between chunks. |
| `maxRetries` | `2` | For connection errors, timeouts, 408/409/429/5xx. Never after a stream has started. |
| `retryDelayMs` | `500` | Exponential back-off base, with jitter; honours `Retry-After`. |
| `systemPrompt` | model-card prompt | Used when your messages have no system message. |
| `defaultHeaders` | `{}` | Extra headers. |
| `fetch` | `globalThis.fetch` | Inject a custom fetch (tests, proxies). |

### `chat(input, options?) → Promise<ChatResult>`

`input` is a string or `{ role: "system" | "user" | "assistant", content }[]`.

Options: `temperature`, `maxTokens`, `topP`, `repetitionPenalty` (default **1.12**, as in the model card),
`frequencyPenalty`, `presencePenalty`, `stop`, `seed`, `system`, `replyIn` (`"en" | "yo" | "ha" | "ig"`),
`signal`, `timeoutMs`, `extraBody`.

Returns `{ content, finishReason, usage?: { promptTokens, completionTokens, totalTokens }, model?, id?, raw }`.

### `chatStream(input, options?) → AsyncGenerator<ChatChunk, string>`

Each chunk: `{ delta, text, finishReason, raw }`. The generator's return value is the full text.
Cancel with an `AbortSignal`.

### `translate(text, { from?, to, domain?, tone?, ...chatOptions }) → Promise<TranslationResult>`

`from` defaults to `"auto"`. Accepts codes or names (`"Yoruba"`, `"hau"`). Uses temperature 0.1 by default, a strict
translator system prompt with target-language orthography rules (Yoruba tone marks and under-dots, Hausa hooked
letters, Igbo dotted vowels), and strips labels/quotes from the output. `translateStream()` is the streaming variant.

### `health() → Promise<HealthResult>`

Never throws. `status` is `"online" | "loading" | "offline" | "unauthorized"`. Tries `/health` then `/v1/models`.

### `models()`

`GET /v1/models`.

### Languages

```ts
import { LANGUAGES, LANGUAGE_CODES, normalizeLanguage, getLanguage } from "@olaxbonnke/natlas-js";
LANGUAGE_CODES;               // ["en", "yo", "ha", "ig"]
LANGUAGES.yo.nativeName;      // "Èdè Yorùbá"
normalizeLanguage("Hausa");   // "ha"
```

### Errors

All errors extend `NAtlasError` (`code`, `retryable`).

| Class | When |
|---|---|
| `NAtlasValidationError` | Bad arguments, before any request |
| `NAtlasAPIError` | Non-2xx response (`status`, `body`) |
| `NAtlasAuthError` | 401 / 403 |
| `NAtlasRateLimitError` | 429 (`retryAfterMs`) |
| `NAtlasModelLoadingError` | 503 "Loading model" while llama.cpp loads weights |
| `NAtlasConnectionError` | DNS/network failure, or a Cloudflare tunnel whose notebook is down (502/52x/530) |
| `NAtlasTimeoutError` | `timeoutMs` exceeded |
| `NAtlasAbortError` | Your `AbortSignal` fired |

## Attribution and licence

natlas-js is MIT-licensed. **N-ATLaS** itself is "an initiative of the Federal Ministry of Communications, Innovation
and Digital Economy, and powered by Awarri Technologies", released under the N-ATLaS Terms of Use
(<https://huggingface.co/NCAIR1/N-ATLaS>). This SDK only ever calls an N-ATLaS endpoint you configure; it bundles
no model and calls no other provider.
