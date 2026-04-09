#!/usr/bin/env bash
# Assemble loadable extensions from shared source + browser-specific files.
#
# Output:
#   dist/firefox/  — load in Firefox via about:debugging → Load Temporary Add-on
#   dist/chrome/   — load in Chrome via chrome://extensions → Load unpacked
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building extensions..."

# ── Firefox ──────────────────────────────────────────────────────────────────
rm -rf dist/firefox
mkdir -p dist/firefox

# Shared source files
cp -r shared/content         dist/firefox/content
cp -r shared/popup           dist/firefox/popup
cp -r shared/background      dist/firefox/background
cp    shared/browser-compat.js dist/firefox/browser-compat.js

# Firefox-specific files
cp    firefox/manifest.json              dist/firefox/manifest.json
cp    firefox/background/background.html dist/firefox/background/background.html
cp -r firefox/icons                      dist/firefox/icons

# The background page loads browser-compat.js from its own directory, so place
# a copy there too (background/browser-compat.js).
cp shared/browser-compat.js dist/firefox/background/browser-compat.js

echo "  ✓ dist/firefox/"

# ── Chrome ───────────────────────────────────────────────────────────────────
rm -rf dist/chrome
mkdir -p dist/chrome

# Shared source files
cp -r shared/content         dist/chrome/content
cp -r shared/popup           dist/chrome/popup
cp -r shared/background      dist/chrome/background
cp    shared/browser-compat.js dist/chrome/browser-compat.js

# Chrome-specific files
cp    chrome/manifest.json                    dist/chrome/manifest.json
cp    chrome/rules.json                       dist/chrome/rules.json
cp    chrome/background/service-worker.js     dist/chrome/background/service-worker.js
cp -r chrome/icons                            dist/chrome/icons

# The service worker imports browser-compat.js and main.js from its own
# directory, so place copies there.
cp shared/browser-compat.js dist/chrome/background/browser-compat.js

echo "  ✓ dist/chrome/"
echo ""
echo "Done. To load:"
echo "  Firefox: about:debugging → Load Temporary Add-on → dist/firefox/manifest.json"
echo "  Chrome:  chrome://extensions → Load unpacked → dist/chrome/"
