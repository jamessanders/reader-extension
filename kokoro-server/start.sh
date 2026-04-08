#!/usr/bin/env bash
# start.sh — Create a venv, install dependencies, and launch the Kokoro TTS server.
# Run from any directory: bash /path/to/kokoro-server/start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
STAMP_FILE="$VENV_DIR/.requirements_stamp"

# ── Find Python 3.10+ ──────────────────────────────────────────────────────────

is_python_ok() {
  # Returns 0 if the given command exists, is executable, and is Python 3.10+
  local cmd="$1"
  command -v "$cmd" &>/dev/null || return 1
  "$cmd" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null
}

find_python() {
  # Prefer <=3.12: misaki G2P (full pronunciation markup) requires Python <3.13.
  # 3.13 still works but strips markup and falls back to plain espeak phonemization.
  local preferred=(python3.12 python3.11 python3.10)
  local fallback=(python3.13 python3 python)
  for cmd in "${preferred[@]}"; do
    if is_python_ok "$cmd"; then echo "$cmd"; return 0; fi
  done
  for cmd in "${fallback[@]}"; do
    if is_python_ok "$cmd"; then
      local ver; ver=$("$cmd" -c 'import sys; print(sys.version_info.minor)')
      if [ "$ver" -ge 13 ]; then
        echo "" >&2
        echo "warning: Python 3.13+ detected. misaki G2P (full pronunciation markup) requires" >&2
        echo "         Python <=3.12. Install 3.12 for best results:" >&2
        case "$(uname -s)" in
          Darwin) echo "           brew install python@3.12 && KOKORO_PYTHON=python3.12 bash start.sh" >&2 ;;
          Linux)  echo "           sudo apt install python3.12 && KOKORO_PYTHON=python3.12 bash start.sh" >&2 ;;
        esac
        echo "" >&2
      fi
      echo "$cmd"; return 0
    fi
  done
  return 1
}

# Allow an override via KOKORO_PYTHON; fall back to auto-detection.
# (Avoid reusing PYTHON which is commonly set by conda/pyenv to a stale path.)
if [ -n "${KOKORO_PYTHON:-}" ]; then
  if ! is_python_ok "$KOKORO_PYTHON"; then
    echo "error: KOKORO_PYTHON='$KOKORO_PYTHON' is not a working Python 3.10+." >&2
    exit 1
  fi
  _PY="$KOKORO_PYTHON"
else
  _PY=$(find_python) || {
    echo "error: Python 3.10 or higher is required but was not found." >&2
    echo "       Install it from https://python.org or via your package manager." >&2
    echo "       Or set KOKORO_PYTHON=/path/to/python3 and re-run." >&2
    exit 1
  }
fi

echo "Python: $($_PY --version)"

# ── Create venv if missing ─────────────────────────────────────────────────────

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment at .venv …"
  "$_PY" -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

# ── Install / update dependencies when requirements.txt changed ────────────────

REQUIREMENTS_HASH=$(shasum -a 256 requirements.txt 2>/dev/null || sha256sum requirements.txt)
if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$REQUIREMENTS_HASH" ]; then
  echo "Installing dependencies …"
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  echo "$REQUIREMENTS_HASH" > "$STAMP_FILE"
  echo "Dependencies ready."
else
  echo "Dependencies up to date."
fi

# ── Check for espeak-ng (used by misaki for fallback phonemization) ────────────

if ! command -v espeak-ng &>/dev/null && ! command -v espeak &>/dev/null; then
  echo ""
  echo "warning: espeak-ng not found — misaki fallback phonemization will be limited."
  echo "         Install it for best pronunciation quality:"
  case "$(uname -s)" in
    Darwin) echo "           brew install espeak-ng" ;;
    Linux)  echo "           sudo apt install espeak-ng    # Debian/Ubuntu"
            echo "           sudo dnf install espeak-ng    # Fedora/RHEL"
            echo "           sudo pacman -S espeak-ng      # Arch" ;;
  esac
  echo ""
fi

# ── Defaults for running outside Docker ───────────────────────────────────────

export CACHE_DIR="${CACHE_DIR:-$SCRIPT_DIR/cache}"
mkdir -p "$CACHE_DIR"

# ── Launch ─────────────────────────────────────────────────────────────────────

echo "Starting Kokoro TTS server on port ${PORT:-5423} …"
echo "Cache directory: $CACHE_DIR"
echo ""
exec python server.py
