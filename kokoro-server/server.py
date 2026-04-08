import asyncio
import io
import logging
import os
import re
import wave
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel

PORT = int(os.getenv("PORT", "5423"))
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/app/cache"))
# int8 (~88 MB) matches the quality/size tradeoff of the old q8 model; fp16/f32 also available
MODEL_VARIANT = os.getenv("MODEL_VARIANT", "int8")

_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_MODEL_URLS = {
    "f32":  f"{_RELEASE}/kokoro-v1.0.onnx",
    "fp16": f"{_RELEASE}/kokoro-v1.0.fp16.onnx",
    "int8": f"{_RELEASE}/kokoro-v1.0.int8.onnx",
}
_MODEL_FILENAMES = {
    "f32":  "kokoro-v1.0.onnx",
    "fp16": "kokoro-v1.0.fp16.onnx",
    "int8": "kokoro-v1.0.int8.onnx",
}
_VOICES_URL = f"{_RELEASE}/voices-v1.0.bin"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_kokoro: Kokoro | None = None
_g2p_us = None  # misaki G2P for American English
_g2p_gb = None  # misaki G2P for British English
# Single worker keeps inference serialized; avoids memory spikes from parallel ONNX sessions.
_executor = ThreadPoolExecutor(max_workers=1)


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    log.info("Downloading %s", url)
    with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=65536):
                f.write(chunk)
                done += len(chunk)
                if total:
                    log.info("  %s %.1f%%", dest.name, 100 * done / total)
    tmp.rename(dest)
    log.info("Saved %s", dest)


def _ensure_models(variant: str) -> tuple[Path, Path]:
    model_path = CACHE_DIR / _MODEL_FILENAMES[variant]
    voices_path = CACHE_DIR / "voices-v1.0.bin"
    if not model_path.exists():
        _download(_MODEL_URLS[variant], model_path)
    if not voices_path.exists():
        _download(_VOICES_URL, voices_path)
    return model_path, voices_path


def _load_model() -> Kokoro:
    model_path, voices_path = _ensure_models(MODEL_VARIANT)
    log.info("Loading Kokoro model (%s)…", MODEL_VARIANT)
    k = Kokoro(str(model_path), str(voices_path))
    log.info("Kokoro model ready.")
    return k


def _load_g2p():
    """Load misaki G2P engines for US and GB English. Returns (g2p_us, g2p_gb) or (None, None)."""
    try:
        from misaki import en
        from misaki.espeak import EspeakFallback
        g2p_us = en.G2P(trf=False, british=False, fallback=EspeakFallback(british=False))
        g2p_gb = en.G2P(trf=False, british=True,  fallback=EspeakFallback(british=True))
        log.info("misaki G2P loaded — pronunciation markup enabled.")
        return g2p_us, g2p_gb
    except Exception as e:
        log.warning("misaki G2P unavailable (%s) — falling back to espeak phonemizer.", e)
        return None, None


def _is_british(voice: str) -> bool:
    return voice.startswith(("bf_", "bm_"))


# Matches Kokoro markup that espeak doesn't understand and would read literally:
#   [word](/IPA/)        → word   (custom pronunciation)
#   [word](-1)           → word   (stress level adjustment)
#   [word](+2)           → word   (stress level adjustment)
#   ˈ / ˌ               → ''     (inline stress markers)
_MARKUP_RE = re.compile(r'\[([^\]]+)\]\([^)]+\)|[ˈˌ]')


def _strip_markup(text: str) -> str:
    """Remove Kokoro pronunciation/stress markup so espeak doesn't read it literally."""
    return _MARKUP_RE.sub(lambda m: m.group(1) if m.group(1) else "", text)


def _encode_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        pcm = np.clip(samples, -1.0, 1.0)
        wf.writeframes((pcm * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _kokoro, _g2p_us, _g2p_gb
    loop = asyncio.get_event_loop()
    _kokoro = await loop.run_in_executor(_executor, _load_model)
    _g2p_us, _g2p_gb = await loop.run_in_executor(None, _load_g2p)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class SynthesizeRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


@app.get("/health")
def health():
    return {"status": "ok", "modelReady": _kokoro is not None}


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    if not req.text:
        raise HTTPException(status_code=400, detail="text is required")
    if _kokoro is None:
        raise HTTPException(status_code=503, detail="Model not ready")

    british = _is_british(req.voice)
    lang = "en-gb" if british else "en-us"
    g2p = _g2p_gb if british else _g2p_us

    def _generate():
        if g2p is not None:
            phonemes, _ = g2p(req.text)
            return _kokoro.create(phonemes, voice=req.voice, speed=req.speed, is_phonemes=True)
        # misaki unavailable: strip Kokoro markup so espeak doesn't read brackets/slashes aloud
        clean = _strip_markup(req.text)
        return _kokoro.create(clean, voice=req.voice, speed=req.speed, lang=lang)

    loop = asyncio.get_event_loop()
    samples, sample_rate = await loop.run_in_executor(_executor, _generate)
    return Response(content=_encode_wav(samples, sample_rate), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
