import { afterEach, describe, expect, it, vi } from "vitest";
import {
  replyInInstruction,
  DEFAULT_SYSTEM_PROMPT,
  NAtlas,
  NAtlasAbortError,
  NAtlasAPIError,
  NAtlasAuthError,
  NAtlasConnectionError,
  NAtlasModelLoadingError,
  NAtlasRateLimitError,
  NAtlasTimeoutError,
  NAtlasValidationError,
  normalizeBaseUrl,
} from "../src/index.js";
import { completion, deltaEvent, jsonResponse, lastBody, mockFetch, sseResponse } from "./helpers.js";

const BASE = "https://demo.trycloudflare.com";

function client(fetch: ReturnType<typeof mockFetch>, extra: Record<string, unknown> = {}) {
  return new NAtlas({ baseUrl: BASE, fetch, retryDelayMs: 1, ...extra });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("construction", () => {
  it("normalises base URLs", () => {
    expect(normalizeBaseUrl("https://x.trycloudflare.com/")).toBe("https://x.trycloudflare.com");
    expect(normalizeBaseUrl(" https://x.trycloudflare.com/v1/ ")).toBe("https://x.trycloudflare.com");
    expect(normalizeBaseUrl("/api")).toBe("/api");
  });

  it("reads NATLAS_BASE_URL and NATLAS_API_KEY from env", async () => {
    vi.stubEnv("NATLAS_BASE_URL", "https://env.trycloudflare.com/v1");
    vi.stubEnv("NATLAS_API_KEY", "secret");
    const f = mockFetch(jsonResponse(completion("ok")));
    const n = new NAtlas({ fetch: f });
    expect(n.baseUrl).toBe("https://env.trycloudflare.com");
    await n.chat("hi");
    expect(f.mock.calls[0]![0]).toBe("https://env.trycloudflare.com/v1/chat/completions");
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("throws a validation error without a base URL", () => {
    vi.stubEnv("NATLAS_BASE_URL", "");
    expect(() => new NAtlas({ fetch: mockFetch() })).toThrow(NAtlasValidationError);
  });

  it("exposes the language table", () => {
    const n = client(mockFetch());
    expect(Object.keys(n.languages)).toEqual(["en", "yo", "ha", "ig"]);
  });
});

describe("chat()", () => {
  it("posts an OpenAI-compatible body with the default system prompt", async () => {
    const f = mockFetch(jsonResponse(completion("Mo wà dáadáa, ẹ ṣé!")));
    const res = await client(f).chat("Báwo ni?", { temperature: 0.2, maxTokens: 64 });

    expect(res.content).toBe("Mo wà dáadáa, ẹ ṣé!");
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`${BASE}/v1/chat/completions`);
    expect(init!.method).toBe("POST");
    const body = lastBody(f);
    expect(body).toMatchObject({
      model: "n-atlas",
      stream: false,
      temperature: 0.2,
      max_tokens: 64,
      repeat_penalty: 1.12,
    });
    expect(body.messages).toEqual([
      { role: "system", content: `${DEFAULT_SYSTEM_PROMPT}\nThe user is writing in Yoruba. ${replyInInstruction("yo")}` },
      { role: "user", content: "Báwo ni?" },
    ]);
    expect(body).not.toHaveProperty("top_p");
  });

  it("keeps a caller-supplied system message and adds replyIn guidance", async () => {
    const f = mockFetch(jsonResponse(completion("Sannu")));
    await client(f).chat(
      [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      { replyIn: "ha" },
    );
    const { messages } = lastBody(f);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Be brief.");
    expect(messages[0].content).toContain("Hausa");
  });

  it("validates messages", async () => {
    const n = client(mockFetch());
    await expect(n.chat("")).rejects.toBeInstanceOf(NAtlasValidationError);
    await expect(n.chat([])).rejects.toBeInstanceOf(NAtlasValidationError);
    await expect(n.chat([{ role: "robot", content: "x" } as never])).rejects.toBeInstanceOf(NAtlasValidationError);
  });

  it("passes extraBody through", async () => {
    const f = mockFetch(jsonResponse(completion("ok")));
    await client(f).chat("hi", { extraBody: { top_k: 40 } });
    expect(lastBody(f).top_k).toBe(40);
  });
});

describe("errors and retries", () => {
  it("retries 503 and connection failures, then succeeds", async () => {
    const f = mockFetch(
      new TypeError("fetch failed"),
      jsonResponse({ error: { message: "upstream hiccup" } }, 500),
      jsonResponse(completion("E kaabo")),
    );
    const res = await client(f).chat("hi");
    expect(res.content).toBe("E kaabo");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx client errors", async () => {
    const f = mockFetch(jsonResponse({ error: { message: "bad request" } }, 400));
    const err = await client(f).chat("hi").catch((e) => e);
    expect(err).toBeInstanceOf(NAtlasAPIError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("bad request");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to NAtlasAuthError", async () => {
    const f = mockFetch(jsonResponse({ error: { message: "Invalid API Key" } }, 401));
    await expect(client(f).chat("hi")).rejects.toBeInstanceOf(NAtlasAuthError);
  });

  it("maps 429 to NAtlasRateLimitError and honours Retry-After", async () => {
    const f = mockFetch(
      jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" }),
      jsonResponse(completion("ok")),
    );
    await expect(client(f).chat("hi")).resolves.toMatchObject({ content: "ok" });

    const g = mockFetch(jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" }));
    const err = await client(g, { maxRetries: 0 }).chat("hi").catch((e) => e);
    expect(err).toBeInstanceOf(NAtlasRateLimitError);
    expect(err.retryAfterMs).toBe(0);
  });

  it("maps llama.cpp 'Loading model' to NAtlasModelLoadingError", async () => {
    const f = mockFetch(jsonResponse({ error: { code: 503, message: "Loading model" } }, 503));
    await expect(client(f, { maxRetries: 0 }).chat("hi")).rejects.toBeInstanceOf(NAtlasModelLoadingError);
  });

  it("maps a dead Cloudflare tunnel (530) to NAtlasConnectionError", async () => {
    const f = mockFetch(new Response("<html>Error 1033</html>", { status: 530 }));
    const err = await client(f, { maxRetries: 0 }).chat("hi").catch((e) => e);
    expect(err).toBeInstanceOf(NAtlasConnectionError);
    expect(err.message).toMatch(/offline/);
  });

  it("gives up after maxRetries", async () => {
    const f = mockFetch(new TypeError("ECONNREFUSED"), new TypeError("ECONNREFUSED"));
    await expect(client(f, { maxRetries: 1 }).chat("hi")).rejects.toBeInstanceOf(NAtlasConnectionError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("times out slow requests", async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const n = new NAtlas({ baseUrl: BASE, fetch: hang, timeoutMs: 20, maxRetries: 0 });
    await expect(n.chat("hi")).rejects.toBeInstanceOf(NAtlasTimeoutError);
  });

  it("respects a caller AbortSignal and does not retry", async () => {
    const ac = new AbortController();
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const n = new NAtlas({ baseUrl: BASE, fetch: hang, maxRetries: 3 });
    const p = n.chat("hi", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(NAtlasAbortError);
    expect(hang).toHaveBeenCalledTimes(1);
  });
});

describe("chatStream()", () => {
  it("yields deltas from SSE, handling events split across chunks", async () => {
    const e1 = deltaEvent("Ẹ ");
    const e2 = deltaEvent("kú ");
    const e3 = deltaEvent("àárọ̀", "stop");
    const f = mockFetch(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
        e1.slice(0, 10),
        e1.slice(10) + ": keep-alive\n\n" + e2,
        e3,
        "data: [DONE]\n\n",
      ]),
    );
    const chunks = [];
    const gen = client(f).chatStream("Good morning in Yoruba?");
    for await (const c of gen) chunks.push(c);
    expect(chunks.map((c) => c.delta)).toEqual(["Ẹ ", "kú ", "àárọ̀"]);
    expect(chunks.at(-1)!.text).toBe("Ẹ kú àárọ̀");
    expect(chunks.at(-1)!.finishReason).toBe("stop");
    expect(lastBody(f).stream).toBe(true);
  });

  it("handles CRLF line endings", async () => {
    const f = mockFetch(sseResponse([deltaEvent("Sannu").replace(/\n/g, "\r\n"), "data: [DONE]\r\n\r\n"]));
    const out: string[] = [];
    for await (const c of client(f).chatStream("hi")) out.push(c.delta);
    expect(out).toEqual(["Sannu"]);
  });

  it("throws on an in-stream error event", async () => {
    const f = mockFetch(sseResponse([deltaEvent("Ke"), `data: ${JSON.stringify({ error: { code: 500, message: "boom" } })}\n\n`]));
    const run = async () => {
      for await (const _ of client(f).chatStream("hi")) {
        /* consume */
      }
    };
    await expect(run()).rejects.toThrow("boom");
  });

  it("falls back when the server ignores stream=true", async () => {
    const f = mockFetch(jsonResponse(completion("Kedụ")));
    const out: string[] = [];
    for await (const c of client(f).chatStream("hi")) out.push(c.delta);
    expect(out).toEqual(["Kedụ"]);
  });

  it("surfaces HTTP errors before streaming starts", async () => {
    const f = mockFetch(jsonResponse({ error: { message: "Invalid API Key" } }, 401));
    const run = async () => {
      for await (const _ of client(f).chatStream("hi")) {
        /* consume */
      }
    };
    await expect(run()).rejects.toBeInstanceOf(NAtlasAuthError);
  });
});

describe("health()", () => {
  it("reports online", async () => {
    const f = mockFetch(jsonResponse({ status: "ok" }));
    const h = await client(f).health();
    expect(h).toMatchObject({ status: "online", ok: true, httpStatus: 200 });
    expect(f.mock.calls[0]![0]).toBe(`${BASE}/health`);
  });

  it("reports loading while llama.cpp loads weights", async () => {
    const f = mockFetch(jsonResponse({ error: { code: 503, message: "Loading model" } }, 503));
    expect((await client(f).health()).status).toBe("loading");
  });

  it("falls back to /v1/models when /health is missing (llama-cpp-python)", async () => {
    const f = mockFetch(jsonResponse({ detail: "Not Found" }, 404), jsonResponse({ data: [{ id: "n-atlas" }] }));
    const h = await client(f).health();
    expect(h.status).toBe("online");
    expect(f.mock.calls[1]![0]).toBe(`${BASE}/v1/models`);
  });

  it("reports offline without throwing", async () => {
    const f = mockFetch(new TypeError("getaddrinfo ENOTFOUND"));
    const h = await client(f).health();
    expect(h.status).toBe("offline");
    expect(h.ok).toBe(false);
  });

  it("reports unauthorized", async () => {
    const f = mockFetch(jsonResponse({ error: "Unauthorized" }, 401));
    expect((await client(f).health()).status).toBe("unauthorized");
  });
});

describe("models()", () => {
  it("lists models", async () => {
    const f = mockFetch(jsonResponse({ object: "list", data: [{ id: "N-ATLaS.Q4_K_M.gguf" }] }));
    expect(await client(f).models()).toEqual([{ id: "N-ATLaS.Q4_K_M.gguf" }]);
  });
});

import { detectLanguage } from "../src/index.js";
describe("detectLanguage (auto reply language)", () => {
  it("spots unaccented Yoruba, Hausa and Igbo", () => {
    expect(detectLanguage("bawo ni")).toBe("yo");
    expect(detectLanguage("e kaale sir")).toBe("yo");
    expect(detectLanguage("kini ago")).toBe("yo");
    expect(detectLanguage("Kí ni olú ìlú Nàìjíríà?")).toBe("yo");
    expect(detectLanguage("Sannu, yaya kake?")).toBe("ha");
    expect(detectLanguage("Kedu ka ị mere?")).toBe("ig");
    expect(detectLanguage("hi")).toBe("en");
    expect(detectLanguage("What is the capital of Nigeria?")).toBe("en");
  });
});
