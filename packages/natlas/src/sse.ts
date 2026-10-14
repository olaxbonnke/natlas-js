/**
 * Minimal Server-Sent Events parser for OpenAI-style streaming responses.
 * Works with any WHATWG ReadableStream<Uint8Array> (Node 18+, browsers, edge).
 */

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let eventId: string | undefined;

  const flush = (): SSEEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return undefined;
    }
    const evt: SSEEvent = { data: dataLines.join("\n") };
    if (eventName) evt.event = eventName;
    if (eventId) evt.id = eventId;
    dataLines = [];
    eventName = undefined;
    return evt;
  };

  const handleLine = (line: string): SSEEvent | undefined => {
    if (line === "") return flush();
    if (line.startsWith(":")) return undefined; // comment / keep-alive
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value;
    else if (field === "id") eventId = value;
    return undefined;
  };

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, nl);
        const sepLen = buffer.startsWith("\r\n", nl) ? 2 : 1;
        buffer = buffer.slice(nl + sepLen);
        const evt = handleLine(line);
        if (evt) yield evt;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const evt = handleLine(buffer);
      if (evt) yield evt;
    }
    const last = flush();
    if (last) yield last;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    reader.releaseLock?.();
  }
}
