import express from "express";
import cors from "cors";
import { KokoroTTS } from "kokoro-js";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5423;
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = "q8"; // ~86 MB — best quality/size tradeoff

const app = express();
app.use(cors());
app.use(express.json());

let tts = null;
let initPromise = null;

// Encode Float32 PCM samples to a raw WAV Buffer.
function encodeWav(samples, sampleRate) {
  const numSamples = samples.length;
  const buf = Buffer.alloc(44 + numSamples * 2);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + numSamples * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);            // PCM chunk size
  buf.writeUInt16LE(1, 20);             // PCM format
  buf.writeUInt16LE(1, 22);             // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);             // block align
  buf.writeUInt16LE(16, 34);            // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }

  return buf;
}

async function getTTS() {
  if (tts) return tts;
  if (initPromise) return initPromise;

  console.log("Loading Kokoro model — this may take a moment on first run…");
  initPromise = KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE })
    .then((instance) => {
      console.log("Kokoro model ready.");
      tts = instance;
      return tts;
    })
    .catch((err) => {
      console.error("Failed to load Kokoro model:", err);
      initPromise = null;
      throw err;
    });

  return initPromise;
}

// ── Routes ──

app.get("/health", (_req, res) => {
  res.json({ status: "ok", modelReady: tts !== null });
});

app.post("/synthesize", async (req, res) => {
  const { text, voice = "af_heart", speed = 1 } = req.body ?? {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required" });
  }

  try {
    const instance = await getTTS();
    const audio = await instance.generate(text, { voice, speed });
    const wavBuffer = encodeWav(audio.audio, audio.sampling_rate);
    res.set("Content-Type", "audio/wav");
    res.send(wavBuffer);
  } catch (err) {
    console.error("Synthesis error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──

app.listen(PORT, () => {
  console.log(`Kokoro TTS service running at http://localhost:${PORT}`);
  getTTS().catch(() => {});
});
