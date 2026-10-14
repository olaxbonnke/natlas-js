import { splitMessage } from "./bot.js";

/** Telegram caps a message at 4096 characters. */
export const TELEGRAM_MAX_TEXT = 4096;

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
}

/** Minimal Telegram Bot API client over fetch: no libraries. */
export class TelegramClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, fetchImpl: typeof fetch = fetch) {
    this.base = `https://api.telegram.org/bot${token}`;
    this.fetchImpl = fetchImpl;
  }

  async call<T>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? `HTTP ${res.status}`}`);
    return json.result as T;
  }

  getMe(): Promise<{ id: number; username?: string; first_name: string }> {
    return this.call("getMe");
  }

  /** Long poll: waits up to `timeout` seconds for new updates. */
  getUpdates(offset: number, timeout = 30, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", { offset, timeout, allowed_updates: ["message"] }, signal);
  }

  async sendMessage(chatId: number, text: string, replyTo?: number): Promise<{ message_id: number }> {
    const parts = splitMessage(text, TELEGRAM_MAX_TEXT);
    let first: { message_id: number } | undefined;
    for (const [i, part] of parts.entries()) {
      const sent = await this.call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: part,
        ...(i === 0 && replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
      first ??= sent;
    }
    return first!;
  }

  editMessageText(chatId: number, messageId: number, text: string): Promise<unknown> {
    return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, TELEGRAM_MAX_TEXT) });
  }

  sendChatAction(chatId: number, action: "typing" = "typing"): Promise<unknown> {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  setMyCommands(commands: Array<{ command: string; description: string }>): Promise<unknown> {
    return this.call("setMyCommands", { commands });
  }
}
