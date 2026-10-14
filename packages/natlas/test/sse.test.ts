import { describe, expect, it } from "vitest";
import { parseSSE } from "../src/index.js";

function stream(parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

async function collect(parts: string[]) {
  const out = [];
  for await (const e of parseSSE(stream(parts))) out.push(e);
  return out;
}

describe("parseSSE", () => {
  it("parses data, event and id fields", async () => {
    const events = await collect(["event: message\nid: 7\ndata: hello\n\n", "data: world\n\n"]);
    expect(events).toEqual([{ event: "message", id: "7", data: "hello" }, { id: "7", data: "world" }]);
  });

  it("joins multi-line data and ignores comments", async () => {
    expect(await collect([": ping\n", "data: a\ndata: b\n\n"])).toEqual([{ data: "a\nb" }]);
  });

  it("handles multi-byte UTF-8 split across chunks", async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode("data: Ẹ kú àárọ̀\n\n");
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7));
        c.enqueue(bytes.slice(7));
        c.close();
      },
    });
    const out = [];
    for await (const e of parseSSE(s)) out.push(e.data);
    expect(out).toEqual(["Ẹ kú àárọ̀"]);
  });

  it("flushes a final event without trailing blank line", async () => {
    expect(await collect(["data: last"])).toEqual([{ data: "last" }]);
  });
});
