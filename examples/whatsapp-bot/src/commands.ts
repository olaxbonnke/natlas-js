import { normalizeLanguage, type LanguageCode } from "@olaxbonnke/natlas-js";

/** A parsed chat message: either a bot command or plain text for N-ATLaS. */
export type Command =
  | { kind: "help" }
  | { kind: "reset" }
  /** `lang: undefined` shows the current language, `null` clears it. */
  | { kind: "lang"; lang: LanguageCode | null | undefined }
  | { kind: "translate"; to: LanguageCode; from?: LanguageCode; text: string }
  | { kind: "chat"; text: string }
  | { kind: "invalid"; command: string; message: string }
  | { kind: "unknown"; command: string };

export const LANG_USAGE = "Usage: /lang yo  (en, yo, ha, ig, or off)";
export const TRANSLATE_USAGE = "Usage: /translate yo Good morning  (or /translate en:ha Good morning)";

/**
 * Parse an incoming text message.
 *
 *   parseCommand("/translate yo Hello")  -> { kind: "translate", to: "yo", text: "Hello" }
 *   parseCommand("/lang hausa")          -> { kind: "lang", lang: "ha" }
 *   parseCommand("Báwo ni?")             -> { kind: "chat", text: "Báwo ni?" }
 *
 * Commands are case-insensitive, accept `!` as well as `/`, and ignore a
 * Telegram-style `@BotName` suffix (`/help@natlas_bot`).
 */
export function parseCommand(input: string): Command {
  const text = (input ?? "").trim();
  const m = /^[/!]([a-zA-Z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return { kind: "chat", text };
  const name = (m[1] ?? "").toLowerCase();
  const rest = (m[2] ?? "").trim();

  switch (name) {
    case "help":
    case "start":
    case "menu":
      return { kind: "help" };
    case "reset":
    case "clear":
    case "new":
      return { kind: "reset" };
    case "lang":
    case "language": {
      if (!rest) return { kind: "lang", lang: undefined };
      if (/^(off|auto|none|any|default)$/i.test(rest)) return { kind: "lang", lang: null };
      const lang = normalizeLanguage(rest);
      if (!lang) return { kind: "invalid", command: "lang", message: `Unsupported language "${rest}". ${LANG_USAGE}` };
      return { kind: "lang", lang };
    }
    case "translate":
    case "tr": {
      const t = /^(\S+)\s+([\s\S]+)$/.exec(rest);
      if (!t) return { kind: "invalid", command: "translate", message: TRANSLATE_USAGE };
      const spec = t[1] ?? "";
      const body = (t[2] ?? "").trim();
      const pair = /^([^:>-]+)(?::|->|>)([^:>-]+)$/.exec(spec);
      const from = pair ? normalizeLanguage(pair[1] ?? "") : undefined;
      const to = normalizeLanguage(pair ? pair[2] ?? "" : spec);
      if (!to || (pair && !from)) {
        return { kind: "invalid", command: "translate", message: `Unsupported language "${spec}". ${TRANSLATE_USAGE}` };
      }
      return from ? { kind: "translate", from, to, text: body } : { kind: "translate", to, text: body };
    }
    default:
      return { kind: "unknown", command: name };
  }
}
