#!/usr/bin/env bash
# setup-docker.sh — Interactive Docker setup for kokoro-server (Text-to-Speech).
# Run from any directory: bash /path/to/read-extension/setup-docker.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colours ─────────────────────────────────────────────────────────────────

BOLD=$'\033[1m'
DIM=$'\033[2m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
RESET=$'\033[0m'

header() { echo; echo "${BOLD}${CYAN}══════════════════════════════════════════════${RESET}"; echo "${BOLD}${CYAN}  $*${RESET}"; echo "${BOLD}${CYAN}══════════════════════════════════════════════${RESET}"; echo; }
info()    { echo "  ${GREEN}✔${RESET}  $*"; }
warn()    { echo "  ${YELLOW}⚠${RESET}  $*"; }
error()   { echo "  ${RED}✖${RESET}  $*" >&2; }
step()    { echo; echo "${BOLD}▶ $*${RESET}"; }

ask_yn() {
  # ask_yn "Question?" [y|n]   — returns 0 for yes, 1 for no
  local prompt="$1"
  local default="${2:-y}"
  local hint
  if [ "$default" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  while true; do
    printf "  %s %s%s%s " "${prompt}" "${DIM}" "${hint}" "${RESET}"
    read -r reply
    reply="${reply:-$default}"
    case "${reply,,}" in
      y|yes) return 0 ;;
      n|no)  return 1 ;;
      *) warn "Please answer y or n." ;;
    esac
  done
}

# ── Docker preflight ─────────────────────────────────────────────────────────

check_docker() {
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed or not in PATH."
    echo "    Install Docker Desktop: https://docs.docker.com/get-docker/"
    exit 1
  fi

  if ! docker info &>/dev/null 2>&1; then
    error "Docker daemon is not running."
    echo "    Start Docker Desktop (or run: sudo systemctl start docker)"
    exit 1
  fi

  info "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
}

# ── Component builder ─────────────────────────────────────────────────────────

build_kokoro() {
  local port="${1:-5423}"
  local clean="${2:-0}"

  step "Setting up kokoro-server (TTS)"

  local image_name="kokoro-server"
  local build_flags=()
  [ "${clean}" = "1" ] && build_flags+=(--no-cache)

  # Stop + remove any old container with the same name
  if docker ps -a --format '{{.Names}}' | grep -q "^${image_name}$"; then
    warn "Removing existing container '${image_name}' …"
    docker rm -f "${image_name}" >/dev/null
  fi

  if [ "${clean}" = "1" ]; then
    if docker image inspect "${image_name}" &>/dev/null; then
      warn "Removing existing image '${image_name}' …"
      docker rmi -f "${image_name}" >/dev/null
    fi
    if docker volume inspect kokoro-cache &>/dev/null; then
      warn "Removing cache volume 'kokoro-cache' …"
      docker volume rm kokoro-cache >/dev/null
    fi
  fi

  info "Building Docker image '${image_name}' from ${ROOT_DIR}/kokoro-server …"
  docker build "${build_flags[@]}" -t "${image_name}" "${ROOT_DIR}/kokoro-server"

  info "Starting container '${image_name}' on port ${port} …"
  docker run -d \
    --name "${image_name}" \
    --restart unless-stopped \
    -p "${port}:5423" \
    -v kokoro-cache:/app/cache \
    "${image_name}"

  info "kokoro-server is running → http://localhost:${port}"
}

# ── Main ─────────────────────────────────────────────────────────────────────

header "Read Extension — Docker Setup"

echo "  This script builds and starts the kokoro-server (Text-to-Speech)"
echo "  container. For LLM support, install LM Studio separately."
echo

check_docker

# ── Options ───────────────────────────────────────────────────────────────────

step "Options"

KOKORO_PORT=5423

CLEAN_BUILD=0
if ask_yn "Clean build? (removes existing image, container, and cache volume)" n; then
  CLEAN_BUILD=1
  warn "Clean build enabled — existing image and cached data will be deleted."
fi

# ── Summary ───────────────────────────────────────────────────────────────────

step "Summary"

echo "  ${GREEN}kokoro-server${RESET}  → http://localhost:${KOKORO_PORT}"
[ "${CLEAN_BUILD}" = "1" ] && echo "  ${YELLOW}Clean build:${RESET}  image, container, and cache volume will be removed first."
echo

if ! ask_yn "Proceed with setup?"; then
  warn "Aborted."
  exit 0
fi

# ── Build & start ─────────────────────────────────────────────────────────────

build_kokoro "${KOKORO_PORT}" "${CLEAN_BUILD}"

# ── Done ─────────────────────────────────────────────────────────────────────

header "Setup complete"

info "Kokoro TTS  →  http://localhost:${KOKORO_PORT}"
echo
echo "  Useful commands:"
echo "    docker ps                       — list running containers"
echo "    docker logs -f kokoro-server    — stream kokoro-server logs"
echo "    docker rm -f kokoro-server      — stop & remove kokoro-server"
echo
