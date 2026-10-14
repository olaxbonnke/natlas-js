import { NAtlas } from "@olaxbonnke/natlas-js";
import { describe, expect, it, vi } from "vitest";
import { createBot, splitMessage } from "../src/bot.js";
import { ConversationStore } from "../src/memory.js";

function natlasReplying(...replies: string[]) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: replies.shift() ?? "" }, finish_reason: "stop" }] }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  return { natlas: new NAtlas({ baseUrl: "https://demo.trycloudflare.com", fetch, maxRetries: 0 }), fetch };
}

const body = (f: { mock: { calls: unknown[][] } }, i = -1) =>
  JSON.parse(String((f.mock.calls.at(i) as [string, RequestInit])[1].body));

describe("bot", () => {
  it("keeps per-user memory and applies /lang", async () => {
    const { natlas, fetch } = natlasReplying("Sannu!", "Lafiya lau.");
    const bot = createBot({ natlas });
    expect(await bot.reply("234800", "/lang ha")).toMatch(/Hausa/);
    expect(await bot.reply("234800", "Hello")).toBe("Sannu!");
    expect(await bot.reply("234800", "How are you?")).toBe("Lafiya lau.");
    const sent = body(fetch);
    expect(sent.messages[0].content).toMatch(/Always reply in Hausa/);
    expect(sent.messages.slice(1).map((m: { content: string }) => m.content)).toEqual(["Hello", "Sannu!", "How are you?"]);
    // another user starts fresh
    expect(bot.store.get("234999").messages).toEqual([]);
    expect(await bot.reply("234800", "/reset")).toMatch(/cleared/);
    expect(bot.store.get("234800").messages).toEqual([]);
  });

  it("translates via the SDK", async () => {
    const { natlas, fetch } = natlasReplying("Ẹ káàrọ̀");
    const bot = createBot({ natlas });
    expect(await bot.reply("u", "/translate yo Good morning")).toBe("Ẹ káàrọ̀");
    expect(body(fetch).messages.at(-1).content).toMatch(/Good morning/);
  });

  it("turns SDK errors into friendly replies", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("bad gateway", { status: 530 }));
    const bot = createBot({ natlas: new NAtlas({ baseUrl: "https://x.trycloudflare.com", fetch, maxRetries: 0 }) });
    expect(await bot.reply("u", "Hello")).toMatch(/offline/);
    expect(bot.store.get("u").messages).toEqual([]);
  });

  it("trims memory to maxMessages", () => {
    const store = new ConversationStore({ maxMessages: 4 });
    for (let i = 0; i < 5; i++) store.append("u", { role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` });
    expect(store.get("u").messages.map((m) => m.content)).toEqual(["q3", "a3", "q4", "a4"]);
  });

  it("splits long messages", () => {
    const parts = splitMessage("word ".repeat(2000).trim(), 4096);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
  });
});
