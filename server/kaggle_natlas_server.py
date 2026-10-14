# %% [markdown]
# # N-ATLaS free GPU server (Kaggle / Colab) for natlas-js
#
# This notebook serves **N-ATLaS** (Nigeria's multilingual LLM: Yoruba, Hausa, Igbo, Nigerian English) as an
# **OpenAI-compatible API** (`/v1/chat/completions`, `/v1/models`, streaming SSE) from a free Kaggle T4 GPU, and
# gives it a public HTTPS URL with a free Cloudflare quick tunnel (`*.trycloudflare.com`). Cost: $0.
#
# **Engine:** [Ollama](https://ollama.com) (prebuilt CUDA, nothing to compile). If Ollama cannot start on the GPU,
# the notebook falls back to building llama.cpp's `llama-server` with CUDA, then to a prebuilt llama-cpp-python wheel.
# The model is always served under the name **`n-atlas`**, which is what natlas-js and the playground send.
#
# **Security:** the engine listens on 127.0.0.1 only. A small authenticating reverse proxy on port 8080 sits in
# front of it and is the only thing the tunnel exposes: every request needs `Authorization: Bearer <NATLAS_API_KEY>`
# except `GET /health`. Without the `NATLAS_API_KEY` secret the proxy runs open and prints a loud warning.
#
# **Before you run:** Settings → Accelerator → **GPU T4 x2** (or T4) · Settings → **Internet on**.
# Add-ons → Secrets → `NATLAS_API_KEY` (a long random string; recommended). Optional: `HF_TOKEN` (the GGUF is
# public, so the token is not required) and `NTFY_TOPIC`.
# Then **Run All** (or Save Version → Save & Run All). The public URL is printed near the end and pushed to ntfy.
# Paste it into Vercel as `NATLAS_BASE_URL`, with the same key as `NATLAS_API_KEY`.
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
MODEL_QUANT = "Q4_K_M"
MODEL_SHA256 = "71de156e0e6a137319e3b4a159d2a38c06726b6f03067c51c5894ac1596b2c80"  # of QuantFactory Q4_K_M
MODEL_NAME = "n-atlas"  # the model id natlas-js / the playground send

CONTEXT = 8192          # N-ATLaS is tuned for ~8k tokens (a T4 has plenty of room for it)
PARALLEL = 2            # simultaneous requests
GPU_LAYERS = 99         # llama.cpp fallbacks: offload every layer to the GPU
# "ollama" (default, prebuilt CUDA, ~2 min) → falls back to "llama-server" (build llama.cpp with CUDA, ~10 min)
# → falls back to "llama-cpp-python" (prebuilt CUDA wheel).
BACKEND = os.environ.get("NATLAS_BACKEND", "ollama")
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
print(f"Platform: {'Kaggle' if IN_KAGGLE else 'Colab' if IN_COLAB else 'other'} | preferred backend: {BACKEND}")

# %%
# ---------------------------------------------------------------- 2. Helpers, secrets, GPU and internet check
import subprocess, sys, shutil, urllib.request, json, time

def sh(cmd, check=True, quiet=False, timeout=None):
    """Run a shell command. quiet=True captures output and prints the tail only on failure."""
    print(f"$ {cmd}", flush=True)
    p = subprocess.run(cmd, shell=True, text=True, timeout=timeout,
                       stdout=subprocess.PIPE if quiet else None, stderr=subprocess.STDOUT if quiet else None)
    if check and p.returncode != 0:
        if quiet and p.stdout:
            print(p.stdout[-6000:])
        raise RuntimeError(f"Command failed ({p.returncode}): {cmd}")
    return p

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

HF_TOKEN = get_secret("HF_TOKEN")               # optional: the GGUF is public
NATLAS_API_KEY = (get_secret("NATLAS_API_KEY") or "").strip() or None  # protects the public URL (auth proxy)
NTFY_TOPIC = get_secret("NTFY_TOPIC") or "natlas-olaxbonnke-1aeb3c69"  # status + URL pushed to https://ntfy.sh/<topic>

def notify(message, title="N-ATLaS"):
    """Best-effort push to ntfy so progress and failures are visible without opening the notebook."""
    print(f"[notify] {title}: {message}", flush=True)
    if not NTFY_TOPIC:
        return
    try:
        urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{NTFY_TOPIC}", data=message.encode(),
                                                      headers={"Title": title}), timeout=10)
    except Exception as e:
        print("ntfy failed:", e)

def fail(message):
    notify(message, "N-ATLaS FAILED")
    raise SystemExit("❌ " + message)

gpu = subprocess.run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader", shell=True,
                     capture_output=True, text=True)
if gpu.returncode != 0 or not gpu.stdout.strip():
    fail("No GPU found. Kaggle: Settings → Accelerator → GPU T4 x2 (or T4). "
         "If the option is greyed out, phone-verify your Kaggle account first.")
GPU_NAME = gpu.stdout.strip().replace("\n", " | ")
print("✅ GPU:", GPU_NAME)

try:
    urllib.request.urlopen("https://huggingface.co", timeout=15)
    print("✅ Internet is on")
except Exception as e:
    raise SystemExit("❌ No internet. Kaggle: Settings → Internet → On (needs a phone-verified account). " + str(e))

notify(f"Notebook started on {GPU_NAME}; preferred backend {BACKEND}", "N-ATLaS status")
if NATLAS_API_KEY:
    print("🔒 API key protection: ON (callers must send Authorization: Bearer <NATLAS_API_KEY>)")
else:
    print("!" * 72 + "\n⚠️  WARNING: NATLAS_API_KEY secret not found. The public URL will be OPEN: anyone who\n"
          "   finds it can use your GPU. Add-ons → Secrets → NATLAS_API_KEY, attach it, and re-run.\n" + "!" * 72)

# %%
# ---------------------------------------------------------------- 3. Backend A: Ollama (prebuilt CUDA, no compiling)
OLLAMA_PORT = 11434
OLLAMA_LOG = f"{LOG_DIR}/ollama.log"
ollama_env = {**os.environ,
              "OLLAMA_HOST": f"127.0.0.1:{OLLAMA_PORT}",  # local only: the auth proxy is the public door
              "OLLAMA_KEEP_ALIVE": "-1",            # never unload the model
              "OLLAMA_CONTEXT_LENGTH": str(CONTEXT),
              "OLLAMA_NUM_PARALLEL": str(PARALLEL),
              "OLLAMA_ORIGINS": "*"}

def ollama_api(path, data=None, timeout=30):
    req = urllib.request.Request(f"http://127.0.0.1:{OLLAMA_PORT}{path}",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")

def start_ollama():
    log = open(OLLAMA_LOG, "ab")
    proc = subprocess.Popen(["ollama", "serve"], env=ollama_env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(60):
        if proc.poll() is not None:
            print(open(OLLAMA_LOG, errors="ignore").read()[-3000:])
            raise RuntimeError("ollama serve exited")
        try:
            ollama_api("/api/version", timeout=3)
            return proc
        except Exception:
            time.sleep(1)
    raise RuntimeError("ollama serve did not answer in 60 s")

def ollama_gpu_report():
    """Return (size_vram_fraction, text) for the loaded n-atlas model, from /api/ps and `ollama ps`."""
    frac = 0.0
    try:
        for m in ollama_api("/api/ps").get("models", []):
            if m.get("name", "").split(":")[0] == MODEL_NAME and m.get("size"):
                frac = m.get("size_vram", 0) / m["size"]
    except Exception:
        pass
    text = subprocess.run(["ollama", "ps"], capture_output=True, text=True, env=ollama_env).stdout.strip()
    return frac, text

def setup_ollama():
    if not shutil.which("ollama"):
        # The install script needs zstd to unpack and lspci/lshw to detect the NVIDIA GPU.
        sh("(apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq zstd pciutils lshw) "
           "> /dev/null 2>&1 || true", check=False)
        sh("curl -fsSL https://ollama.com/install.sh | sh", quiet=True, timeout=900)
    print(subprocess.run(["ollama", "--version"], capture_output=True, text=True).stdout.strip())
    proc = start_ollama()
    print("✅ ollama serve is up on :11434")

    t0 = time.time()
    hf_ref = f"hf.co/{MODEL_REPO}:{MODEL_QUANT}"
    pulled = sh(f"ollama pull {hf_ref}", check=False, quiet=True, timeout=1800).returncode == 0
    if pulled:
        sh(f"ollama cp {hf_ref} {MODEL_NAME}", quiet=True)
        sh(f"ollama rm {hf_ref}", check=False, quiet=True)  # keep a single name in /v1/models (blobs stay)
    else:
        print("⚠️  hf.co pull failed; downloading the GGUF and creating the model from a Modelfile")
        sh(f"{sys.executable} -m pip install -q -U huggingface_hub", quiet=True)
        from huggingface_hub import hf_hub_download
        path = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE, local_dir=MODEL_DIR, token=HF_TOKEN or None)
        # Llama-3.1 chat format (N-ATLaS is a Llama-3.1-8B fine-tune).
        modelfile = (
            f"FROM {path}\n"
            'TEMPLATE """{{ if .System }}<|start_header_id|>system<|end_header_id|>\n\n{{ .System }}<|eot_id|>{{ end }}'
            '{{ range .Messages }}<|start_header_id|>{{ .Role }}<|end_header_id|>\n\n{{ .Content }}<|eot_id|>{{ end }}'
            '<|start_header_id|>assistant<|end_header_id|>\n\n"""\n'
            'PARAMETER stop "<|eot_id|>"\nPARAMETER stop "<|start_header_id|>"\nPARAMETER stop "<|end_of_text|>"\n'
            f"PARAMETER num_ctx {CONTEXT}\n")
        with open(f"{WORK_DIR}/Modelfile", "w") as f:
            f.write(modelfile)
        sh(f"ollama create {MODEL_NAME} -f {WORK_DIR}/Modelfile", quiet=True, timeout=1800)
    print(f"✅ Model '{MODEL_NAME}' ready in Ollama in {time.time() - t0:.0f}s")
    print(subprocess.run(["ollama", "list"], capture_output=True, text=True, env=ollama_env).stdout)

    # Load it onto the GPU now (keep_alive -1 keeps it there), then confirm where it sits.
    ollama_api("/api/generate", {"model": MODEL_NAME, "prompt": "", "keep_alive": -1}, timeout=600)
    frac, text = ollama_gpu_report()
    print(text)
    if frac < 0.9:
        print(open(OLLAMA_LOG, errors="ignore").read()[-4000:])
        proc.terminate()
        raise RuntimeError(f"Ollama loaded the model only {frac:.0%} on the GPU")
    print(f"✅ n-atlas is {frac:.0%} on the GPU")
    return proc

# %%
# ---------------------------------------------------------------- 4. Backends B/C: llama.cpp fallbacks (only if Ollama failed)
LLAMA_PORT = 8000
SERVER_BIN = f"{WORK_DIR}/llama.cpp/build/bin/llama-server"
MODEL_PATH = None

def download_gguf():
    global MODEL_PATH
    import hashlib
    sh(f"{sys.executable} -m pip install -q -U huggingface_hub", quiet=True)
    from huggingface_hub import hf_hub_download
    t0 = time.time()
    MODEL_PATH = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE, local_dir=MODEL_DIR, token=HF_TOKEN or None)
    print(f"✅ Model at {MODEL_PATH} ({os.path.getsize(MODEL_PATH) / 1e9:.2f} GB) in {time.time() - t0:.0f}s")
    if MODEL_REPO == "QuantFactory/N-ATLaS-GGUF" and MODEL_FILE == "N-ATLaS.Q4_K_M.gguf":
        h = hashlib.sha256()
        with open(MODEL_PATH, "rb") as f:
            for block in iter(lambda: f.read(1 << 24), b""):
                h.update(block)
        print("✅ SHA-256 verified" if h.hexdigest() == MODEL_SHA256 else f"⚠️  SHA-256 mismatch: {h.hexdigest()}")

def build_llama_server():
    if os.path.exists(SERVER_BIN):
        return True
    print("Building llama.cpp server with CUDA for the T4 (sm_75). ~8-12 minutes…", flush=True)
    try:
        if not shutil.which("cmake"):
            sh(f"{sys.executable} -m pip install -q cmake", quiet=True)
        if not os.path.exists(f"{WORK_DIR}/llama.cpp"):
            sh(f"git clone --depth 1 https://github.com/ggml-org/llama.cpp {WORK_DIR}/llama.cpp", quiet=True)
        cuda = "/usr/local/cuda"
        stubs = f"{cuda}/lib64/stubs"
        os.environ["PATH"] = f"{cuda}/bin:{os.environ['PATH']}"
        # Fix for "Target 'ggml-cuda' links to CUDA::cuda_driver but the target was not found":
        # CMake's FindCUDAToolkit needs libcuda.so, which only exists as a stub at build time.
        if os.path.exists(f"{stubs}/libcuda.so"):
            sh(f"ln -sf {stubs}/libcuda.so {stubs}/libcuda.so.1", check=False)
            os.environ["LIBRARY_PATH"] = f"{stubs}:{os.environ.get('LIBRARY_PATH', '')}"
        else:
            drv = subprocess.run("ldconfig -p | grep -m1 'libcuda.so.1 ' | awk '{print $NF}'", shell=True,
                                 capture_output=True, text=True).stdout.strip()
            if drv:
                os.makedirs(stubs, exist_ok=True)
                sh(f"ln -sf {drv} {stubs}/libcuda.so", check=False)
        sh(f"cd {WORK_DIR}/llama.cpp && cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=75 "
           f"-DCUDAToolkit_ROOT={cuda} -DCMAKE_CUDA_COMPILER={cuda}/bin/nvcc -DCMAKE_LIBRARY_PATH={stubs} "
           f"-DLLAMA_CURL=OFF -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF "
           f"-DCMAKE_BUILD_TYPE=Release", quiet=True)
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
    for ver, cu in (("0.3.4", "cu124"), ("0.3.4", "cu122"), ("0.3.4", "cu121")):
        # --only-binary: never silently compile a CPU-only build from source (that is what made the
        # previous "no GPU offload" check fail on every index).
        p = sh(f"{sys.executable} -m pip install -q --only-binary llama-cpp-python 'llama-cpp-python=={ver}' "
               f"--extra-index-url https://abetlen.github.io/llama-cpp-python/whl/{cu} && "
               f"{sys.executable} -m pip install -q 'uvicorn' 'fastapi' 'sse-starlette' 'starlette-context' "
               f"'pydantic-settings'", check=False, quiet=True)
        if p.returncode != 0:
            print(f"⚠️  no {cu} wheel for this Python; trying next")
            continue
        check = subprocess.run([sys.executable, "-c",
                                "import llama_cpp,sys; sys.exit(0 if llama_cpp.llama_supports_gpu_offload() else 3)"],
                               capture_output=True, text=True)
        if check.returncode == 0:
            print(f"✅ llama-cpp-python ({cu}) with GPU offload")
            return True
        print(f"⚠️  {cu} wheel: no GPU offload ({check.stderr.strip()[-300:]}); trying next")
    return False

def start_llama(active):
    log = open(f"{LOG_DIR}/server.log", "ab")
    if active == "llama-server":
        cmd = [SERVER_BIN, "-m", MODEL_PATH, "--host", "127.0.0.1", "--port", str(LLAMA_PORT),
               "-ngl", str(GPU_LAYERS), "-c", str(CONTEXT), "--parallel", str(PARALLEL),
               "--alias", MODEL_NAME, "--jinja"]
        if NATLAS_API_KEY:  # defence in depth: the proxy checks the key and forwards the same header
            cmd += ["--api-key", NATLAS_API_KEY]
    else:
        cmd = [sys.executable, "-m", "llama_cpp.server", "--model", MODEL_PATH, "--host", "127.0.0.1",
               "--port", str(LLAMA_PORT), "--n_gpu_layers", "-1", "--n_ctx", str(CONTEXT), "--model_alias", MODEL_NAME]
        if NATLAS_API_KEY:
            cmd += ["--api_key", NATLAS_API_KEY]
    print("Starting:", " ".join(c if c != NATLAS_API_KEY else "***" for c in cmd))
    return subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)

# %%
# ---------------------------------------------------------------- 5. Pick a backend and start it
ACTIVE_BACKEND = None
server_proc = None
if BACKEND == "ollama":
    try:
        server_proc = setup_ollama()
        ACTIVE_BACKEND = "ollama"
    except Exception as e:
        print("⚠️  Ollama path failed:", e)
        notify(f"Ollama path failed ({str(e)[:200]}); falling back to llama.cpp", "N-ATLaS status")
if ACTIVE_BACKEND is None:
    download_gguf()
    if build_llama_server():
        ACTIVE_BACKEND = "llama-server"
    elif install_llama_cpp_python():
        ACTIVE_BACKEND = "llama-cpp-python"
    else:
        fail("Could not start any CUDA inference server (Ollama, llama.cpp build, llama-cpp-python wheel).")
    server_proc = start_llama(ACTIVE_BACKEND)
PORT = OLLAMA_PORT if ACTIVE_BACKEND == "ollama" else LLAMA_PORT
HEALTH_PATH = "/health" if ACTIVE_BACKEND == "llama-server" else "/v1/models"
print("Backend:", ACTIVE_BACKEND, "on port", PORT)

def local(path, data=None, timeout=10):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}",
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {NATLAS_API_KEY}"} if NATLAS_API_KEY else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read() or b"{}")

def wait_until_ready(proc, limit_s=900):
    t = time.time()
    while time.time() - t < limit_s:
        if proc.poll() is not None:
            log = OLLAMA_LOG if ACTIVE_BACKEND == "ollama" else f"{LOG_DIR}/server.log"
            print(open(log, errors="ignore").read()[-3000:])
            fail("Server exited. Log above.")
        try:
            status, _ = local(HEALTH_PATH, timeout=5)
            if status == 200:
                print(f"✅ N-ATLaS server ready in {time.time() - t:.0f}s")
                return True
        except Exception:
            pass
        time.sleep(5)
    fail("Server did not become ready in time.")

wait_until_ready(server_proc)
status, models = local("/v1/models")
print("/v1/models →", [m.get("id") for m in models.get("data", [])])

# %%
# ---------------------------------------------------------------- 5b. Authenticating reverse proxy (the only public port)
# aiohttp proxy on 0.0.0.0:8080 → the engine on 127.0.0.1. Requires "Authorization: Bearer <NATLAS_API_KEY>" on every
# path except GET /health, streams responses chunk by chunk (SSE is never buffered), passes status codes through and
# answers CORS preflights. Runs as its own process so the keep-alive loop can restart it.
PROXY_PORT = 8080
PROXY_FILE = f"{WORK_DIR}/natlas_proxy.py"
PROXY_LOG = f"{LOG_DIR}/proxy.log"
PROXY_SRC = r"""
import asyncio, hmac, json, os, sys
from aiohttp import web, ClientSession, ClientTimeout, TCPConnector, ClientError

UPSTREAM = os.environ.get("NATLAS_UPSTREAM", "http://127.0.0.1:11434").rstrip("/")
API_KEY = (os.environ.get("NATLAS_API_KEY") or "").strip()
PORT = int(os.environ.get("NATLAS_PROXY_PORT", "8080"))
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "trailers",
       "transfer-encoding", "upgrade", "host", "content-length"}
CORS = {"Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Requested-With",
        "Access-Control-Max-Age": "86400"}

def jerr(status, code, message):
    return web.json_response({"error": {"message": message, "type": code, "code": code}}, status=status,
                             headers={**CORS, "Cache-Control": "no-store"})

def authorized(request):
    if not API_KEY:
        return True
    auth = request.headers.get("Authorization", "")
    scheme, _, token = auth.partition(" ")
    return scheme.lower() == "bearer" and hmac.compare_digest(token.strip().encode(), API_KEY.encode())

async def handle(request):
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS)
    if request.method in ("GET", "HEAD") and request.path.rstrip("/") == "/health":
        return web.json_response({"status": "ok"}, headers={**CORS, "Cache-Control": "no-store"})
    if not authorized(request):
        return jerr(401, "invalid_api_key", "Missing or invalid API key. Send Authorization: Bearer <NATLAS_API_KEY>.")
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP and k.lower() != "origin"}
    body = await request.read()
    session = request.app["session"]
    try:
        up = await session.request(request.method, UPSTREAM + request.rel_url.raw_path_qs, headers=headers,
                                   data=body if body else None, allow_redirects=False)
    except (ClientError, asyncio.TimeoutError, OSError) as e:
        return jerr(502, "upstream_unavailable", f"N-ATLaS engine is not reachable ({type(e).__name__}).")
    try:
        resp = web.StreamResponse(status=up.status, reason=up.reason)
        for k, v in up.headers.items():
            if k.lower() not in HOP and not k.lower().startswith("access-control-"):
                resp.headers.add(k, v)
        resp.headers.update(CORS)
        resp.headers["X-Accel-Buffering"] = "no"
        resp.headers["Cache-Control"] = up.headers.get("Cache-Control", "no-cache")
        await resp.prepare(request)
        async for chunk in up.content.iter_any():  # forward each chunk as soon as it arrives
            await resp.write(chunk)
        await resp.write_eof()
        return resp
    except (ConnectionResetError, asyncio.CancelledError):
        raise
    finally:
        up.release()

async def on_startup(app):
    app["session"] = ClientSession(connector=TCPConnector(limit=64), auto_decompress=False,
                                   timeout=ClientTimeout(total=None, sock_connect=10, sock_read=900))

async def on_cleanup(app):
    await app["session"].close()

def make_app():
    app = web.Application(client_max_size=32 * 1024 ** 2)
    app.router.add_route("*", "/{tail:.*}", handle)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app

if __name__ == "__main__":
    if not API_KEY:
        print("!" * 72 + "\nWARNING: NATLAS_API_KEY is not set. The proxy is running OPEN (no auth).\n" + "!" * 72,
              flush=True)
    print(f"natlas proxy :{PORT} -> {UPSTREAM} (auth {'ON' if API_KEY else 'OFF'})", flush=True)
    web.run_app(make_app(), host="0.0.0.0", port=PORT, access_log=None, print=None)
"""

try:
    import aiohttp  # noqa: F401  (preinstalled on Kaggle and Colab)
except ImportError:
    sh(f"{sys.executable} -m pip install -q aiohttp", quiet=True)
with open(PROXY_FILE, "w") as f:
    f.write(PROXY_SRC)

def start_proxy():
    env = {**os.environ, "NATLAS_UPSTREAM": f"http://127.0.0.1:{PORT}", "NATLAS_PROXY_PORT": str(PROXY_PORT),
           "NATLAS_API_KEY": NATLAS_API_KEY or ""}
    proc = subprocess.Popen([sys.executable, PROXY_FILE], env=env, stdout=open(PROXY_LOG, "ab"),
                            stderr=subprocess.STDOUT)
    for _ in range(30):
        if proc.poll() is not None:
            print(open(PROXY_LOG, errors="ignore").read()[-3000:])
            fail("Auth proxy exited. Log above.")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PROXY_PORT}/health", timeout=3) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(1)
    fail("Auth proxy did not answer on :8080 in 30 s.")

def proxy_status(path, key=None):
    req = urllib.request.Request(f"http://127.0.0.1:{PROXY_PORT}{path}",
                                 headers={"Authorization": f"Bearer {key}"} if key else {})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

import urllib.error
proxy_proc = start_proxy()
if NATLAS_API_KEY:
    no_key, with_key = proxy_status("/v1/models"), proxy_status("/v1/models", NATLAS_API_KEY)
    print(f"Proxy self-test: no key → {no_key}, with key → {with_key}")
    if no_key != 401 or with_key != 200:
        fail(f"Auth proxy self-test failed (no key {no_key}, with key {with_key}).")
    print("✅ Auth proxy is up on :8080 and refuses requests without the key")
else:
    print("⚠️  Auth proxy is up on :8080 but OPEN (no NATLAS_API_KEY secret)")

# %%
# ---------------------------------------------------------------- 6. Smoke test in Yoruba (runs on the GPU, not the internet)
t = time.time()
_, out = local("/v1/chat/completions", {
    "model": MODEL_NAME,
    "messages": [
        {"role": "system", "content": "You are N-ATLaS, a large language model trained by Awarri AI technologies. "
                                      "You are a friendly assistant and you are here to help."},
        {"role": "user", "content": "Báwo ni o ṣe wà? Ṣàlàyé ara rẹ ní gbólóhùn méjì."},
    ],
    "max_tokens": 120, "temperature": 0.2,
}, timeout=300)
elapsed = time.time() - t
reply = out["choices"][0]["message"]["content"]
ntok = (out.get("usage") or {}).get("completion_tokens") or 0
TOK_PER_S = None
if ACTIVE_BACKEND == "ollama":
    try:  # Ollama's native API reports exact decode speed
        g = ollama_api("/api/generate", {"model": MODEL_NAME, "prompt": "Kọ ọ̀rọ̀ kúkúrú nípa Ìbàdàn.",
                                          "stream": False, "options": {"num_predict": 64}}, timeout=300)
        TOK_PER_S = g["eval_count"] / (g["eval_duration"] / 1e9)
    except Exception as e:
        print("speed probe failed:", e)
if TOK_PER_S is None and ntok:
    TOK_PER_S = ntok / elapsed
WHERE = "GPU"
if ACTIVE_BACKEND == "ollama":
    frac, ps = ollama_gpu_report()
    WHERE = f"{frac:.0%} GPU"
    print(ps)
print(f"N-ATLaS replied in {elapsed:.1f}s ({ntok} tokens; ~{(TOK_PER_S or 0):.1f} tok/s, {WHERE}):\n")
print(reply)
notify(f"Model up via {ACTIVE_BACKEND} on {WHERE} ({GPU_NAME}); ~{(TOK_PER_S or 0):.1f} tok/s. "
       f"Yoruba test: {reply[:160]}", "N-ATLaS status")

# %%
# ---------------------------------------------------------------- 7. Public URL with a free Cloudflare quick tunnel
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
    # The tunnel points at the auth proxy, never at the engine itself.
    cmd = [CLOUDFLARED, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PROXY_PORT}"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
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
        fail("cloudflared did not print a URL. Check internet, then re-run this cell.")
    return proc

def announce(url):
    with open(URL_FILE, "w") as f:
        f.write(url + "\n")
    bar = "=" * 72
    print(f"\n{bar}\n  N-ATLaS is live at:\n\n      {url}\n\n"
          f"  OpenAI-compatible endpoint: {url}/v1/chat/completions  (model: {MODEL_NAME})\n"
          f"  → Vercel: Settings → Environment Variables → NATLAS_BASE_URL = {url}\n"
          f"    {'and NATLAS_API_KEY = the same key as the Kaggle secret' if NATLAS_API_KEY else 'WARNING: no API key, URL is open'}\n"
          f"    (then Deployments → ⋯ → Redeploy). Keep this session running.\n{bar}\n", flush=True)
    notify(url, "N-ATLaS URL")

def wait_public(url):
    for _ in range(24):  # DNS for a fresh quick tunnel can take a few seconds to propagate
        try:
            with urllib.request.urlopen(url + "/health", timeout=10) as r:  # the proxy's open health route
                if r.status == 200:
                    return
        except Exception:
            pass
        time.sleep(5)

tunnel_proc = start_tunnel()
wait_public(PUBLIC_URL)
announce(PUBLIC_URL)

# %%
# ---------------------------------------------------------------- 8. Keep alive (leave this running)
# Kaggle keeps a GPU session alive while a cell is running (max 12 h, 30 GPU-hours per week).
# This loop watches the engine, the auth proxy and the tunnel and restarts any of them if it dies.
# To stop: click ■ (Interrupt) then Run → "Stop session" (or cancel the running version) to save GPU quota.
started = time.time()
try:
    while time.time() - started < KEEP_ALIVE_HOURS * 3600:
        time.sleep(60)
        if server_proc.poll() is not None:
            print("⚠️  Server stopped; restarting…")
            if ACTIVE_BACKEND == "ollama":
                server_proc = start_ollama()
                ollama_api("/api/generate", {"model": MODEL_NAME, "prompt": "", "keep_alive": -1}, timeout=600)
            else:
                server_proc = start_llama(ACTIVE_BACKEND)
            wait_until_ready(server_proc)
        if proxy_proc.poll() is not None:
            print("⚠️  Auth proxy stopped; restarting (the URL stays the same)…")
            proxy_proc = start_proxy()
        if tunnel_proc.poll() is not None:
            print("⚠️  Tunnel stopped; starting a new one (the URL WILL change)…")
            tunnel_proc = start_tunnel()
            wait_public(PUBLIC_URL)
            announce(PUBLIC_URL)
        try:
            status, _ = local(HEALTH_PATH, timeout=10)
            state = "healthy" if status == 200 else f"HTTP {status}"
        except Exception as e:
            state = f"busy/unreachable ({type(e).__name__})"
        up = (time.time() - started) / 3600
        print(f"[{time.strftime('%H:%M:%S')}] up {up:.1f} h · {ACTIVE_BACKEND} {state} · "
              f"proxy {'auth' if NATLAS_API_KEY else 'OPEN'} · {PUBLIC_URL}", flush=True)
except KeyboardInterrupt:
    print("Stopping…")
finally:
    for p in (tunnel_proc, proxy_proc, server_proc):
        try:
            p.terminate()
        except Exception:
            pass
    print("Stopped. Remember to stop the Kaggle session to save GPU quota.")
