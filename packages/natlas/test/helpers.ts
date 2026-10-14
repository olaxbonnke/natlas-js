import { vi } from "vitest";

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function completion(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "n-atlas",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...extra,
  };
}

/** Build an SSE response; `chunks` are raw strings so tests can split mid-event. */
export function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

export function deltaEvent(content: string, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  })}\n\n`;
}

/** A mocked fetch that replays the given responses (or functions) in order. */
export function mockFetch(...responses: Array<Response | Error | (() => Response | Promise<Response>)>) {
  const queue = [...responses];
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error("mockFetch: no more responses queued");
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
}

export function lastBody(fetchMock: ReturnType<typeof mockFetch>, call = -1): any {
  const calls = fetchMock.mock.calls;
  const c = calls.at(call);
  return JSON.parse(String(c?.[1]?.body));
}
