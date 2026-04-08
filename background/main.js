// ── Edge TTS — WebSocket client for speech.platform.bing.com ──
// Ported from the original background/tts.js implementation.

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const AUDIO_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

function uuid() {
  return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, () =>
    (Math.random() * 16 | 0).toString(16)
  );
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Sec-MS-GEC: SHA256( floor(WindowsFileTimeTicks / 3_000_000_000) * 3_000_000_000 + TOKEN )
async function generateSecMsGec() {
  const WIN_EPOCH = 11644473600;
  let ticks = (Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks = Math.floor(ticks * 10_000_000);
  const strToHash = `${ticks}${TOKEN}`;
  const encoded = new TextEncoder().encode(strToHash);
  const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function chunksToDataUrl(chunks) {
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const merged = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) { merged.set(new Uint8Array(c), off); off += c.byteLength; }
  let bin = "";
  for (let i = 0; i < merged.length; i++) bin += String.fromCharCode(merged[i]);
  return "data:audio/mpeg;base64," + btoa(bin);
}

class EdgeTTS {
  constructor() {
    this.ws = null;
    this._resolve = null;
    this._reject = null;
    this._chunks = [];
    this._connecting = null;
    this._timer = null;
  }

  async _connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this._connecting) return this._connecting;

    const secGec = await generateSecMsGec();
    const url =
      `${WSS_BASE}` +
      `?TrustedClientToken=${TOKEN}` +
      `&ConnectionId=${uuid()}` +
      `&Sec-MS-GEC=${secGec}` +
      `&Sec-MS-GEC-Version=${encodeURIComponent(SEC_MS_GEC_VERSION)}`;

    this._connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(
          `X-Timestamp:${new Date().toISOString()}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    wordBoundaryEnabled: "false",
                  },
                  outputFormat: AUDIO_FORMAT,
                },
              },
            },
          })
        );
        this.ws = ws;
        this._connecting = null;
        resolve();
      };

      ws.onmessage = (e) => this._onMessage(e);

      ws.onerror = (e) => {
        console.error("[ReadAloud] WebSocket error", e);
        this._connecting = null;
        this.ws = null;
        this._fail(new Error("WebSocket error"));
        reject(new Error("WebSocket error"));
      };

      ws.onclose = (e) => {
        console.warn("[ReadAloud] WebSocket closed", e.code, e.reason);
        this._connecting = null;
        this.ws = null;
        this._fail(new Error(`WebSocket closed (${e.code})`));
      };
    });

    return this._connecting;
  }

  _onMessage(event) {
    if (typeof event.data === "string") {
      if (event.data.includes("Path:turn.end") && this._resolve) {
        clearTimeout(this._timer);
        const resolve = this._resolve;
        this._resolve = null;
        this._reject = null;
        const result = this._chunks.length > 0 ? chunksToDataUrl(this._chunks) : null;
        this._chunks = [];
        if (!result) console.warn("[ReadAloud] turn.end received but no audio chunks");
        resolve(result);
      }
    } else if (event.data instanceof ArrayBuffer) {
      if (event.data.byteLength < 2) return;
      const headerLen = new DataView(event.data).getUint16(0);
      const audio = event.data.slice(2 + headerLen);
      if (audio.byteLength > 0) this._chunks.push(audio);
    }
  }

  _fail(err) {
    clearTimeout(this._timer);
    if (this._reject) {
      const reject = this._reject;
      this._resolve = null;
      this._reject = null;
      this._chunks = [];
      reject(err);
    }
  }

  async synthesize(text, voice, ratePercent) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this._connect();
        return await this._send(text, voice, ratePercent);
      } catch (e) {
        console.warn(`[ReadAloud] Edge TTS attempt ${attempt + 1} failed:`, e.message);
        this.ws = null;
        if (attempt === 1) throw e;
      }
    }
  }

  _send(text, voice, ratePercent) {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
      this._reject = null;
      this._chunks = [];
    }

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._chunks = [];

      this._timer = setTimeout(() => this._fail(new Error("TTS timeout")), 20000);

      const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
      const ssml =
        `X-RequestId:${uuid()}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rateStr}'>` +
        escapeXml(text) +
        `</prosody></voice></speak>`;

      try {
        this.ws.send(ssml);
      } catch (e) {
        this._resolve = null;
        this._reject = null;
        this.ws = null;
        reject(e);
      }
    });
  }

  cancel() {
    clearTimeout(this._timer);
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
      this._reject = null;
      this._chunks = [];
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

const edgeTTS = new EdgeTTS();

// ── Header spoofing ──
// The MS TTS service validates that requests appear to come from the real
// Edge Read Aloud extension. Spoof Origin and User-Agent on WebSocket upgrade.

const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
  " (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

function setHeader(headers, name, value) {
  const lower = name.toLowerCase();
  const existing = headers.find((h) => h.name.toLowerCase() === lower);
  if (existing) { existing.value = value; } else { headers.push({ name, value }); }
}

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders || [];
    setHeader(headers, "Origin", EDGE_ORIGIN);
    setHeader(headers, "User-Agent", EDGE_UA);
    setHeader(headers, "Pragma", "no-cache");
    setHeader(headers, "Cache-Control", "no-cache");
    return { requestHeaders: headers };
  },
  { urls: ["*://speech.platform.bing.com/*"] },
  ["blocking", "requestHeaders"]
);

// ── Kokoro service helpers ──

const DEFAULT_SERVICE_URL = "http://localhost:5423";

async function getServiceUrl() {
  const res = await browser.storage.local.get("serviceUrl");
  return (res.serviceUrl || DEFAULT_SERVICE_URL).replace(/\/$/, "");
}

// ── LM Studio preprocessing ──

const DEFAULT_LMSTUDIO_URL = "http://localhost:1234";

const KOKORO_PREPROCESS_PROMPT =
  "You are a text preprocessor for the Kokoro TTS engine. " +
  "Reformat the input text to improve how it sounds when spoken.\n\n" +
  "Kokoro supports these formatting features:\n" +
  "- Custom pronunciation: [word](/IPA/) using IPA notation, e.g. [Kokoro](/kˈOkəɹO/)\n" +
  "- Intonation via punctuation: ; : , . ! ? — … \" ( )\n" +
  "- Stress markers: ˈ (primary) and ˌ (secondary) placed immediately before the stressed syllable\n" +
  "- Lower stress by 1 or 2 levels: [word](-1) or [word](-2)\n" +
  "- Raise stress by 1 or 2 levels: [word](+1) or [word](+2) — most effective on short, normally unstressed words\n\n" +
  "Your tasks:\n" +
  "1. Add pronunciation guides for unusual words, proper nouns, technical terms, and acronyms\n" +
  "2. Add stress markers where they improve naturalness and clarity\n" +
  "3. Adjust punctuation to improve sentence rhythm and phrasing\n" +
  "4. Preserve all original meaning and content exactly\n" +
  "5. Only add markup where it genuinely helps — do not over-annotate plain prose\n\n" +
  "Return ONLY the reformatted text with no explanation, preamble, or extra commentary.";

async function preprocessForKokoro(text) {
  const res = await browser.storage.local.get(["lmStudioUrl", "lmStudioEnabled"]);
  if (!res.lmStudioEnabled) return text;

  const url = (res.lmStudioUrl || DEFAULT_LMSTUDIO_URL).replace(/\/$/, "");

  try {
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local-model",
        messages: [
          { role: "system", content: KOKORO_PREPROCESS_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0.3,
        max_tokens: Math.min(Math.max(text.length * 4, 256), 2048),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return text;
    const data = await response.json();
    const processed = data.choices?.[0]?.message?.content?.trim();
    if (processed) {
      console.log("[ReadAloud] LM Studio preprocessed text:\n" + processed);
    }
    return processed || text;
  } catch {
    return text;
  }
}

async function synthesizeKokoro(text, voice, rate) {
  const serviceUrl = await getServiceUrl();

  let response;
  try {
    response = await fetch(`${serviceUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed: rate }),
    });
  } catch {
    return { error: "Kokoro service unreachable. Is it running?" };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { error: body.error || `Service returned ${response.status}` };
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { audioUrl: "data:audio/wav;base64," + btoa(binary) };
  } catch (err) {
    return { error: "Failed to process audio: " + err.message };
  }
}

// ── Message Handling ──

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "synthesize") {
    if (msg.engine === "edge") {
      const ratePercent = Math.round((msg.rate - 1) * 100);
      return edgeTTS
        .synthesize(msg.text, msg.voice || "en-US-JennyNeural", ratePercent)
        .then((dataUrl) => {
          if (!dataUrl) return { error: "No audio received from Edge TTS" };
          return { audioUrl: dataUrl };
        })
        .catch((err) => ({ error: err.message }));
    }

    return preprocessForKokoro(msg.text)
      .then((processedText) => synthesizeKokoro(processedText, msg.voice ?? "af_heart", msg.rate ?? 1));
  }

  if (msg.action === "cancelSynthesis") {
    // Cancel an in-flight Edge TTS request; Kokoro stale results are discarded
    // by the generation counter in reader.js.
    edgeTTS.cancel();
    return;
  }

  // Relay playback state changes from the content script to the popup.
  if (msg.action === "stateChanged") {
    browser.runtime.sendMessage(msg).catch(() => {});
  }
});
