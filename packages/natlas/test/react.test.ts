// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAtlas, NAtlasAuthError } from "../src/index.js";
import { useNatlas, useTranslate } from "../src/react.js";
import { completion, deltaEvent, jsonResponse, lastBody, mockFetch, sseResponse } from "./helpers.js";

const BASE = "https://demo.trycloudflare.com";

afterEach(() => cleanup());

/** An SSE response whose stream stays open until the request is aborted. */
function hangingStream(first: string, signal?: AbortSignal | null): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(first));
      signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

describe("useNatlas", () => {
  it("streams an assistant reply into messages", async () => {
    const f = mockFetch(sseResponse([deltaEvent("Ẹ "), deltaEvent("káàrọ̀"), deltaEvent("", "stop"), "data: [DONE]\n\n"]));
    const onFinish = vi.fn();
    const onToken = vi.fn();
    const { result } = renderHook(() =>
      useNatlas({ baseUrl: BASE, fetch: f, replyIn: "yo", onFinish, onToken, retryDelayMs: 1 }),
    );
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    let reply: string | undefined;
    await act(async () => {
      reply = await result.current.send("Good morning");
    });

    expect(reply).toBe("Ẹ káàrọ̀");
    expect(result.current.messages).toEqual([
      { role: "user", content: "Good morning" },
      { role: "assistant", content: "Ẹ káàrọ̀" },
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onFinish).toHaveBeenCalledWith({ role: "assistant", content: "Ẹ káàrọ̀" });
    expect(onToken).toHaveBeenCalledTimes(2);

    const body = lastBody(f);
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(/Yoruba/);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Good morning" });
  });

  it("sends the whole conversation as history on the next turn", async () => {
    const f = mockFetch(
      sseResponse([deltaEvent("Sannu!"), "data: [DONE]\n\n"]),
      sseResponse([deltaEvent("Lafiya lau."), "data: [DONE]\n\n"]),
    );
    const { result } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f }));
    await act(async () => {
      await result.current.send("Hi");
    });
    await act(async () => {
      await result.current.send("Yaya kake?", { temperature: 0.2 });
    });
    const body = lastBody(f);
    expect(body.temperature).toBe(0.2);
    expect(body.messages.slice(1)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Sannu!" },
      { role: "user", content: "Yaya kake?" },
    ]);
    expect(result.current.messages).toHaveLength(4);
  });

  it("exposes isLoading / isStreaming while a stream is open and stop() keeps partial text", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => hangingStream(deltaEvent("Kedụ"), init?.signal));
    const onError = vi.fn();
    const { result } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f, onError }));

    let pending!: Promise<string | undefined>;
    act(() => {
      pending = result.current.send("Hello");
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.messages.at(-1)).toEqual({ role: "assistant", content: "Kedụ" });

    await act(async () => {
      result.current.stop();
      await pending;
    });
    await expect(pending).resolves.toBe("Kedụ");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.messages.at(-1)?.content).toBe("Kedụ");
  });

  it("surfaces typed SDK errors and keeps the user's turn", async () => {
    const f = mockFetch(jsonResponse({ error: { message: "Invalid API key" } }, 401));
    const onError = vi.fn();
    const { result } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f, onError }));
    let reply: string | undefined = "x";
    await act(async () => {
      reply = await result.current.send("Hello");
    });
    expect(reply).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(NAtlasAuthError);
    expect(onError).toHaveBeenCalledOnce();
    expect(result.current.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(result.current.isLoading).toBe(false);
  });

  it("reports a missing baseUrl as an error instead of throwing during render", async () => {
    vi.stubEnv("NATLAS_BASE_URL", "");
    const { result } = renderHook(() => useNatlas({ fetch: mockFetch() }));
    await act(async () => {
      await result.current.send("Hello");
    });
    expect(result.current.error?.code).toBe("validation_error");
    vi.unstubAllEnvs();
  });

  it("ignores blank input", async () => {
    const f = mockFetch();
    const { result } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f }));
    await act(async () => {
      expect(await result.current.send("   ")).toBeUndefined();
    });
    expect(f).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("reset() restores initialMessages", async () => {
    const initial = [{ role: "assistant" as const, content: "Báwo ni!" }];
    const f = mockFetch(sseResponse([deltaEvent("Dáadáa"), "data: [DONE]\n\n"]));
    const { result } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f, initialMessages: initial }));
    expect(result.current.messages).toEqual(initial);
    await act(async () => {
      await result.current.send("Ṣé dáadáa ni?");
    });
    expect(result.current.messages).toHaveLength(3);
    act(() => result.current.reset());
    expect(result.current.messages).toEqual(initial);
  });

  it("translate() uses the SDK translator without touching messages", async () => {
    const f = mockFetch(jsonResponse(completion("Ina kwana, uwata")));
    const { result } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f }));
    let out: Awaited<ReturnType<typeof result.current.translate>>;
    await act(async () => {
      out = await result.current.translate("Good morning, mother", { from: "en", to: "ha" });
    });
    expect(out!).toMatchObject({ text: "Ina kwana, uwata", from: "en", to: "ha" });
    expect(result.current.messages).toEqual([]);
    expect(lastBody(f).stream).toBe(false);
  });

  it("accepts an existing client", async () => {
    const f = mockFetch(sseResponse([deltaEvent("ok"), "data: [DONE]\n\n"]));
    const client = new NAtlas({ baseUrl: BASE, fetch: f });
    const { result } = renderHook(() => useNatlas({ client }));
    await act(async () => {
      await result.current.send("ping");
    });
    expect(f.mock.calls[0]?.[0]).toBe(`${BASE}/v1/chat/completions`);
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });

  it("aborts the in-flight request on unmount", async () => {
    let seen: AbortSignal | undefined;
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return hangingStream(deltaEvent("…"), init?.signal);
    });
    const { result, unmount } = renderHook(() => useNatlas({ baseUrl: BASE, fetch: f }));
    let pending!: Promise<string | undefined>;
    act(() => {
      pending = result.current.send("Hello");
    });
    await waitFor(() => expect(f).toHaveBeenCalled());
    unmount();
    await pending;
    expect(seen?.aborted).toBe(true);
  });
});

describe("useTranslate", () => {
  it("translates with defaults", async () => {
    const f = mockFetch(jsonResponse(completion("Ẹ káàrọ̀, màmá")));
    const { result } = renderHook(() => useTranslate({ baseUrl: BASE, fetch: f, defaults: { to: "yo" } }));
    await act(async () => {
      await result.current.translate("Good morning, mother");
    });
    expect(result.current.translation).toBe("Ẹ káàrọ̀, màmá");
    expect(result.current.result).toMatchObject({ to: "yo", from: "auto" });
    expect(result.current.isLoading).toBe(false);
  });

  it("streams a translation when stream: true", async () => {
    const f = mockFetch(sseResponse([deltaEvent("Ụtụtụ "), deltaEvent("ọma"), "data: [DONE]\n\n"]));
    const { result } = renderHook(() => useTranslate({ baseUrl: BASE, fetch: f, stream: true }));
    await act(async () => {
      await result.current.translate("Good morning", { from: "english", to: "igbo" });
    });
    expect(result.current.translation).toBe("Ụtụtụ ọma");
    expect(result.current.result).toMatchObject({ from: "en", to: "ig" });
    expect(lastBody(f).stream).toBe(true);
  });

  it("records validation errors", async () => {
    const { result } = renderHook(() => useTranslate({ baseUrl: BASE, fetch: mockFetch() }));
    await act(async () => {
      await result.current.translate("Hello", { to: "fr" });
    });
    expect(result.current.error?.code).toBe("validation_error");
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});

describe("SSR and build output", () => {
  it("renders on the server without a baseUrl and without touching the network", () => {
    const f = mockFetch();
    function Chat() {
      const { messages, isLoading } = useNatlas({ fetch: f });
      const { translation } = useTranslate({});
      return createElement("p", null, `${messages.length}:${String(isLoading)}:${translation}`);
    }
    expect(renderToString(createElement(Chat))).toBe("<p>0:false:</p>");
    expect(f).not.toHaveBeenCalled();
  });

  it("keeps the 'use client' directive in the source and (when built) the dist entries", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    expect(readFileSync(join(root, "src/react.ts"), "utf8").startsWith('"use client";')).toBe(true);
    for (const file of ["dist/react.js", "dist/react.cjs"]) {
      const path = join(root, file);
      if (!existsSync(path)) continue;
      const head = readFileSync(path, "utf8").split("\n").slice(0, 3).join("\n");
      expect(head).toContain('"use client";');
    }
  });
});
