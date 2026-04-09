# Read Aloud — Firefox Extension

A Firefox extension that reads webpage text aloud with sentence-by-sentence highlighting, adjustable speed, and voice selection — powered by **Kokoro**, an on-device 82M-parameter neural TTS model that runs entirely in your browser.

## Features

- **On-device TTS** using [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) — text never leaves your device
- **10 high-quality neural voices** — American and British, male and female
- **Sentence highlighting** — the current sentence is highlighted and scrolled into view
- **Floating toolbar** on the page with play/pause, skip, progress bar, and stop
- **Popup controls** — play/pause, previous/next sentence, speed slider (0.5×–3×), voice picker
- **Smart text extraction** — skips nav, footer, scripts, hidden elements; prefers `<article>` or `[role="main"]` content
- **Persisted settings** — speed and voice selection are remembered across sessions
- **Model download progress** — a progress bar in the popup shows the one-time ~86 MB model download

## First-Run Note

On first use, Kokoro downloads its quantized model weights (~86 MB) from Hugging Face. This is a one-time download — the browser caches it and subsequent uses start instantly. A download progress bar appears in the popup while this happens.

## Installation (Temporary / Development)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on…"**
3. Select the `manifest.json` file from this directory
4. The Read Aloud icon will appear in your toolbar

## Usage

1. Navigate to any webpage
2. Click the **Read Aloud** toolbar icon to open the popup
3. Press **Play** — the extension will extract the page text and start reading
4. Use the popup or the floating on-page toolbar to:
   - **Pause / Resume** playback
   - **Skip forward / back** one sentence
   - **Stop** reading entirely
   - **Adjust speed** with the slider
   - **Change voice** from the dropdown

## Quick start — Docker (recommended)

The fastest way to get the kokoro-server running is the interactive setup script:

```bash
bash setup-docker.sh
```

It will build the Docker image and start the container. Requires [Docker Desktop](https://docs.docker.com/get-docker/) (or Docker Engine on Linux).

## Quick start — native (no Docker)

To start the kokoro-server directly on your machine without Docker:

```bash
bash start.sh
```

This launches the server and streams its logs to the terminal. Press **Ctrl+C** to stop.

## Kokoro Server (optional — better TTS performance)

The extension can offload TTS to a local **kokoro-server** instead of running the model in the browser tab. This eliminates tab memory pressure and produces noticeably faster synthesis.

### Docker — automated setup

```bash
bash setup-docker.sh   # select kokoro-server when prompted
```

### Docker — manual

```bash
cd kokoro-server
docker compose up -d
```

Then set the **Service URL** in the extension popup to `http://localhost:5423`.

### Deploy on a UGREEN NAS (or any remote host)

A pre-built multi-arch image (`linux/amd64` + `linux/arm64`) is published automatically to GitHub Container Registry on every push to `main`.

SSH into your NAS and run:

```bash
mkdir -p ~/kokoro-server && cd ~/kokoro-server
curl -fsSL https://raw.githubusercontent.com/jamessanders/reader-extension/main/kokoro-server/docker-compose.nas.yml \
  -o docker-compose.yml
docker compose up -d
```

No source code or Node.js needed on the NAS. The Kokoro model (~86 MB) is cached in a Docker volume and survives restarts. To update:

```bash
docker compose pull && docker compose up -d
```

Then point the extension popup's **Service URL** to `http://<nas-ip>:5423`.

See [`kokoro-server/README.md`](kokoro-server/README.md) for full API docs and configuration options.

## LM Studio (optional — LLM text preprocessing)

The extension can use any OpenAI-compatible local LLM to preprocess article text before reading. [LM Studio](https://lmstudio.ai) is the recommended way to run one.

### Setup

1. Download and install [LM Studio](https://lmstudio.ai)
2. In LM Studio, search for and download **google/gemma-3-12b** (recommended — good balance of quality and speed; the Q4_K_M quantization is ~7.5 GB)
3. Load the model, then open the **Local Server** tab (the `<->` icon in the left sidebar)
4. Click **Start Server** — LM Studio serves on `http://localhost:1234` by default
5. In the extension popup, enable the **LLM preprocessing** toggle and set the URL to `http://localhost:1234`

### Alternative models

Any model served via LM Studio (or any OpenAI-compatible endpoint) will work. Smaller options like `gemma-3-4b` or `phi-4-mini` use less RAM if the 12B model is too large for your machine.


