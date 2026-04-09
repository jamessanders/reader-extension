#!/usr/bin/env bash
# start.sh — Start the Kokoro TTS server.
# Run from any directory: bash /path/to/read-extension/start.sh
#
# Environment variables are forwarded to kokoro-server:
#   KOKORO_* / PORT  —  see kokoro-server/start.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

KOKORO_START="$ROOT_DIR/kokoro-server/start.sh"

if [ ! -f "$KOKORO_START" ]; then
  echo "error: $KOKORO_START not found." >&2
  exit 1
fi

cleanup() {
  echo ""
  echo "Shutting down server…"
  kill "$KOKORO_PID" 2>/dev/null || true
  wait "$KOKORO_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "══════════════════════════════════════════════"
echo "  Starting Kokoro TTS server …"
echo "══════════════════════════════════════════════"
bash "$KOKORO_START" &
KOKORO_PID=$!

echo ""
echo "Server is running."
echo "  Kokoro TTS:  http://localhost:${KOKORO_PORT:-5423}"
echo ""
echo "Press Ctrl+C to stop."
echo ""

wait "$KOKORO_PID"
