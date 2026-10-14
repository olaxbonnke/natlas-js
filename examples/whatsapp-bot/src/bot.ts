import {
  LANGUAGES,
  NAtlasAuthError,
  NAtlasConnectionError,
  NAtlasModelLoadingError,
  NAtlasTimeoutError,
  type NAtlas,
} from "@olaxbonnke/natlas-js";
import { parseCommand } from "./commands.js";
import { ConversationStore } from "./memory.js";

export interface BotOptions {
  natlas: NAtlas;
  store?: ConversationStore;
  /** Shown in /help. */
  name?: string;
}

export interface ReplyOptions {
  /** Called with the growing reply while N-ATLaS streams (Telegram edits its message with it). */
  onPartial?: (text: string) => void;
}

export function helpText(name = "N-ATLaS bot"): string {
  return [
    `👋 ${name}: chat with N-ATLaS, Nigeria's multilingual LLM, in English, Yorùbá, Hausa or Igbo.`,
    "",
    "Just send a message to chat. Commands:",
    "/lang yo: always reply in Yoruba (en, yo, ha, ig; /lang off to undo)",
    "/translate ha Good morning: translate text (or /translate en:ig ...)",
    "/reset: forget our conversation",
    "/help: this message",
    "",
    "Báwo ni! · Sannu! · Kedụ!",
  ].join("\n");
}

/** A user-facing message for an SDK error. */
export function friendlyError(e: unknown): string {
  if (e instanceof NAtlasConnectionError) {
    return "⚠️ The N-ATLaS server is offline right now (the free GPU notebook may be asleep). Please try again later.";
  }
  if (e instanceof NAtlasModelLoadingError) return "⏳ N-ATLaS is still loading. Try again in a minute.";
  if (e instanceof NAtlasTimeoutError) return "⌛ N-ATLaS took too long to answer. Please try a shorter message.";
  if (e instanceof NAtlasAuthError) return "🔒 The bot's N-ATLaS API key was rejected. Ask the bot owner to check NATLAS_API_KEY.";
  return `Sorry, something went wrong: ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Transport-agnostic bot logic: turns one incoming text from one user into a
 * reply string. WhatsApp and Telegram adapters just move text in and out.
 */
export function createBot({ natlas, store = new ConversationStore(), name }: BotOptions) {
  async function reply(userId: string, text: string, opts: ReplyOptions = {}): Promise<string> {
    const cmd = parseCommand(text);
    switch (cmd.kind) {
      case "help":
        return helpText(name);
      case "reset":
        store.reset(userId);
        return "🧹 Conversation cleared.";
      case "unknown":
        return `Unknown command /${cmd.command}. Send /help to see what I can do.`;
      case "invalid":
        return cmd.message;
      case "lang": {
        if (cmd.lang === undefined) {
          const cur = store.get(userId).lang;
          return cur
            ? `I'm replying in ${LANGUAGES[cur].name} (${LANGUAGES[cur].nativeName}). /lang off to undo.`
            : "No reply language set: I answer in the language you write in. Try /lang yo";
        }
        if (cmd.lang === null) {
          store.setLang(userId, undefined);
          return "OK, I'll answer in the language you write in.";
        }
        store.setLang(userId, cmd.lang);
        const info = LANGUAGES[cmd.lang];
        return `✅ I'll reply in ${info.name} (${info.nativeName}). ${info.greeting}`;
      }
      case "translate": {
        try {
          const r = await natlas.translate(cmd.text, { to: cmd.to, from: cmd.from ?? "auto" });
          return r.text;
        } catch (e) {
          return friendlyError(e);
        }
      }
      case "chat": {
        if (!cmd.text) return helpText(name);
        const convo = store.get(userId);
        const history = [...convo.messages, { role: "user" as const, content: cmd.text }];
        try {
          let answer = "";
          if (opts.onPartial) {
            for await (const chunk of natlas.chatStream(history, { replyIn: convo.lang, maxTokens: 512 })) {
              answer = chunk.text;
              opts.onPartial(answer);
            }
          } else {
            answer = (await natlas.chat(history, { replyIn: convo.lang, maxTokens: 512 })).content;
          }
          answer = answer.trim() || "…";
          store.append(userId, { role: "user", content: cmd.text }, { role: "assistant", content: answer });
          return answer;
        } catch (e) {
          return friendlyError(e);
        }
      }
    }
  }

  return { reply, store };
}

export type Bot = ReturnType<typeof createBot>;

/** Split text into chunks no longer than `max`, preferring line and word breaks. */
export function splitMessage(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
