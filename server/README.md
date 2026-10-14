# Run N-ATLaS for free on a Kaggle GPU (beginner guide)

This guide takes you from **no accounts at all** to a **public N-ATLaS API URL** that the natlas-js SDK and the
playground can call. Nothing here costs money. Plan for about **30 minutes the first time** and about **12 minutes
every time after that** (mostly waiting).

What you end up with:

```
Your browser / app ──HTTPS──▶ https://<random-words>.trycloudflare.com ──tunnel──▶ Kaggle notebook (free T4 GPU)
                                                                                   └─ Ollama (llama.cpp) serving N-ATLaS
```

> **Model and licence.** N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and
> Digital Economy, and powered by Awarri Technologies (with NCAIR/NITDA). It is released under the
> *Terms of Use for N-ATLaS* (research, education, civic and community use; at most 1,000 active end-users per
> 30 days without a commercial licence; no surveillance, disinformation, fraud or military use). Read them on
> https://huggingface.co/NCAIR1/N-ATLaS before you start.

---

## Which model file does the notebook use?

| | |
|---|---|
| Official model | [`NCAIR1/N-ATLaS`](https://huggingface.co/NCAIR1/N-ATLaS): 8B Llama-3 fine-tune, 16 GB of safetensors, **gated** |
| File the notebook serves | [`QuantFactory/N-ATLaS-GGUF`](https://huggingface.co/QuantFactory/N-ATLaS-GGUF) → `N-ATLaS.Q4_K_M.gguf` (4.92 GB) |
| Who made the GGUF | **Community** quantization (QuantFactory, made with llama.cpp from NCAIR1/N-ATLaS). There is no official GGUF from NCAIR/Awarri at the time of writing. |
| Why this one | Most-downloaded N-ATLaS GGUF, ungated, embeds the Llama-3.1 chat template, and Q4_K_M fits a 16 GB T4 with room for an 8k context. |
| Integrity | SHA-256 `71de156e0e6a137319e3b4a159d2a38c06726b6f03067c51c5894ac1596b2c80` (checked by the notebook) |
| Alternative | `tosinamuda/N-ATLaS-GGUF` → `N-ATLaS-GGUF-Q4_K_M.gguf` (same size). Change `MODEL_REPO` / `MODEL_FILE` in cell 1. |

You still accept the official N-ATLaS terms (step 3) because the licence applies to every copy of the weights,
including quantized ones.

---

## Step 1: Create a Hugging Face account

1. Go to <https://huggingface.co/join>.
2. Enter your email and a password, pick a username, and confirm your email (check spam).

## Step 2: Create a Hugging Face "read" token

1. Open <https://huggingface.co/settings/tokens>.
2. Click **Create new token** → choose **Read** → name it `kaggle-natlas` → **Create token**.
3. Copy the token (starts with `hf_`). Keep it private; you will paste it into Kaggle in step 6.

## Step 3: Accept the N-ATLaS terms

1. While signed in, open <https://huggingface.co/NCAIR1/N-ATLaS>.
2. Read the Terms of Use, fill in the short form and click **Agree / Request access**.
3. Access is usually granted automatically. The notebook prints a ✅ when your token can see the official repo.

## Step 4: Create a Kaggle account

1. Go to <https://www.kaggle.com> → **Register** (you can sign up with Google).

## Step 5: Phone-verify Kaggle (this unlocks the free GPU and internet)

1. Open <https://www.kaggle.com/settings> → **Phone verification**.
2. Enter your phone number with its country code (e.g. +234…), then type the SMS code.
3. Without this step, the GPU and Internet switches stay greyed out.

## Step 6: Import the notebook and add your secret

1. Download [`kaggle_natlas_server.ipynb`](./kaggle_natlas_server.ipynb) from this repo (on GitHub: open it → **Download raw file**).
2. On Kaggle click **Create → New Notebook**, then **File → Import Notebook** and choose the file.
3. In the notebook menu open **Add-ons → Secrets → Add a new secret**:
   - Label `HF_TOKEN`, value: the `hf_…` token from step 2. Tick the box to attach it to this notebook.
   - *(Optional)* `NATLAS_API_KEY`: any long random password. If set, only callers that send it can use your URL; put the same value in Vercel.
   - *(Optional)* `NTFY_TOPIC`: a hard-to-guess word, e.g. `natlas-bonnke-7f3k`. The notebook will push the public URL to <https://ntfy.sh/your-topic>, which you can open on your phone. Useful for background runs.

## Step 7: Turn on the GPU and internet

In the right-hand panel (**Settings**, or the ⋮ menu → *Session options* on small screens):

1. **Accelerator** → **GPU T4 x2** (or a single **T4**). Do not pick P100 or TPU.
2. **Internet** → **On**.
3. **Persistence** can stay off.

## Step 8: Run it

1. Click **Run All** (▶▶ at the top, or **Run → Run all**).
2. What happens, cell by cell:

   | Cell | What it does | Typical time |
   |---|---|---|
   | 1 Settings | Picks the model file, the engine and folders | instant |
   | 2 Checks | Confirms the GPU and internet are on, reads optional secrets, posts "started" to ntfy | seconds |
   | 3 Ollama | Installs Ollama (prebuilt CUDA, nothing to compile), pulls `hf.co/QuantFactory/N-ATLaS-GGUF:Q4_K_M`, names it `n-atlas` and loads it on the GPU | 2-4 min |
   | 4 Fallbacks | Defines the llama.cpp fallbacks (CUDA build of `llama-server`, then a prebuilt llama-cpp-python wheel); only used if Ollama fails | instant |
   | 5 Serve | Picks the engine that worked and waits for the OpenAI-compatible API (`:11434` for Ollama, `:8000` for llama.cpp) | seconds |
   | 6 Smoke test | Asks N-ATLaS a question in Yoruba, prints the reply, GPU share and tokens/sec | ~10 s |
   | 7 Tunnel | Starts a free Cloudflare quick tunnel, prints your public URL and pushes it to ntfy | ~10 s |
   | 8 Keep alive | Watches the server and tunnel; prints a heartbeat every minute | runs until you stop it |

3. Look for the box that says **N-ATLaS is live at:** `https://something-something.trycloudflare.com`. That is your API URL.
   It is also saved to `/kaggle/working/natlas_url.txt`.

Test it from any computer:

```bash
curl https://<your-url>.trycloudflare.com/health
NATLAS_BASE_URL=https://<your-url>.trycloudflare.com npx @olaxbonnke/natlas-js "Báwo ni?"
```

## Step 9: Point the playground (Vercel) at your URL

1. On <https://vercel.com>, open your playground project → **Settings → Environment Variables**.
2. Set `NATLAS_BASE_URL` to the URL from step 8 (no trailing slash needed). If you set `NATLAS_API_KEY` on Kaggle, add the same value here.
3. **Deployments** → the latest deployment → **⋯ → Redeploy**. The green "N-ATLaS online" pill appears within a minute.

The URL changes **every time you start a new Kaggle session**, so repeat step 9 each session. No code changes are ever needed.

## Step 10: Stop when you are done

Kaggle gives about **30 GPU hours per week** and ends any session after **12 hours**. To save quota, click **■ Interrupt**
and then **Run → Stop session** (or the power icon). Closing the tab without stopping keeps the GPU busy for up to an hour.

---

## Keeping it running

- **Interactive (default):** keep the browser tab open. Cell 9 is "executing", which stops Kaggle's 20-minute idle timer.
- **Background run:** **Save Version → Save & Run All (Commit)** runs the notebook on Kaggle's servers for up to 12 hours with the tab closed.
  You cannot see the output until it finishes, so set the `NTFY_TOPIC` secret to receive the URL on <https://ntfy.sh>.
- **Colab instead of Kaggle:** upload the same `.ipynb` to <https://colab.research.google.com>, choose **Runtime → Change runtime type → T4 GPU**,
  and add `HF_TOKEN` under the 🔑 **Secrets** panel. Free Colab sessions are shorter and can disconnect when idle.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No GPU found" / GPU option greyed out | Phone-verify (step 5), then Settings → Accelerator → GPU T4. You may have used this week's quota: check *Settings → Quota*. |
| "No internet" | Settings → Internet → On (needs phone verification). |
| Download error 401/403 | Check the `HF_TOKEN` secret is attached to this notebook (Add-ons → Secrets, tick the box) and the token is a *Read* token. |
| Ollama fails to start on the GPU | The notebook automatically falls back to building llama.cpp with CUDA (with the `libcuda` stub fix for the `CUDA::cuda_driver` CMake error), then to a prebuilt llama-cpp-python wheel. To force one, set `NATLAS_BACKEND` / `BACKEND` in cell 1 to `llama-server` or `llama-cpp-python`. |
| `CUDA out of memory` | Lower `CONTEXT` to 4096 or `PARALLEL` to 1 in cell 1, or use `N-ATLaS.Q4_K_S.gguf`. |
| Playground says "Model offline" | The Kaggle session ended or the URL changed. Re-run and update `NATLAS_BASE_URL` (step 9). |
| Playground says "Key mismatch" | `NATLAS_API_KEY` in Vercel differs from the Kaggle secret. |
| `cloudflared did not print a URL` | Re-run cell 8. Quick tunnels are best-effort and occasionally rate-limited. |
| Replies are slow | An 8B Q4 model on a T4 typically streams on the order of 20 tokens/s (not yet benchmarked for this project; measure with `examples/eval`). Lower `max_tokens`, or set `PARALLEL = 1`. |

## Security notes

- Quick-tunnel URLs are random but public. Set `NATLAS_API_KEY` if you share the playground widely; the playground's server route adds the key so browsers never see it.
- The playground proxy caps `max_tokens` at 1,024, limits conversation size and rate-limits each IP.
- Do not send personal data you would not want processed on a shared free GPU. Respect the N-ATLaS Terms of Use (section 7, Data & Privacy).

## Files

- [`kaggle_natlas_server.ipynb`](./kaggle_natlas_server.ipynb): the notebook to import into Kaggle or Colab.
- [`kaggle_natlas_server.py`](./kaggle_natlas_server.py): the same code as a plain script with `# %%` cells (the source of truth; regenerate the notebook with `python3 scripts/py2ipynb.py`).
