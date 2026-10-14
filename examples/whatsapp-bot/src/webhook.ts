import { NAtlas } from "@olaxbonnke/natlas-js";
import { createBot, type Bot } from "./bot.js";
import { loadConfig, type WhatsAppConfig } from "./config.js";
import { WhatsAppClient, extractMessages } from "./whatsapp.js";

export interface WebhookDeps {
  config: WhatsAppConfig;
  bot: Bot;
  whatsapp: Pick<WhatsAppClient, "sendText" | "markRead">;
  log?: (...args: unknown[]) => void;
}

/** Remember recently handled message IDs: Meta re-delivers when a reply is slow. */
class SeenIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 2000) {}
  /** True if this id was already seen. */
  check(id: string): boolean {
    if (this.ids.has(id)) return true;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const first = this.ids.values().next().value;
      if (first !== undefined) this.ids.delete(first);
    }
    return false;
  }
}

async function validSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/**
 * A web-standard (Request -> Response) WhatsApp Cloud API webhook handler.
 * Works on Vercel, Node (see server.ts), Bun, Deno and edge runtimes.
 */
export function createWebhookHandler(deps: WebhookDeps) {
  const seen = new SeenIds();
  const log = deps.log ?? console.log;

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === deps.config.verifyToken && challenge) {
        return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (!mode) return new Response("natlas-js WhatsApp bot is running.", { status: 200 });
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const raw = await req.text();
    if (deps.config.appSecret && !(await validSignature(deps.config.appSecret, raw, req.headers.get("x-hub-signature-256")))) {
      return new Response("Invalid signature", { status: 401 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const { texts, others } = extractMessages(payload);
    // Reply before returning 200: serverless hosts freeze the function after the response.
    await Promise.all([
      ...texts.map(async (m) => {
        if (seen.check(m.id)) return;
        try {
          await deps.whatsapp.markRead(m.id);
          const answer = await deps.bot.reply(m.from, m.text);
          await deps.whatsapp.sendText(m.from, answer, m.id);
        } catch (e) {
          log("[whatsapp-bot] failed to reply", m.id, e);
        }
      }),
      ...others.map(async (m) => {
        if (seen.check(m.id)) return;
        await deps.whatsapp
          .sendText(m.from, "I can only read text messages for now. Send /help to see what I can do.")
          .catch((e) => log("[whatsapp-bot] failed to reply", m.id, e));
      }),
    ]);
    return new Response("EVENT_RECEIVED", { status: 200 });
  };
}

let cached: ((req: Request) => Promise<Response>) | undefined;

/** Handler wired from environment variables (memoized so memory survives across requests). */
export function handlerFromEnv(): (req: Request) => Promise<Response> {
  if (cached) return cached;
  const config = loadConfig();
  const natlas = new NAtlas(); // NATLAS_BASE_URL / NATLAS_API_KEY
  cached = createWebhookHandler({
    config,
    bot: createBot({ natlas, name: "N-ATLaS on WhatsApp" }),
    whatsapp: new WhatsAppClient(config),
  });
  return cached;
}
