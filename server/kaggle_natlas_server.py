# %% [markdown]
# # N-ATLaS free GPU server (Kaggle / Colab) for natlas-js
#
# This notebook serves **N-ATLaS** (Nigeria's multilingual LLM: Yoruba, Hausa, Igbo, Nigerian English) as an
# **OpenAI-compatible API** (`/v1/chat/completions`) from a free Kaggle T4 GPU, and gives it a public HTTPS URL
# with a free Cloudflare quick tunnel (`*.trycloudflare.com`). Cost: $0.
#
# **Before you run:** Settings → Accelerator → **GPU T4** · Settings → **Internet on** ·
# Add-ons → Secrets → `HF_TOKEN` (your Hugging Face read token). Then **Run All**.
# The public URL is printed near the end. Paste it into Vercel as `NATLAS_BASE_URL`.
#
# Full beginner guide: `server/README.md` in https://github.com/olaxbonnke/natlas-js
#
# *N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital Economy, and
# powered by Awarri Technologies.* Use of the model is governed by the N-ATLaS Terms of Use
# (https://huggingface.co/NCAIR1/N-ATLaS). This notebook (MIT) is part of natlas-js by Bonnke Olaitan.

# %%
# ---------------------------------------------------------------- 1. Settings (edit only if you need to)
import os

# Quantized GGUF of NCAIR1/N-ATLaS. QuantFactory is a COMMUNITY quantization (llama.cpp, Q4_K_M = 4.92 GB),
# not an official NCAIR/Awarri release. It fits easily in one T4 (16 GB VRAM).
# Alternative community repo with the same quant: "tosinamuda/N-ATLaS-GGUF" / "N-ATLaS-GGUF-Q4_K_M.gguf".
MODEL_REPO = os.environ.get("NATLAS_GGUF_REPO", "QuantFactory/N-ATLaS-GGUF")
MODEL_FILE = os.environ.get("NATLAS_GGUF_FILE", "N-ATLaS.Q4_K_M.gguf")
MODEL_SHA256 = "71de156e0e6a137319e3b4a159d2a38c06726b6f03067c51c5894ac1596b2c80"  # of QuantFactory Q4_K_M

PORT = 8000
CONTEXT = 8192          # N-ATLaS is tuned for ~8k tokens
PARALLEL = 2            # simultaneous requests (context is split between them)
GPU_LAYERS = 99         # offload every layer to the GPU
# "llama-server": build llama.cpp's server from source with CUDA (~8-12 min, most robust, has /health)
# "llama-cpp-python": install a prebuilt CUDA wheel (~1-2 min); used automatically if the build fails
BACKEND = os.environ.get("NATLAS_BACKEND", "llama-server")
KEEP_ALIVE_HOURS = 11.5  # Kaggle stops GPU sessions at 12 h

IN_KAGGLE = os.path.exists("/kaggle")
try:
    import google.colab  # type: ignore  # noqa: F401
    IN_COLAB = True
except ImportError:
    IN_COLAB = False

WORK_DIR = "/tmp/natlas"            # outside /kaggle/working so 5 GB of weights are not saved as output
MODEL_DIR = f"{WORK_DIR}/models"
LOG_DIR = f"{WORK_DIR}/logs"
URL_FILE = "/kaggle/working/natlas_url.txt" if IN_KAGGLE else f"{WORK_DIR}/natlas_url.txt"
for d in (WORK_DIR, MODEL_DIR, LOG_DIR):
    os.makedirs(d, exist_ok=True)
print(f"Platform: {'Kaggle' if IN_KAGGLE else 'Colab' if IN_COLAB else 'other'} | backend: {BACKEND}")

# %%
# ---------------------------------------------------------------- 2. Check the GPU and internet
import subprocess, sys, shutil, urllib.request

def sh(cmd, check=True, quiet=False):
    """Run a shell command, streaming output."""
    print(f"$ {cmd}")
    p = subprocess.run(cmd, shell=True, text=True,
                       stdout=subprocess.PIPE if quiet else None, stderr=subprocess.STDOUT if quiet else None)
    if check and p.returncode != 0:
        if quiet and p.stdout:
            print(p.stdout[-4000:])
        raise RuntimeError(f"Command failed ({p.returncode}): {cmd}")
    return p

gpu = subprocess.run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader", shell=True,
                     capture_output=True, text=True)
if gpu.returncode != 0 or not gpu.stdout.strip():
    raise SystemExit("❌ No GPU found. Kaggle: Settings → Accelerator → GPU T4 x2 (or T4). "
                     "If the option is greyed out, phone-verify your Kaggle account first.")
print("✅ GPU:", gpu.stdout.strip().replace("\n", " | "))

try:
    urllib.request.urlopen("https://huggingface.co", timeout=15)
    print("✅ Internet is on")
except Exception as e:
    raise SystemExit("❌ No internet. Kaggle: Settings → Internet → On (needs a phone-verified account). " + str(e))

# %%
# ---------------------------------------------------------------- 3. Secrets: HF_TOKEN (and optional NATLAS_API_KEY)
def get_secret(name):
    if os.environ.get(name):
        return os.environ[name]
    if IN_KAGGLE:
        try:
            from kaggle_secrets import UserSecretsClient  # type: ignore
            return UserSecretsClient().get_secret(name)
        except Exception:
            return None
    if IN_COLAB:
        try:
            from google.colab import userdata  # type: ignore
            return userdata.get(name)
        except Exception:
            return None
    return None

HF_TOKEN = get_secret("HF_TOKEN")
NATLAS_API_KEY = get_secret("NATLAS_API_KEY")   # optional: protects your public URL
NTFY_TOPIC = get_secret("NTFY_TOPIC") or "natlas-olaxbonnke-1aeb3c69"  # the public URL is also pushed to https://ntfy.sh/<topic>

sh(f"{sys.executable} -m pip install -q -U huggingface_hub", quiet=True)
from huggingface_hub import HfApi, hf_hub_download, login

if HF_TOKEN:
    login(token=HF_TOKEN, add_to_git_credential=False)
    print("✅ Logged in to Hugging Face")
    try:
        HfApi().model_info("NCAIR1/N-ATLaS", token=HF_TOKEN)
        print("✅ Your account has accepted the N-ATLaS terms (NCAIR1/N-ATLaS is accessible)")
    except Exception:
        print("⚠️  Could not open the official NCAIR1/N-ATLaS repo with your token. Please open "
              "https://huggingface.co/NCAIR1/N-ATLaS and accept the Terms of Use. Continuing with the GGUF.")
else:
    print("⚠️  No HF_TOKEN secret found. Add-ons → Secrets → add HF_TOKEN. Trying anonymous download.")
print("API key protection:", "ON" if NATLAS_API_KEY else "off (anyone with the URL can use it)")

# %%
# ---------------------------------------------------------------- 4. Download the N-ATLaS GGUF (~5 GB, 1-3 min)
import hashlib, time

t0 = time.time()
MODEL_PATH = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE, local_dir=MODEL_DIR, token=HF_TOKEN or None)
size_gb = os.path.getsize(MODEL_PATH) / 1e9
print(f"✅ Model at {MODEL_PATH} ({size_gb:.2f} GB) in {time.time() - t0:.0f}s")

if MODEL_REPO == "QuantFactory/N-ATLaS-GGUF" and MODEL_FILE == "N-ATLaS.Q4_K_M.gguf":
    h = hashlib.sha256()
    with open(MODEL_PATH, "rb") as f:
        for block in iter(lambda: f.read(1 << 24), b""):
            h.update(block)
    ok = h.hexdigest() == MODEL_SHA256
    print("✅ SHA-256 verified" if ok else f"⚠️  SHA-256 mismatch: {h.hexdigest()}")

# %%
# ---------------------------------------------------------------- 5. Install the inference server (CUDA)
SERVER_BIN = f"{WORK_DIR}/llama.cpp/build/bin/llama-server"

def build_llama_server():
    if os.path.exists(SERVER_BIN):
        print("✅ llama-server already built")
        return True
    print("Building llama.cpp server with CUDA for the T4 (sm_75). This takes ~8-12 minutes, once per session…")
    try:
        if not shutil.which("cmake"):
            sh(f"{sys.executable} -m pip install -q cmake", quiet=True)
        if not os.path.exists(f"{WORK_DIR}/llama.cpp"):
            sh(f"git clone --depth 1 https://github.com/ggml-org/llama.cpp {WORK_DIR}/llama.cpp", quiet=True)
        cuda = "/usr/local/cuda/bin"
        os.environ["PATH"] = f"{cuda}:{os.environ['PATH']}"
        sh(f"cd {WORK_DIR}/llama.cpp && cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=75 "
           f"-DLLAMA_CURL=OFF -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release",
           quiet=True)
        t = time.time()
        sh(f"cd {WORK_DIR}/llama.cpp && cmake --build build --config Release -j {os.cpu_count() or 4} "
           f"--target llama-server", quiet=True)
        print(f"✅ Built llama-server in {(time.time() - t) / 60:.1f} min")
        return os.path.exists(SERVER_BIN)
    except Exception as e:
        print("⚠️  llama.cpp build failed:", e)
        return False

def install_llama_cpp_python():
    print("Installing prebuilt llama-cpp-python CUDA wheel…")
    for cu in ("cu124", "cu122", "cu121"):
        p = sh(f"{sys.executable} -m pip install -q --prefer-binary 'llama-cpp-python[server]==0.3.4' "
               f"--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/{cu}", check=False, quiet=True)
        if p.returncode == 0:
            check = subprocess.run([sys.executable, "-c",
                                    "import llama_cpp,sys; sys.exit(0 if llama_cpp.llama_supports_gpu_offload() else 3)"])
            if check.returncode == 0:
                print(f"✅ llama-cpp-python ({cu}) with GPU offload")
                return True
            print(f"⚠️  {cu} wheel has no GPU offload, trying next")
    return False

if BACKEND == "llama-server" and build_llama_server():
    ACTIVE_BACKEND = "llama-server"
elif install_llama_cpp_python():
    ACTIVE_BACKEND = "llama-cpp-python"
else:
    raise SystemExit("❌ Could not install a CUDA inference server. See server/README.md → Troubleshooting.")
print("Backend:", ACTIVE_BACKEND)

# %%
# ---------------------------------------------------------------- 6. Start the OpenAI-compatible server on :8000
import json

def local(path, data=None, timeout=10):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {NATLAS_API_KEY}"} if NATLAS_API_KEY else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read() or b"{}")

def start_server():
    log = open(f"{LOG_DIR}/server.log", "ab")
    if ACTIVE_BACKEND == "llama-server":
        cmd = [SERVER_BIN, "-m", MODEL_PATH, "--host", "0.0.0.0", "--port", str(PORT),
               "-ngl", str(GPU_LAYERS), "-c", str(CONTEXT), "--parallel", str(PARALLEL),
               "--alias", "n-atlas", "--jinja"]
        if NATLAS_API_KEY:
            cmd += ["--api-key", NATLAS_API_KEY]
    else:
        cmd = [sys.executable, "-m", "llama_cpp.server", "--model", MODEL_PATH, "--host", "0.0.0.0",
               "--port", str(PORT), "--n_gpu_layers", "-1", "--n_ctx", str(CONTEXT), "--model_alias", "n-atlas"]
        if NATLAS_API_KEY:
            cmd += ["--api_key", NATLAS_API_KEY]
    print("Starting:", " ".join(c if c != NATLAS_API_KEY else "***" for c in cmd))
    return subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)

def wait_until_ready(proc, limit_s=900):
    t = time.time()
    while time.time() - t < limit_s:
        if proc.poll() is not None:
            print(open(f"{LOG_DIR}/server.log", errors="ignore").read()[-3000:])
            raise SystemExit("❌ Server exited. Log above.")
        for path in ("/health", "/v1/models"):
            try:
                status, _ = local(path, timeout=5)
                if status == 200:
                    print(f"✅ N-ATLaS server ready in {time.time() - t:.0f}s")
                    return True
            except Exception:
                pass
        time.sleep(5)
    raise SystemExit("❌ Server did not become ready in time.")

server_proc = start_server()
wait_until_ready(server_proc)

# %%
# ---------------------------------------------------------------- 7. Smoke test in Yoruba (runs on the GPU, not the internet)
t = time.time()
_, out = local("/v1/chat/completions", {
    "model": "n-atlas",
    "messages": [
        {"role": "system", "content": "You are N-ATLaS, a large language model trained by Awarri AI technologies. "
                                      "You are a friendly assistant and you are here to help."},
        {"role": "user", "content": "Báwo ni o ṣe wà? Ṣàlàyé ara rẹ ní gbólóhùn méjì."},
    ],
    "max_tokens": 120, "temperature": 0.2, "repeat_penalty": 1.12,
}, timeout=180)
print(f"N-ATLaS replied in {time.time() - t:.1f}s:\n")
print(out["choices"][0]["message"]["content"])

# %%
# ---------------------------------------------------------------- 8. Public URL with a free Cloudflare quick tunnel
import re, threading

CLOUDFLARED = f"{WORK_DIR}/cloudflared"
if not os.path.exists(CLOUDFLARED):
    arch = "arm64" if os.uname().machine in ("aarch64", "arm64") else "amd64"
    urllib.request.urlretrieve(
        f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}", CLOUDFLARED)
    os.chmod(CLOUDFLARED, 0o755)
print(subprocess.run([CLOUDFLARED, "--version"], capture_output=True, text=True).stdout.strip())

PUBLIC_URL = None

def start_tunnel():
    global PUBLIC_URL
    proc = subprocess.Popen([CLOUDFLARED, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    found = threading.Event()
    log = open(f"{LOG_DIR}/cloudflared.log", "a")

    def reader():
        global PUBLIC_URL
        for line in proc.stdout:  # keep draining so the pipe never blocks
            log.write(line); log.flush()
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m and not found.is_set():
                PUBLIC_URL = m.group(0)
                found.set()

    threading.Thread(target=reader, daemon=True).start()
    if not found.wait(90):
        raise SystemExit("❌ cloudflared did not print a URL. Check internet, then re-run this cell.")
    return proc

def announce(url):
    with open(URL_FILE, "w") as f:
        f.write(url + "\n")
    bar = "=" * 72
    print(f"\n{bar}\n  N-ATLaS is live at:\n\n      {url}\n\n"
          f"  OpenAI-compatible endpoint: {url}/v1/chat/completions\n"
          f"  → Vercel: Settings → Environment Variables → NATLAS_BASE_URL = {url}\n"
          f"    (then Deployments → ⋯ → Redeploy). Keep this tab open.\n{bar}\n")
    if NTFY_TOPIC:
        try:
            urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{NTFY_TOPIC}", data=url.encode(),
                                                          headers={"Title": "N-ATLaS URL"}), timeout=10)
            print(f"📣 URL sent to https://ntfy.sh/{NTFY_TOPIC}")
        except Exception as e:
            print("ntfy failed:", e)

tunnel_proc = start_tunnel()
# DNS for a fresh quick tunnel can take a few seconds to propagate
for _ in range(24):
    try:
        with urllib.request.urlopen(PUBLIC_URL + "/v1/models" if ACTIVE_BACKEND != "llama-server" else PUBLIC_URL + "/health",
                                    timeout=10) as r:
            if r.status == 200:
                break
    except Exception as e:
        if "401" in str(e):  # API key enabled: the tunnel works, auth is just required
            break
    time.sleep(5)
announce(PUBLIC_URL)

# %%
# ---------------------------------------------------------------- 9. Keep alive (leave this running)
# Kaggle keeps an interactive GPU session alive while a cell is running and the tab is open (max 12 h,
# 30 GPU-hours per week). This loop watches the server and the tunnel and restarts either if it dies.
# To stop: click ■ (Interrupt) then Run → "Stop session" so you don't waste GPU quota.
started = time.time()
try:
    while time.time() - started < KEEP_ALIVE_HOURS * 3600:
        time.sleep(60)
        if server_proc.poll() is not None:
            print("⚠️  Server stopped; restarting…")
            server_proc = start_server()
            wait_until_ready(server_proc)
        if tunnel_proc.poll() is not None:
            print("⚠️  Tunnel stopped; starting a new one (the URL WILL change)…")
            tunnel_proc = start_tunnel()
            announce(PUBLIC_URL)
        try:
            status, _ = local("/health" if ACTIVE_BACKEND == "llama-server" else "/v1/models", timeout=10)
            state = "healthy" if status == 200 else f"HTTP {status}"
        except Exception as e:
            state = f"busy/unreachable ({type(e).__name__})"
        up = (time.time() - started) / 3600
        print(f"[{time.strftime('%H:%M:%S')}] up {up:.1f} h · server {state} · {PUBLIC_URL}", flush=True)
except KeyboardInterrupt:
    print("Stopping…")
finally:
    for p in (tunnel_proc, server_proc):
        try:
            p.terminate()
        except Exception:
            pass
    print("Stopped. Remember to stop the Kaggle session to save GPU quota.")
