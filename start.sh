#!/usr/bin/env bash
# start.sh — Start both the Kokoro TTS server and the Gemma LLM server.
# Run from any directory: bash /path/to/read-extension/start.sh
#
# Environment variables are forwarded to each sub-server:
#   KOKORO_* / PORT (kokoro-server)  —  see kokoro-server/start.sh
#   GEMMA_* / HF_TOKEN / MODEL_*    —  see gemma-server/start.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KOKORO_START="$ROOT_DIR/kokoro-server/start.sh"
GEMMA_START="$ROOT_DIR/gemma-server/start.sh"

for f in "$KOKORO_START" "$GEMMA_START"; do
  if [ ! -f "$f" ]; then
    echo "error: $f not found." >&2
    exit 1
  fi
done

cleanup() {
  echo ""
  echo "Shutting down servers…"
  kill "$KOKORO_PID" "$GEMMA_PID" 2>/dev/null || true
  wait "$KOKORO_PID" "$GEMMA_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "══════════════════════════════════════════════"
echo "  Starting Kokoro TTS server …"
echo "══════════════════════════════════════════════"
bash "$KOKORO_START" &
KOKORO_PID=$!

echo ""
echo "══════════════════════════════════════════════"
echo "  Starting Gemma LLM server …"
echo "══════════════════════════════════════════════"
bash "$GEMMA_START" &
GEMMA_PID=$!

echo ""
echo "Both servers are running."
echo "  Kokoro TTS:  http://localhost:${KOKORO_PORT:-5423}"
echo "  Gemma LLM:   http://localhost:${GEMMA_PORT:-5425}"
echo ""
echo "Press Ctrl+C to stop both."
echo ""

wait "$KOKORO_PID" "$GEMMA_PID"
