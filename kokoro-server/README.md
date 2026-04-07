# Kokoro TTS Service

A lightweight local HTTP server that runs the [Kokoro](https://github.com/hexgrad/kokoro) neural TTS model via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) and exposes it as a REST API for the Read Aloud browser extension.

Running the model here instead of inside the browser tab eliminates tab memory pressure and produces significantly faster synthesis times. The Python + ONNX runtime stack is meaningfully faster than the previous Node.js/transformers.js setup, particularly on Apple Silicon where the CoreML execution provider is available.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) (recommended), **or**
- Python 3.10+

## Setup

### Docker — local machine (recommended)

```bash
cd kokoro-server
docker compose up -d
```

The model (~88 MB int8) is downloaded on first start and stored in a named Docker volume (`kokoro-cache`), so subsequent starts are fast. Stream logs with:

```bash
docker compose logs -f
```

Stop the service with `docker compose down` (the model cache volume is preserved).

### Docker — UGREEN NAS (or any remote host)

A pre-built multi-arch image (`linux/amd64` + `linux/arm64`) is published automatically to GitHub Container Registry on every push to `main`.

1. SSH into your NAS (or use the NAS file manager to upload the file):

```bash
ssh your-nas
mkdir -p ~/kokoro-server && cd ~/kokoro-server
```

2. Download the compose file:

```bash
curl -fsSL https://raw.githubusercontent.com/jamessanders/reader-extension/main/kokoro-server/docker-compose.nas.yml \
  -o docker-compose.yml
```

3. Start the service:

```bash
docker compose up -d
```

The image is pulled automatically — no source code or Python needed on the NAS. The Kokoro model is cached in a named Docker volume and survives container updates.

To update to the latest image:

```bash
docker compose pull && docker compose up -d
```

### Python (local)

```bash
cd kokoro-server
pip install -r requirements.txt
python server.py
```

On first run the model files (~88 MB) are downloaded automatically from the [kokoro-onnx releases](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0) and cached in `./cache`. Subsequent starts load from cache.

## Usage

Once running, open the Read Aloud extension popup and set the **Service URL** field to:

```
http://localhost:5423
```

The dot indicator in the popup turns green when the service is reachable and the model is loaded.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `5423` | Port the server listens on |
| `CACHE_DIR` | `/app/cache` | Directory for model file cache |
| `MODEL_VARIANT` | `int8` | Model precision: `int8` (~88 MB), `fp16` (~169 MB), `f32` (~310 MB) |
| `ONNX_PROVIDER` | _(auto)_ | Force an ONNX execution provider, e.g. `CoreMLExecutionProvider` on macOS |

```bash
# Python
PORT=8080 python server.py

# Docker Compose — the host port follows PORT
PORT=8080 docker compose up -d
```

### Apple Silicon (M1/M2/M3)

For maximum performance on Apple Silicon, set the CoreML execution provider:

```bash
ONNX_PROVIDER=CoreMLExecutionProvider python server.py
```

## API

### `GET /health`

Returns the current service status.

```json
{ "status": "ok", "modelReady": true }
```

`modelReady` is `false` while the model is still loading on startup.

### `POST /synthesize`

Synthesize speech and return a WAV audio file.

**Request body (JSON):**

| Field | Type | Default | Description |
|---|---|---|---|
| `text` | string | — | Text to synthesize (required) |
| `voice` | string | `af_heart` | Kokoro voice name |
| `speed` | number | `1.0` | Playback speed multiplier (0.5–2.0) |

**Available voices (English):**

Grades from [VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) — ★★★★★ A/A- · ★★★★ B- · ★★★ C+ · ★★ C/C- · ★ D+/D/D-/F+

| Name | Description |
|---|---|
| `af_heart` | Heart — US Female ★★★★★ |
| `af_bella` | Bella — US Female ★★★★★ |
| `af_nicole` | Nicole — US Female ★★★★ |
| `bf_emma` | Emma — UK Female ★★★★ |
| `af_aoede` | Aoede — US Female ★★★ |
| `af_kore` | Kore — US Female ★★★ |
| `af_sarah` | Sarah — US Female ★★★ |
| `am_fenrir` | Fenrir — US Male ★★★ |
| `am_michael` | Michael — US Male ★★★ |
| `am_puck` | Puck — US Male ★★★ |
| `af_alloy` | Alloy — US Female ★★ |
| `af_nova` | Nova — US Female ★★ |
| `af_sky` | Sky — US Female ★★ |
| `bf_isabella` | Isabella — UK Female ★★ |
| `bm_fable` | Fable — UK Male ★★ |
| `bm_george` | George — UK Male ★★ |

**Response:** `audio/wav` binary

**Example:**

```bash
curl -X POST http://localhost:5423/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "voice": "af_heart", "speed": 1}' \
  --output hello.wav
```
