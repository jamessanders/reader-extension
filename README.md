# Read Aloud — Firefox Extension

A Firefox extension that reads webpage text aloud with sentence-by-sentence highlighting, adjustable speed, and voice selection — similar to Microsoft Edge's Read Aloud feature.

## Features

- **Text-to-Speech** using the browser's built-in Web Speech API
- **Sentence highlighting** — the current sentence is highlighted and scrolled into view
- **Floating toolbar** on the page with play/pause, skip, progress bar, and stop
- **Popup controls** — play/pause, previous/next sentence, speed slider (0.5×–3×), voice picker
- **Smart text extraction** — skips nav, footer, scripts, hidden elements; prefers `<article>` or `[role="main"]` content
- **Persisted settings** — speed and voice selection are remembered across sessions

## Installation (Temporary / Development)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on…"**
3. Select the `manifest.json` file from this directory
4. The Read Aloud icon will appear in your toolbar

## Usage

1. Navigate to any webpage
2. Click the **Read Aloud** toolbar icon to open the popup
3. Press **Play** — the extension will extract the page text and start reading
4. Use the popup or the floating on-page toolbar to:
   - **Pause / Resume** playback
   - **Skip forward / back** one sentence
   - **Stop** reading entirely
   - **Adjust speed** with the slider
   - **Change voice** from the dropdown

## Project Structure

```
read-extension/
├── manifest.json          # Extension manifest (Manifest V2)
├── background/
│   └── background.js      # Relays state between content ↔ popup
├── content/
│   ├── reader.js          # Core: text extraction, TTS, highlighting
│   └── reader.css         # Highlight + toolbar styles
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic
└── icons/
    ├── icon-48.svg
    └── icon-96.svg
```
