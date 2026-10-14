import { splitMessage } from "./bot.js";

/** WhatsApp text messages are capped at 4096 characters. */
export const WHATSAPP_MAX_TEXT = 4096;

export interface GraphClientOptions {
  token: string;
  phoneNumberId: string;
  graphVersion?: string;
  fetch?: typeof fetch;
}

/** Minimal WhatsApp Cloud API client: plain fetch, no SDK. */
export class WhatsAppClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GraphClientOptions) {
    this.endpoint = `https://graph.facebook.com/${opts.graphVersion ?? "v21.0"}/${opts.phoneNumberId}/messages`;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async post(body: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
      throw new Error(`WhatsApp Graph API error: ${msg}`);
    }
    return json;
  }

  /** Send a text reply (split into several messages if longer than 4096 chars). */
  async sendText(to: string, text: string, replyToMessageId?: string): Promise<void> {
    const parts = splitMessage(text, WHATSAPP_MAX_TEXT);
    for (const [i, part] of parts.entries()) {
      await this.post({
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: part, preview_url: false },
        ...(i === 0 && replyToMessageId ? { context: { message_id: replyToMessageId } } : {}),
      });
    }
  }

  /** Mark the incoming message as read (blue ticks) and show a typing indicator. Best effort. */
  async markRead(messageId: string): Promise<void> {
    await this.post({ status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch(() =>
      this.post({ status: "read", message_id: messageId }).catch(() => undefined),
    );
  }
}

export interface IncomingText {
  from: string;
  id: string;
  text: string;
  name?: string;
}

export interface IncomingOther {
  from: string;
  id: string;
  type: string;
}

/** Pull user messages out of a WhatsApp webhook payload (ignores status updates). */
export function extractMessages(payload: unknown): { texts: IncomingText[]; others: IncomingOther[] } {
  const texts: IncomingText[] = [];
  const others: IncomingOther[] = [];
  const p = payload as { object?: string; entry?: Array<{ changes?: Array<{ value?: any }> }> };
  if (!p || p.object !== "whatsapp_business_account") return { texts, others };
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) if (c?.wa_id) names.set(c.wa_id, c.profile?.name);
      for (const m of value.messages ?? []) {
        if (!m?.from || !m?.id) continue;
        if (m.type === "text" && typeof m.text?.body === "string") {
          texts.push({ from: m.from, id: m.id, text: m.text.body, name: names.get(m.from) });
        } else if (m.type === "interactive" && m.interactive?.button_reply?.title) {
          texts.push({ from: m.from, id: m.id, text: m.interactive.button_reply.title, name: names.get(m.from) });
        } else {
          others.push({ from: m.from, id: m.id, type: String(m.type) });
        }
      }
    }
  }
  return { texts, others };
}
