import asyncio
import logging
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

PORT = int(os.getenv("PORT", "5425"))
CACHE_DIR = Path(os.getenv("CACHE_DIR", Path(__file__).parent / "cache"))
# Q4_K_M: ~7.5 GB — good balance of quality and size
MODEL_REPO = os.getenv("MODEL_REPO", "bartowski/google_gemma-3-12b-it-GGUF")
MODEL_FILE = os.getenv("MODEL_FILE", "google_gemma-3-12b-it-Q4_K_M.gguf")
N_CTX = int(os.getenv("N_CTX", "8192"))
# -1 = offload all layers; set to 0 for CPU-only
N_GPU_LAYERS = int(os.getenv("N_GPU_LAYERS", "-1"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

_llm = None
_executor = ThreadPoolExecutor(max_workers=1)


def _ensure_model() -> Path:
    model_path = CACHE_DIR / MODEL_FILE
    if model_path.exists():
        log.info("Model found at %s", model_path)
        return model_path

    log.info("Downloading %s/%s …", MODEL_REPO, MODEL_FILE)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as e:
        raise RuntimeError("huggingface_hub is required — run: pip install huggingface_hub") from e

    token = os.getenv("HF_TOKEN")
    if not token:
        raise RuntimeError(
            f"Model not found at {model_path} and HF_TOKEN is not set.\n\n"
            "  Option A — Auto-download (requires a free HuggingFace account):\n"
            "    1. Accept the license: https://huggingface.co/google/gemma-3-12b-it\n"
            "    2. Create a token:     https://huggingface.co/settings/tokens\n"
            "    3. Re-run:             HF_TOKEN=hf_... bash start.sh\n\n"
            "  Option B — Manual download (~7.5 GB):\n"
            f"    1. Accept the license: https://huggingface.co/google/gemma-3-12b-it\n"
            f"    2. Download the file:  https://huggingface.co/{MODEL_REPO}/resolve/main/{MODEL_FILE}\n"
            f"    3. Move it here:       {model_path}\n"
            "    4. Re-run:             bash start.sh"
        )
    downloaded = hf_hub_download(
        repo_id=MODEL_REPO,
        filename=MODEL_FILE,
        local_dir=str(CACHE_DIR),
        token=token,
    )
    log.info("Model saved to %s", downloaded)
    return Path(downloaded)


def _load_model():
    try:
        from llama_cpp import Llama
    except ImportError as e:
        raise RuntimeError(
            "llama-cpp-python is not installed. Run start.sh to set up the environment."
        ) from e

    model_path = _ensure_model()
    log.info("Loading model (n_ctx=%d, n_gpu_layers=%d) …", N_CTX, N_GPU_LAYERS)
    llm = Llama(
        model_path=str(model_path),
        n_ctx=N_CTX,
        n_gpu_layers=N_GPU_LAYERS,
        verbose=False,
    )
    log.info("Model ready.")
    return llm


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _llm
    loop = asyncio.get_event_loop()
    _llm = await loop.run_in_executor(_executor, _load_model)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── OpenAI-compatible types ──────────────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = "local-model"
    messages: list[Message]
    temperature: Optional[float] = 0.3
    max_tokens: Optional[int] = 2048
    stream: Optional[bool] = False


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "modelReady": _llm is not None}


@app.get("/v1/models")
def list_models():
    """Minimal models endpoint so clients don't error on capability checks."""
    return {
        "object": "list",
        "data": [{"id": "local-model", "object": "model", "owned_by": "local"}],
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    if _llm is None:
        raise HTTPException(status_code=503, detail="Model not ready")

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    def _infer():
        return _llm.create_chat_completion(
            messages=messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _infer)

    # Normalise to OpenAI response shape expected by background/main.js
    completion_id = f"chatcmpl-{uuid.uuid4().hex}"
    content = result["choices"][0]["message"]["content"]
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model or "local-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": result["choices"][0].get("finish_reason", "stop"),
            }
        ],
        "usage": result.get("usage", {}),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
