#!/usr/bin/env bash
# start.sh — Create a venv, install dependencies, and launch the Gemma LLM server.
# Run from any directory: bash /path/to/gemma-server/start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
STAMP_FILE="$VENV_DIR/.requirements_stamp"

# ── Find Python 3.10+ ──────────────────────────────────────────────────────────

is_python_ok() {
  local cmd="$1"
  command -v "$cmd" &>/dev/null || return 1
  "$cmd" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null
}

find_python() {
  local candidates=(python3.12 python3.11 python3.10 python3.13 python3 python)
  for cmd in "${candidates[@]}"; do
    if is_python_ok "$cmd"; then echo "$cmd"; return 0; fi
  done
  return 1
}

if [ -n "${GEMMA_PYTHON:-}" ]; then
  if ! is_python_ok "$GEMMA_PYTHON"; then
    echo "error: GEMMA_PYTHON='$GEMMA_PYTHON' is not a working Python 3.10+." >&2
    exit 1
  fi
  _PY="$GEMMA_PYTHON"
else
  _PY=$(find_python) || {
    echo "error: Python 3.10 or higher is required but was not found." >&2
    echo "       Install it from https://python.org or via your package manager." >&2
    exit 1
  }
fi

echo "Python: $($_PY --version)"

# Keep a reference to the system Python so we can check system-level packages
# later, after the venv is activated and overrides the PATH.
_SYSTEM_PY="$_PY"

# ── Create venv if missing ─────────────────────────────────────────────────────
# Set GEMMA_SYSTEM_PACKAGES=1 to create the venv with --system-site-packages,
# which lets pip-free installs (e.g. dnf install python3-llama-cpp) be seen
# inside the venv. If the existing venv was created without this flag it will
# be removed and recreated.

_WANT_SYS_PKGS="${GEMMA_SYSTEM_PACKAGES:-0}"

_venv_has_sys_pkgs() {
  grep -qi "include-system-site-packages = true" "$VENV_DIR/pyvenv.cfg" 2>/dev/null
}

if [ ! -d "$VENV_DIR" ]; then
  if [ "$_WANT_SYS_PKGS" = "1" ]; then
    echo "Creating virtual environment (--system-site-packages) at .venv …"
    "$_PY" -m venv --system-site-packages "$VENV_DIR"
  else
    echo "Creating virtual environment at .venv …"
    "$_PY" -m venv "$VENV_DIR"
  fi
elif [ "$_WANT_SYS_PKGS" = "1" ] && ! _venv_has_sys_pkgs; then
  echo "Recreating venv with --system-site-packages …"
  rm -rf "$VENV_DIR"
  "$_PY" -m venv --system-site-packages "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

# ── Detect platform and install llama-cpp-python with the right backend ────────

install_llama_cpp() {
  local os_name; os_name="$(uname -s)"
  local arch;    arch="$(uname -m)"

  # Check if already installed inside the venv (or via system-site-packages).
  if python -c "import llama_cpp" 2>/dev/null; then
    echo "llama-cpp-python already installed."
    return
  fi

  # Check if it exists in the system Python but is invisible to the venv.
  # This happens when the user installed via dnf/apt without GEMMA_SYSTEM_PACKAGES=1.
  if "$_SYSTEM_PY" -c "import llama_cpp" 2>/dev/null; then
    echo "" >&2
    echo "  llama-cpp-python is installed system-wide but is not visible inside" >&2
    echo "  the virtual environment. Re-run with:" >&2
    echo "" >&2
    echo "    GEMMA_SYSTEM_PACKAGES=1 bash start.sh" >&2
    echo "" >&2
    echo "  This recreates the venv with --system-site-packages so the" >&2
    echo "  dnf/apt-installed package is picked up automatically." >&2
    echo "" >&2
    exit 1
  fi

  echo "Installing llama-cpp-python …"

  if [ "$os_name" = "Darwin" ]; then
    if [ "$arch" = "arm64" ]; then
      echo "  → macOS Apple Silicon: enabling Metal GPU acceleration"
      CMAKE_ARGS="-DGGML_METAL=on" pip install --quiet llama-cpp-python
    else
      echo "  → macOS Intel: CPU-only build"
      pip install --quiet llama-cpp-python
    fi
  elif [ "$os_name" = "Linux" ]; then
    # Check for NVIDIA GPU / CUDA
    if command -v nvcc &>/dev/null || command -v nvidia-smi &>/dev/null; then
      echo "  → Linux + NVIDIA GPU detected: enabling CUDA acceleration"
      CMAKE_ARGS="-DGGML_CUDA=on" pip install --quiet llama-cpp-python
    else
      echo "  → Linux CPU-only build"
      echo "    (Set N_GPU_LAYERS=0 or install CUDA for GPU support)"
      pip install --quiet llama-cpp-python
    fi
  else
    echo "  → Unknown platform ($os_name): CPU-only build"
    pip install --quiet llama-cpp-python
  fi

  echo "llama-cpp-python installed."
}

# ── Install / update base dependencies when requirements.txt changed ───────────

REQUIREMENTS_HASH=$(shasum -a 256 requirements.txt 2>/dev/null || sha256sum requirements.txt)
if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$REQUIREMENTS_HASH" ]; then
  echo "Installing base dependencies …"
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  echo "$REQUIREMENTS_HASH" > "$STAMP_FILE"
  echo "Base dependencies ready."
else
  echo "Base dependencies up to date."
fi

install_llama_cpp

# ── Defaults ──────────────────────────────────────────────────────────────────

export CACHE_DIR="${CACHE_DIR:-$SCRIPT_DIR/cache}"
mkdir -p "$CACHE_DIR"

# Model to download (can be overridden):
#   MODEL_REPO — HuggingFace repo (default: bartowski/gemma-3-12b-it-GGUF)
#   MODEL_FILE — GGUF filename   (default: gemma-3-12b-it-Q4_K_M.gguf, ~7.5 GB)
export MODEL_REPO="${MODEL_REPO:-bartowski/google_gemma-3-12b-it-GGUF}"
export MODEL_FILE="${MODEL_FILE:-google_gemma-3-12b-it-Q4_K_M.gguf}"

# ── HuggingFace token check (Gemma 3 is a gated model) ───────────────────────
# Skip when the model file is already present (e.g. placed manually).

MODEL_PATH="$CACHE_DIR/$MODEL_FILE"

if [ ! -f "$MODEL_PATH" ] && [ -z "${HF_TOKEN:-}" ]; then
  echo ""
  echo "Model not found at: $MODEL_PATH" >&2
  echo "" >&2
  echo "Choose one of the two options below to provide the model:" >&2
  echo "" >&2
  echo "  Option A — Auto-download (requires a free HuggingFace account):" >&2
  echo "    1. Accept the license: https://huggingface.co/google/gemma-3-12b-it" >&2
  echo "    2. Create a token:     https://huggingface.co/settings/tokens" >&2
  echo "    3. Re-run:" >&2
  echo "         HF_TOKEN=hf_... bash start.sh" >&2
  echo "       Or add to your shell profile and re-run normally:" >&2
  echo "         export HF_TOKEN=hf_..." >&2
  echo "" >&2
  echo "  Option B — Manual download (~7.5 GB):" >&2
  echo "    1. Accept the license: https://huggingface.co/google/gemma-3-12b-it" >&2
  echo "    2. Download the file:  https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}" >&2
  echo "    3. Move it here:       $MODEL_PATH" >&2
  echo "    4. Re-run:             bash start.sh" >&2
  echo "" >&2
  exit 1
fi

# N_GPU_LAYERS=-1 offloads all layers to GPU (Metal/CUDA).
# Set to 0 to force CPU-only inference.
export N_GPU_LAYERS="${N_GPU_LAYERS:--1}"

# ── Launch ─────────────────────────────────────────────────────────────────────

echo ""
echo "Starting Gemma LLM server on port ${PORT:-5425} …"
echo "Model:          $MODEL_REPO / $MODEL_FILE"
echo "Cache:          $CACHE_DIR"
echo "GPU layers:     $N_GPU_LAYERS  (-1 = all, 0 = CPU only)"
echo "Context window: ${N_CTX:-8192} tokens"
echo ""
if [ ! -f "$MODEL_PATH" ]; then
  echo "The model (~7.5 GB) will be downloaded on first run (HF_TOKEN is set)."
else
  echo "Model file found — skipping download."
fi
echo "Set the LM Studio URL in the extension settings to http://localhost:5425"
echo ""
exec python server.py
