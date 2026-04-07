# Kokoro TTS Service

A lightweight local HTTP server that runs the [Kokoro](https://github.com/hexgrad/kokoro) neural TTS model and exposes it as a REST API for the Read Aloud browser extension.

Running the model here instead of inside the browser tab eliminates tab memory pressure and produces significantly faster synthesis times.

## Requirements

- [Node.js](https://nodejs.org) v18 or newer

## Setup

```bash
cd kokoro-server
npm install
npm start
```

On first run the Kokoro ONNX model (~86 MB) is downloaded and cached automatically by `kokoro-js`. Subsequent starts load from the cache and are ready in seconds.

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

```bash
PORT=8080 npm start
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
| `speed` | number | `1.0` | Playback speed multiplier |

**Available voices:**

| Name | Description |
|---|---|
| `af_heart` | Heart — US Female ★★★ |
| `af_bella` | Bella — US Female ★★★ |
| `af_nicole` | Nicole — US Female ★★ |
| `bf_emma` | Emma — UK Female ★★ |
| `am_fenrir` | Fenrir — US Male ★★ |
| `am_michael` | Michael — US Male ★★ |
| `am_puck` | Puck — US Male ★★ |
| `bf_isabella` | Isabella — UK Female ★ |
| `bm_george` | George — UK Male ★ |
| `bm_fable` | Fable — UK Male ★ |

**Response:** `audio/wav` binary

**Example:**

```bash
curl -X POST http://localhost:5423/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "voice": "af_heart", "speed": 1}' \
  --output hello.wav
```
