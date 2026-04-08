#!/usr/bin/env bash
# start.sh — Create a venv, install dependencies, and launch the Kokoro TTS server.
# Run from any directory: bash /path/to/kokoro-server/start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/.venv"
STAMP_FILE="$VENV_DIR/.requirements_stamp"

# ── Find Python 3.10+ ──────────────────────────────────────────────────────────

find_python() {
  local candidates=(python3.13 python3.12 python3.11 python3.10 python3 python)
  for cmd in "${candidates[@]}"; do
    if command -v "$cmd" &>/dev/null; then
      local ok
      ok=$("$cmd" -c 'import sys; print(int(sys.version_info >= (3, 10)))' 2>/dev/null || echo 0)
      if [ "$ok" = "1" ]; then
        echo "$cmd"
        return 0
      fi
    fi
  done
  return 1
}

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  PYTHON=$(find_python) || {
    echo "error: Python 3.10 or higher is required but was not found." >&2
    echo "       Install it from https://python.org or via your package manager." >&2
    exit 1
  }
fi

echo "Python: $($PYTHON --version)"

# ── Create venv if missing ─────────────────────────────────────────────────────

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment at .venv …"
  "$PYTHON" -m venv "$VENV_DIR"
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
