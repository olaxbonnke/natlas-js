# N-ATLaS Playground

Next.js 15 (App Router, TypeScript, Tailwind) playground for N-ATLaS, built on the `natlas-js` SDK.

- **Chat** with token streaming, a "reply in" language picker, temperature / max-token controls and Stop.
- **Translate** between English, Yoruba, Hausa and Igbo (or auto-detect), with swap and copy.
- **Sample prompts** in Yoruba, Hausa, Igbo and English.
- **Live code panel** showing the exact `natlas-js` call (TypeScript), the raw `curl`, and install steps.
- **Endpoint status**: polls `/api/health`; clear "waking up", "offline", "not configured" and "key mismatch" states.

## How it works

The browser uses `natlas-js` with `baseUrl: "/api"`. `app/api/v1/chat/completions/route.ts` is an OpenAI-compatible
relay that validates the request (≤ 40 messages, ≤ 24k chars, `max_tokens` ≤ 1024), rate-limits per IP and forwards
it to `NATLAS_BASE_URL`, adding `NATLAS_API_KEY` server-side. The env var is read on every request, so changing the
tunnel URL in Vercel needs no code change. Only N-ATLaS is ever called.

## Environment

| Variable | Required | |
|---|---|---|
| `NATLAS_BASE_URL` | yes | The `https://….trycloudflare.com` URL printed by the notebook |
| `NATLAS_API_KEY` | no | Same value as the Kaggle `NATLAS_API_KEY` secret, if you set one |
| `NATLAS_RATE_LIMIT_PER_MIN` | no | Requests per IP per minute (default 20) |

## Local development

```bash
# from the repo root
npm install
cp apps/playground/.env.example apps/playground/.env.local
npm run dev
```

## Deploy on Vercel (free)

1. Import the repo on <https://vercel.com/new>.
2. **Root Directory**: `apps/playground`. Framework preset: Next.js (auto).
3. Add `NATLAS_BASE_URL` (and optionally `NATLAS_API_KEY`).
4. Deploy. `npm run build` here first builds the SDK (`prebuild`), then `next build`.
5. New Kaggle session = new URL: update `NATLAS_BASE_URL` and **Redeploy**.
