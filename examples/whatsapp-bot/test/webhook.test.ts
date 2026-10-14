import { NAtlas } from "@olaxbonnke/natlas-js";
import { describe, expect, it, vi } from "vitest";
import { createBot } from "../src/bot.js";
import { createWebhookHandler } from "../src/webhook.js";
import { extractMessages } from "../src/whatsapp.js";

const config = { token: "t", phoneNumberId: "1", verifyToken: "secret-verify", graphVersion: "v21.0" };

function setup() {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: "Báwo ni!" }, finish_reason: "stop" }] }), {
      headers: { "content-type": "application/json" },
    }),
  );
  const whatsapp = {
    sendText: vi.fn(async (_to: string, _text: string, _id?: string) => undefined),
    markRead: vi.fn(async (_id: string) => undefined),
  };
  const bot = createBot({ natlas: new NAtlas({ baseUrl: "https://demo.trycloudflare.com", fetch }) });
  return { handle: createWebhookHandler({ config, bot, whatsapp, log: () => undefined }), whatsapp, fetch };
}

const payload = (text: string, id = "wamid.1") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ wa_id: "2348000000000", profile: { name: "Ada" } }],
            messages: [{ from: "2348000000000", id, type: "text", text: { body: text } }],
          },
        },
      ],
    },
  ],
});

const post = (body: unknown) => new Request("https://bot.dev/api/webhook", { method: "POST", body: JSON.stringify(body) });

describe("webhook", () => {
  it("answers Meta's verification challenge", async () => {
    const { handle } = setup();
    const ok = await handle(new Request("https://bot.dev/api/webhook?hub.mode=subscribe&hub.verify_token=secret-verify&hub.challenge=42"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await handle(new Request("https://bot.dev/api/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"));
    expect(bad.status).toBe(403);
  });

  it("replies to incoming text and de-duplicates re-deliveries", async () => {
    const { handle, whatsapp } = setup();
    expect((await handle(post(payload("Hello")))).status).toBe(200);
    expect((await handle(post(payload("Hello")))).status).toBe(200);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText).toHaveBeenCalledWith("2348000000000", "Báwo ni!", "wamid.1");
  });

  it("handles commands without calling N-ATLaS", async () => {
    const { handle, whatsapp, fetch } = setup();
    await handle(post(payload("/help", "wamid.2")));
    expect(whatsapp.sendText.mock.calls[0]?.[1]).toMatch(/\/translate/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects bad signatures when WHATSAPP_APP_SECRET is set", async () => {
    const { whatsapp } = setup();
    const bot = createBot({ natlas: new NAtlas({ baseUrl: "https://demo.trycloudflare.com", fetch: vi.fn() }) });
    const handle = createWebhookHandler({ config: { ...config, appSecret: "s3cret" }, bot, whatsapp, log: () => undefined });
    const res = await handle(
      new Request("https://bot.dev/api/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body: JSON.stringify(payload("Hello")),
      }),
    );
    expect(res.status).toBe(401);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it("ignores status updates", () => {
    const status = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] };
    expect(extractMessages(status)).toEqual({ texts: [], others: [] });
  });
});
