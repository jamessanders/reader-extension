(function () {
  "use strict";

  const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const WSS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
  const FORMAT = "audio-24khz-48kbitrate-mono-mp3";

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
  // where WindowsFileTimeTicks = (unix_seconds + 11644473600) * 10_000_000
  // rounded DOWN to nearest 300 seconds (5 minutes) before converting.
  async function generateSecMsGec() {
    const WIN_EPOCH = 11644473600; // seconds between 1601-01-01 and 1970-01-01
    let ticks = (Date.now() / 1000) + WIN_EPOCH; // seconds since Windows epoch
    ticks -= ticks % 300;                         // round down to nearest 5 minutes
    ticks = Math.floor(ticks * 10_000_000);       // convert to 100-ns intervals

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
                    outputFormat: FORMAT,
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
          if (!result) {
            console.warn("[ReadAloud] turn.end received but no audio chunks");
          }
          resolve(result);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Binary frame: 2-byte big-endian header length, then header, then audio
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
          console.warn(`[ReadAloud] synthesize attempt ${attempt + 1} failed:`, e.message);
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

  self.edgeTTS = new EdgeTTS();
})();
