import type { ChatMessage, LanguageCode } from "@olaxbonnke/natlas-js";

export interface Conversation {
  messages: ChatMessage[];
  lang?: LanguageCode;
  updatedAt: number;
}

export interface MemoryOptions {
  /** Messages kept per user (user + assistant). Default 20 (10 turns). */
  maxMessages?: number;
  /** Forget users idle longer than this. Default 6 hours. */
  ttlMs?: number;
  /** Cap on users held at once; the least recently active is evicted. Default 1000. */
  maxUsers?: number;
  now?: () => number;
}

/**
 * Per-user conversation memory, held in process memory. Good for a demo; it
 * resets on restart and is per-instance on serverless hosts.
 */
export class ConversationStore {
  private readonly map = new Map<string, Conversation>();
  private readonly maxMessages: number;
  private readonly ttlMs: number;
  private readonly maxUsers: number;
  private readonly now: () => number;

  constructor(opts: MemoryOptions = {}) {
    this.maxMessages = opts.maxMessages ?? 20;
    this.ttlMs = opts.ttlMs ?? 6 * 60 * 60 * 1000;
    this.maxUsers = opts.maxUsers ?? 1000;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.map.size;
  }

  get(userId: string): Conversation {
    const existing = this.map.get(userId);
    if (existing && this.now() - existing.updatedAt <= this.ttlMs) {
      // refresh LRU position
      this.map.delete(userId);
      this.map.set(userId, existing);
      return existing;
    }
    const fresh: Conversation = { messages: [], lang: existing?.lang, updatedAt: this.now() };
    this.map.delete(userId);
    this.map.set(userId, fresh);
    while (this.map.size > this.maxUsers) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return fresh;
  }

  append(userId: string, ...messages: ChatMessage[]): void {
    const c = this.get(userId);
    c.messages.push(...messages);
    if (c.messages.length > this.maxMessages) c.messages.splice(0, c.messages.length - this.maxMessages);
    c.updatedAt = this.now();
  }

  setLang(userId: string, lang: LanguageCode | undefined): void {
    const c = this.get(userId);
    c.lang = lang;
    c.updatedAt = this.now();
  }

  reset(userId: string): void {
    const c = this.get(userId);
    c.messages = [];
    c.updatedAt = this.now();
  }
}
