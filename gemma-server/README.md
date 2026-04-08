# gemma-server

A local LLM server that runs **Gemma 3 12B** and exposes an OpenAI-compatible
`/v1/chat/completions` API — a self-contained drop-in replacement for LM Studio.

Built with [llama-cpp-python](https://github.com/abetlen/llama-cpp-python) and
[FastAPI](https://fastapi.tiangolo.com/). The GGUF model is downloaded
automatically from HuggingFace on first run (~7.5 GB).

## Pre-built binaries (no Python required)

Download the latest binary for your platform from the
[Releases page](https://github.com/jamessanders/reader-extension/releases):

| Platform | Binary |
|---|---|
| Linux x86_64 | `gemma-server-linux-x86_64` |
| macOS Apple Silicon | `gemma-server-macos-arm64` |
| macOS Intel | `gemma-server-macos-x86_64` |

```bash
# Example — Linux
curl -L https://github.com/jamessanders/reader-extension/releases/latest/download/gemma-server-linux-x86_64 \
  -o gemma-server && chmod +x gemma-server

# Run (model downloads on first run if HF_TOKEN is set, or place it manually — see below)
HF_TOKEN=hf_... ./gemma-server
```

All the usual environment variables (`CACHE_DIR`, `MODEL_FILE`, `HF_TOKEN`, etc.) work the same way.
The model cache is stored next to the binary by default.

> The first launch takes a few extra seconds as the binary self-extracts its runtime to `/tmp`.
> Subsequent launches reuse the extracted cache and start immediately.

## Quick start

Gemma 3 is a **gated model** — you need to accept Google's license once before
you can use the weights. There are two ways to get the model file:

### Option A — Auto-download via HuggingFace (recommended)

1. Accept the license at https://huggingface.co/google/gemma-3-12b-it
2. Create a token at https://huggingface.co/settings/tokens

```bash
HF_TOKEN=hf_... bash gemma-server/start.sh
```

Or export it permanently in your shell profile (`~/.zshrc` / `~/.bashrc`):

```bash
export HF_TOKEN=hf_...
```

### Option B — Manual download (~7.5 GB)

Prefer to avoid a token or just want to download the file yourself? After
accepting the license above, download the GGUF directly from your browser:

```
https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF/resolve/main/google_gemma-3-12b-it-Q4_K_M.gguf
```

Then place it at:

```
gemma-server/cache/google_gemma-3-12b-it-Q4_K_M.gguf
```

Create the `cache/` directory first if it doesn't exist (`mkdir -p gemma-server/cache`).
Once the file is in place, run `bash gemma-server/start.sh` — no token needed.

---

The server starts on **http://localhost:5425**. Set the LM Studio URL in the
extension popup to `http://localhost:5425`, then enable the preprocessor.

## Requirements

- Python 3.10+
- ~8 GB free disk space (model download)
- RAM/VRAM: ~8 GB for Q4_K_M; Metal/CUDA layers are used automatically

## Fedora / system-managed llama-cpp-python

If you installed `llama-cpp-python` via your system package manager (e.g. `dnf`)
rather than `pip`, the package lives outside the virtual environment and won't be
found by default. Tell the script to create the venv with `--system-site-packages`:

```bash
GEMMA_SYSTEM_PACKAGES=1 bash start.sh
```

This recreates the venv so it can see system-installed Python packages. If the
venv already exists without this flag it will be removed and rebuilt automatically.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5425` | Server port |
| `CACHE_DIR` | `./cache` | Where the GGUF model is stored |
| `MODEL_REPO` | `bartowski/google_gemma-3-12b-it-GGUF` | HuggingFace repo |
| `MODEL_FILE` | `google_gemma-3-12b-it-Q4_K_M.gguf` | GGUF filename to download |
| `N_CTX` | `8192` | Context window in tokens |
| `N_GPU_LAYERS` | `-1` | GPU layers (-1 = all, 0 = CPU only) |
| `GEMMA_SYSTEM_PACKAGES` | `0` | Set to `1` to use `--system-site-packages` (e.g. for dnf/apt installs) |

### Using a smaller/larger quantisation

```bash
# Smaller — Q3_K_M (~5.5 GB), lower quality
MODEL_FILE=google_gemma-3-12b-it-Q3_K_M.gguf bash start.sh

# Larger — Q6_K (~9.8 GB), near-lossless
MODEL_FILE=google_gemma-3-12b-it-Q6_K.gguf bash start.sh
```

## GPU acceleration

- **macOS Apple Silicon** — Metal is enabled automatically.
- **Linux + NVIDIA** — CUDA is enabled automatically if `nvcc` or `nvidia-smi` is found.
- **CPU only** — set `N_GPU_LAYERS=0`.

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check — `{ status, modelReady }` |
| `GET /v1/models` | Lists `local-model` |
| `POST /v1/chat/completions` | OpenAI-compatible chat completions |
