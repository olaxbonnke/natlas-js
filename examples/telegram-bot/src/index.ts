/**
 * natlas-js Telegram bot (long polling: no public URL, no webhook, runs anywhere).
 *   TELEGRAM_BOT_TOKEN=... NATLAS_BASE_URL=... npm run build && npm start
 */
import { NAtlas } from "@olaxbonnke/natlas-js";
import { createBot } from "./bot.js";
import { TelegramClient, type TelegramUpdate } from "./telegram.js";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Create a bot with @BotFather and set it (see .env.example).");
  process.exit(1);
}
if (!process.env.NATLAS_BASE_URL?.trim()) {
  console.error("Missing NATLAS_BASE_URL: the URL of your N-ATLaS server (see server/ in the repo root).");
  process.exit(1);
}

const tg = new TelegramClient(token);
const natlas = new NAtlas(); // reads NATLAS_BASE_URL / NATLAS_API_KEY
const bot = createBot({ natlas, name: "N-ATLaS on Telegram" });
/** How often the streaming reply message is edited (Telegram rate-limits edits). */
const EDIT_EVERY_MS = 1200;

/** One queue per chat so replies stay in order, while different chats run in parallel. */
const queues = new Map<number, Promise<void>>();

async function handle(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) {
    if (msg) await tg.sendMessage(msg.chat.id, "I can only read text messages. Send /help to see what I can do.");
    return;
  }
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id ?? chatId);
  const typing = setInterval(() => tg.sendChatAction(chatId).catch(() => undefined), 4500);
  await tg.sendChatAction(chatId).catch(() => undefined);

  // Stream the answer into one message by editing it as tokens arrive.
  let placeholder: number | undefined;
  let lastEdit = 0;
  let lastText = "";
  let editing: Promise<unknown> = Promise.resolve();
  const onPartial = (text: string) => {
    const now = Date.now();
    if (!text.trim() || now - lastEdit < EDIT_EVERY_MS) return;
    lastEdit = now;
    editing = editing.then(async () => {
      try {
        if (placeholder === undefined) placeholder = (await tg.sendMessage(chatId, `${text} …`, msg.message_id)).message_id;
        else await tg.editMessageText(chatId, placeholder, `${text} …`);
        lastText = `${text} …`;
      } catch {
        /* edit races / rate limits are harmless */
      }
    });
  };

  try {
    const answer = await bot.reply(userId, msg.text, { onPartial });
    await editing;
    if (placeholder === undefined) await tg.sendMessage(chatId, answer, msg.message_id);
    else if (answer !== lastText) {
      if (answer.length <= 4096) await tg.editMessageText(chatId, placeholder, answer).catch(() => undefined);
      else await tg.sendMessage(chatId, answer);
    }
  } finally {
    clearInterval(typing);
  }
}

async function main(): Promise<void> {
  const me = await tg.getMe();
  await tg
    .setMyCommands([
      { command: "help", description: "What this bot can do" },
      { command: "lang", description: "Reply language: /lang yo | ha | ig | en | off" },
      { command: "translate", description: "/translate yo Good morning" },
      { command: "reset", description: "Forget our conversation" },
    ])
    .catch(() => undefined);
  const health = await natlas.health();
  console.log(`@${me.username} is running (long polling). N-ATLaS server: ${health.status}. Ctrl+C to stop.`);

  let offset = 0;
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());

  while (!stop.signal.aborted) {
    let updates: TelegramUpdate[] = [];
    try {
      updates = await tg.getUpdates(offset, 30, stop.signal);
    } catch (e) {
      if (stop.signal.aborted) break;
      console.error("[telegram-bot] getUpdates failed, retrying in 3s:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const chatId = u.message?.chat.id ?? 0;
      const prev = queues.get(chatId) ?? Promise.resolve();
      const next = prev
        .then(() => handle(u))
        .catch((e) => console.error("[telegram-bot] failed to handle update", u.update_id, e));
      queues.set(chatId, next);
      void next.finally(() => {
        if (queues.get(chatId) === next) queues.delete(chatId);
      });
    }
  }
  console.log("Stopped.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
