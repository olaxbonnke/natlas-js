# N-ATLaS WhatsApp bot

A small WhatsApp Cloud API webhook bot that chats in **English, Yorùbá, Hausa and Igbo** through
[N-ATLaS](https://huggingface.co/NCAIR1/N-ATLaS), built on [`@olaxbonnke/natlas-js`](../../packages/natlas).
TypeScript, no runtime dependencies besides the SDK (plain `fetch` to the Graph API).

- `GET /api/webhook`: Meta's webhook verification (`hub.challenge`)
- `POST /api/webhook`: incoming text, replied to via the Graph API (`/{phone-number-id}/messages`)
- per-user conversation memory (in process memory: last 10 turns, forgotten after 6 h idle)
- commands: `/help`, `/lang ha` (reply language: `en`, `yo`, `ha`, `ig`, or `off`), `/translate yo Hello`
  (or `/translate en:ig ...`), `/reset`
- marks messages read, de-duplicates Meta's re-deliveries, optional `X-Hub-Signature-256` check

## Setup in 5 steps

1. **Run N-ATLaS.** Start the free Kaggle server in [`server/`](../../server) and copy its `https://…trycloudflare.com` URL.
2. **Create a WhatsApp app.** At [developers.facebook.com](https://developers.facebook.com/apps) create an app
   (type *Business*), add **WhatsApp**, and open *WhatsApp > API Setup*. Copy the temporary **access token** and the
   **Phone number ID**, and add your own phone as a test recipient.
3. **Configure.** From the repo root run `npm install && npm run build:sdk`, then in this folder
   `cp .env.example .env` and fill in `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, a `WHATSAPP_VERIFY_TOKEN` of your
   choice, `NATLAS_BASE_URL` and (if your server uses one) `NATLAS_API_KEY`.
4. **Deploy.**
   - *Vercel:* import the repo, set **Root Directory** to `examples/whatsapp-bot`, add the env vars, deploy.
     `vercel.json` installs and builds the SDK from the monorepo. Webhook URL: `https://<app>.vercel.app/api/webhook`.
   - *Any Node host / local:* `npm install && npm run build && npm start` (or `npm run dev` to load `.env`).
     Webhook URL: `https://<host>/webhook`. Locally, expose port 3000 with `cloudflared tunnel --url http://localhost:3000`.
5. **Connect the webhook.** In *WhatsApp > Configuration > Webhook* paste the webhook URL and your verify token, click
   *Verify and save*, then subscribe to the **messages** field. Send "Báwo ni?" or `/help` to your test number.

## Files

| File | |
|---|---|
| `src/webhook.ts` | Web-standard `Request -> Response` handler (verification, signature check, dedupe, replies) |
| `src/bot.ts` | Transport-agnostic bot logic: commands, memory, SDK calls, friendly errors |
| `src/commands.ts` | Command parser (`/help`, `/lang`, `/translate`, `/reset`) |
| `src/memory.ts` | In-memory per-user conversation store (LRU + TTL) |
| `src/whatsapp.ts` | Minimal Graph API client and webhook payload parser |
| `api/webhook.ts` | Vercel function (`GET`/`POST` exports) |
| `src/server.ts` | `node:http` server for any Node host |

```bash
npm test        # command parser, bot memory, webhook tests (mocked fetch)
npm run typecheck
```

## Notes

- Memory lives in the process. On Vercel each warm instance has its own memory and a cold start forgets it; use Redis/KV
  for production.
- The free N-ATLaS server on a T4 can take 10-30 s for long replies. The handler replies before returning `200`
  (serverless hosts freeze after the response) and `maxDuration` is 60 s; duplicates from Meta's retries are ignored.
- Temporary access tokens expire after 24 h; create a System User token for anything longer-lived.
- Business-initiated messages need approved templates; this bot only answers users who message it first (24 h window).
