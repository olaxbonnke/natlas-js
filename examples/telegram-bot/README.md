# N-ATLaS Telegram bot

A long-polling Telegram bot that chats in **English, Yorùbá, Hausa and Igbo** through
[N-ATLaS](https://huggingface.co/NCAIR1/N-ATLaS), built on [`@olaxbonnke/natlas-js`](../../packages/natlas).
Plain Bot API over `fetch`: no Telegram library, no public URL, no webhook. Free and instant to try.

- replies **stream**: the bot edits its message as N-ATLaS generates tokens (`chatStream()`)
- per-user conversation memory (in process memory: last 10 turns, forgotten after 6 h idle)
- commands: `/help` (`/start`), `/lang ha` (reply language: `en`, `yo`, `ha`, `ig`, or `off`),
  `/translate yo Hello` (or `/translate en:ig ...`), `/reset`
- typing indicator, per-chat ordering, different chats handled in parallel

## Setup in 5 steps

1. **Run N-ATLaS.** Start the free Kaggle server in [`server/`](../../server) and copy its `https://…trycloudflare.com` URL.
2. **Create a bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name, and copy the token.
3. **Build the SDK.** From the repo root: `npm install && npm run build:sdk`.
4. **Configure.** In this folder: `cp .env.example .env` and set `TELEGRAM_BOT_TOKEN`, `NATLAS_BASE_URL` and, if your
   server uses one, `NATLAS_API_KEY`.
5. **Run.** `npm install && npm run dev` (builds, loads `.env`, starts polling). Open your bot in Telegram and send
   "Sannu!" or `/translate ig Good morning`.

To keep it running, use any always-on Node host (Render, Railway, Fly.io, a VPS): `npm run build && npm start` with the
env vars set. Long polling needs a persistent process, so it does not fit serverless functions.

## Files

| File | |
|---|---|
| `src/index.ts` | Polling loop, per-chat queues, streaming message edits |
| `src/telegram.ts` | Minimal Bot API client (`getUpdates`, `sendMessage`, `editMessageText`, ...) |
| `src/bot.ts` | Transport-agnostic bot logic: commands, memory, SDK calls, friendly errors |
| `src/commands.ts` | Command parser (handles `/cmd@YourBot` in groups) |
| `src/memory.ts` | In-memory per-user conversation store (LRU + TTL) |

```bash
npm test        # command parser, bot memory and streaming tests (mocked fetch)
npm run typecheck
```

`src/bot.ts`, `src/commands.ts` and `src/memory.ts` are shared verbatim with [`../whatsapp-bot`](../whatsapp-bot), so
each example stays self-contained.
