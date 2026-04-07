(function () {
  "use strict";

  if (window.__readAloudLoaded) return;
  window.__readAloudLoaded = true;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED",
    "SVG", "CANVAS", "VIDEO", "AUDIO", "IMG", "INPUT", "TEXTAREA",
    "SELECT", "BUTTON", "NAV", "FOOTER", "HEADER",
  ]);

  const MIN_BATCH_WORDS = 10;
  const MAX_BATCH_WORDS = 25;
  const MAX_BATCH_CHARS = 650;
  const HARD_MAX_CHARS = 1200;

  const BLOCK_TAGS = new Set([
    "P", "DIV", "ARTICLE", "SECTION", "BLOCKQUOTE",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "DT", "DD", "FIGCAPTION", "DETAILS", "SUMMARY",
    "PRE", "TABLE", "TR", "TD", "TH",
  ]);

  function nearestBlock(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement;
    return el || node.parentElement;
  }

  function hasSentenceEndingPunctuation(text) {
    return /[.!?…]["'»\])]*\s*$/.test((text || "").trim());
  }

  let sentences = [];
  let sentenceNodes = [];
  let currentIndex = -1;
  let state = "stopped";
  let rate = 1;
  let engine = "kokoro";       // "kokoro" | "edge"
  let voiceName = "af_heart";  // Kokoro voice name
  let edgeVoiceName = "en-US-JennyNeural"; // Edge TTS voice name
  let toolbar = null;
  let progressFill = null;
  let audioCtx = null;           // AudioContext — created on first play() (user gesture)
  let currentSource = null;      // AudioBufferSourceNode currently playing
  let generation = 0;            // bumped on stop/skip to cancel in-flight requests
  let currentBatchEndIndex = -1; // last sentence index of the batch currently playing

  // ── Prefetch Cache ──
  // Keyed by the batch's startIndex. Each entry is a Promise<AudioBuffer|null>
  // so speakCurrent can await it instantly if prefetching is already in flight.
  const prefetchCache = new Map();

  // ── Text Extraction ──

  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== "BODY") return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  function extractTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(p)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function buildSentences() {
    const article =
      document.querySelector("article") ||
      document.querySelector('[role="main"]') ||
      document.body;
    const textNodes = extractTextNodes(article);

    sentences = [];
    sentenceNodes = [];
    const re = /[^.!?…]+(?:[.!?…]+["'»\])]*|$)/g;

    for (const node of textNodes) {
      const text = node.textContent;
      let m;
      while ((m = re.exec(text)) !== null) {
        const s = m[0].trim();
        if (s.length < 2) continue;
        sentences.push(s);
        sentenceNodes.push({ node, start: m.index, end: m.index + m[0].length, block: nearestBlock(node) });
      }
    }
  }

  // ── Sentence Batching ──

  function buildBatch(startIndex) {
    if (startIndex < 0 || startIndex >= sentences.length) return null;

    const parts = [];
    let wordCount = 0;
    let charCount = 0;
    let i = startIndex;

    while (i < sentences.length) {
      const sentence = sentences[i];
      const sentenceChars = sentence.length;
      const separatorChars = parts.length ? 1 : 0; // " " between joined sentences
      const projectedChars = charCount + separatorChars + sentenceChars;

      // Keep requests bounded in length to avoid upstream TTS truncation.
      if (
        parts.length &&
        projectedChars > MAX_BATCH_CHARS &&
        hasSentenceEndingPunctuation(parts[parts.length - 1])
      ) {
        break;
      }

      parts.push(sentence);
      wordCount += sentence.trim().split(/\s+/).length;
      charCount = projectedChars;
      i++;

      if (charCount >= HARD_MAX_CHARS) break;

      if (wordCount >= MAX_BATCH_WORDS && hasSentenceEndingPunctuation(sentence)) break;

      if (wordCount >= MIN_BATCH_WORDS) {
        if (
          i < sentences.length &&
          sentenceNodes[i].block !== sentenceNodes[i - 1].block &&
          hasSentenceEndingPunctuation(sentence)
        ) {
          break;
        }
      }
    }

    // When consecutive sentences come from different block elements (e.g. a heading
    // followed by a paragraph), ensure the first ends with sentence-ending punctuation
    // so the TTS treats them as distinct sentences rather than running them together.
    const joined = parts.map((part, j) => {
      const nextIdx = startIndex + j + 1;
      if (
        j < parts.length - 1 &&
        nextIdx < sentenceNodes.length &&
        sentenceNodes[startIndex + j].block !== sentenceNodes[nextIdx].block &&
        !/[.!?…]\s*$/.test(part)
      ) {
        return part + ".";
      }
      return part;
    }).join(" ");

    return { text: joined, endIndex: i - 1 };
  }

  // ── Highlighting ──

  (function injectHighlightStyle() {
    const id = "__read-aloud-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    const dark = isPageDark();
    style.textContent = dark
      ? "::highlight(read-aloud) { background-color: rgba(99,102,241,0.45); color: inherit; }"
      : "::highlight(read-aloud) { background-color: #ffe066; color: #111; }";
    (document.head || document.documentElement).appendChild(style);
  })();

  const USE_CSS_HIGHLIGHTS = window.CSS && typeof CSS.highlights !== "undefined";
  let overlayContainer = null;

  function isPageDark() {
    const bg = getComputedStyle(document.documentElement).backgroundColor;
    const m = bg.match(/\d+\.?\d*/g);
    if (!m || m.length < 3) return false;
    const [r, g, b] = m.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }

  function highlightBatch(startIndex, endIndex) {
    clearHighlights();
    if (startIndex < 0 || startIndex >= sentenceNodes.length) return;
    const clampedEnd = Math.min(endIndex, sentenceNodes.length - 1);

    const ranges = [];
    for (let i = startIndex; i <= clampedEnd; i++) {
      const info = sentenceNodes[i];
      try {
        const range = document.createRange();
        range.setStart(info.node, info.start);
        range.setEnd(info.node, Math.min(info.end, info.node.textContent.length));
        ranges.push(range);
      } catch {}
    }
    if (!ranges.length) return;

    if (USE_CSS_HIGHLIGHTS) {
      CSS.highlights.set("read-aloud", new Highlight(...ranges));
    } else {
      if (!overlayContainer) {
        overlayContainer = document.createElement("div");
        overlayContainer.id = "__read-aloud-overlays";
        Object.assign(overlayContainer.style, {
          position: "fixed", top: "0", left: "0",
          width: "0", height: "0", overflow: "visible",
          pointerEvents: "none", zIndex: "2147483646",
        });
        document.documentElement.appendChild(overlayContainer);
      }
      const dark = isPageDark();
      const overlayColor = dark ? "rgba(99, 102, 241, 0.45)" : "rgba(255, 224, 102, 0.5)";
      const overlayMix = dark ? "normal" : "multiply";
      for (const range of ranges) {
        for (const rect of range.getClientRects()) {
          const div = document.createElement("div");
          Object.assign(div.style, {
            position: "fixed",
            top: rect.top + "px", left: rect.left + "px",
            width: rect.width + "px", height: rect.height + "px",
            background: overlayColor,
            mixBlendMode: overlayMix,
            pointerEvents: "none",
          });
          overlayContainer.appendChild(div);
        }
      }
    }

    try {
      const firstEl = sentenceNodes[startIndex].node.parentElement;
      if (firstEl) firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
  }

  function clearHighlights() {
    if (USE_CSS_HIGHLIGHTS) {
      CSS.highlights.delete("read-aloud");
    } else if (overlayContainer) {
      overlayContainer.innerHTML = "";
    }
  }

  // ── Toolbar ──

  function createToolbar() {
    if (toolbar) return;
    toolbar = document.createElement("div");
    toolbar.className = "read-aloud-toolbar";
    toolbar.innerHTML = `
      <button data-action="prev">⏮</button>
      <button data-action="toggle">⏸</button>
      <button data-action="next">⏭</button>
      <div class="bar-progress"><div class="bar-fill" style="width:0%"></div></div>
      <span class="bar-index"></span>
      <span class="bar-loading" title="Generating audio…" aria-label="Generating audio" hidden>
        <span class="bar-loading-dot"></span>
        <span class="bar-loading-dot"></span>
        <span class="bar-loading-dot"></span>
      </span>
      <button data-action="stop" class="close-btn">✕</button>
    `;
    document.documentElement.appendChild(toolbar);
    progressFill = toolbar.querySelector(".bar-fill");
    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === "toggle") { state === "playing" ? pause() : resume(); }
      else if (a === "prev") prevSentence();
      else if (a === "next") nextSentence();
      else if (a === "stop") stop();
    });
    requestAnimationFrame(() => toolbar.classList.add("visible"));
  }

  function removeToolbar() {
    if (!toolbar) return;
    toolbar.classList.remove("visible");
    setTimeout(() => { if (toolbar) { toolbar.remove(); toolbar = null; } }, 300);
  }

  function setGenerating(on) {
    if (!toolbar) return;
    const el = toolbar.querySelector(".bar-loading");
    if (el) el.hidden = !on;
  }

  function updateToolbar() {
    if (!toolbar) return;
    toolbar.querySelector('[data-action="toggle"]').textContent =
      state === "playing" ? "⏸" : "▶";
    const idx = toolbar.querySelector(".bar-index");
    idx.textContent = sentences.length ? `${currentIndex + 1} / ${sentences.length}` : "";
    if (progressFill && sentences.length) {
      progressFill.style.width = ((currentIndex + 1) / sentences.length * 100) + "%";
    }
  }

  // ── Audio Playback (both engines return an audio URL from background) ──

  function ensureAudioContext() {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function stopAudio() {
    if (currentSource) {
      try { currentSource.stop(); } catch (_) {}
      currentSource.disconnect();
      currentSource = null;
    }
  }

  function activeVoice() {
    return engine === "edge" ? edgeVoiceName : voiceName;
  }

  // Fetches and decodes audio for a batch starting at startIndex.
  // Returns Promise<AudioBuffer|null>, stored in prefetchCache.
  function prefetchBatch(startIndex) {
    if (prefetchCache.has(startIndex)) return prefetchCache.get(startIndex);
    if (startIndex < 0 || startIndex >= sentences.length) return Promise.resolve(null);

    const batch = buildBatch(startIndex);
    if (!batch) return Promise.resolve(null);

    const promise = (async () => {
      let response;
      try {
        response = await browser.runtime.sendMessage({
          action: "synthesize",
          engine,
          text: batch.text,
          voice: activeVoice(),
          rate,
        });
      } catch { return null; }

      if (!response || response.error || !response.audioUrl) return null;

      try {
        const ctx = ensureAudioContext();
        const resp = await fetch(response.audioUrl);
        const arrayBuf = await resp.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuf);
      } catch { return null; }
    })();

    prefetchCache.set(startIndex, promise);
    return promise;
  }

  async function speakCurrent() {
    if (currentIndex < 0 || currentIndex >= sentences.length) {
      stop();
      return;
    }

    const gen = ++generation;
    stopAudio();

    const batch = buildBatch(currentIndex);
    if (!batch) { stop(); return; }

    currentBatchEndIndex = batch.endIndex;
    highlightBatch(currentIndex, batch.endIndex);
    updateToolbar();

    setGenerating(true);
    const audioBuffer = await prefetchBatch(currentIndex);
    prefetchCache.delete(currentIndex);
    setGenerating(false);

    if (gen !== generation) return;

    if (!audioBuffer) {
      currentIndex = batch.endIndex + 1;
      if (currentIndex < sentences.length && state === "playing") speakCurrent();
      else stop();
      return;
    }

    const ctx = ensureAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    currentSource = source;

    const nextBatchStart = batch.endIndex + 1;
    if (nextBatchStart < sentences.length) {
      prefetchBatch(nextBatchStart);
    }

    source.onended = () => {
      if (gen !== generation) return;
      if (currentSource === source) currentSource = null;
      currentIndex = batch.endIndex + 1;
      if (currentIndex < sentences.length && state === "playing") {
        speakCurrent();
      } else {
        stop();
      }
    };

    source.start(0);
  }

  // ── Playback Controls ──

  function play(options = {}) {
    if (options.rate !== undefined) rate = options.rate;
    if (options.voiceName) voiceName = options.voiceName;
    if (options.engine) engine = options.engine;
    if (options.edgeVoiceName) edgeVoiceName = options.edgeVoiceName;

    if (state === "paused") { resume(); return; }

    ensureAudioContext();

    buildSentences();
    if (sentences.length === 0) return;

    currentIndex = 0;
    state = "playing";
    createToolbar();
    attachClickHandler();
    speakCurrent();
    broadcastState();
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    if (audioCtx && audioCtx.state === "running") {
      audioCtx.suspend().catch(() => {});
    }
    updateToolbar();
    broadcastState();
  }

  function resume() {
    if (state !== "paused") return;
    state = "playing";
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().then(() => {
        updateToolbar();
        broadcastState();
      }).catch(() => {
        speakCurrent();
        updateToolbar();
        broadcastState();
      });
    } else {
      speakCurrent();
      updateToolbar();
      broadcastState();
    }
  }

  function stop() {
    generation++;
    stopAudio();
    browser.runtime.sendMessage({ action: "cancelSynthesis" }).catch(() => {});
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    state = "stopped";
    currentIndex = -1;
    currentBatchEndIndex = -1;
    prefetchCache.clear();
    detachClickHandler();
    clearHighlights();
    removeToolbar();
    broadcastState();
  }

  function nextSentence() {
    const nextIndex = currentBatchEndIndex >= currentIndex
      ? currentBatchEndIndex + 1
      : currentIndex + 1;
    if (nextIndex >= sentences.length) return;
    generation++;
    stopAudio();
    browser.runtime.sendMessage({ action: "cancelSynthesis" }).catch(() => {});
    currentIndex = nextIndex;
    if (state === "playing" || state === "paused") {
      state = "playing";
      speakCurrent();
      broadcastState();
    }
  }

  function prevSentence() {
    if (currentIndex <= 0) return;
    generation++;
    stopAudio();
    browser.runtime.sendMessage({ action: "cancelSynthesis" }).catch(() => {});
    currentIndex = Math.max(0, currentIndex - 1);
    if (state === "playing" || state === "paused") {
      state = "playing";
      speakCurrent();
      broadcastState();
    }
  }

  function broadcastState() {
    browser.runtime.sendMessage({ action: "stateChanged", state }).catch(() => {});
  }

  // ── Click-to-Seek ──

  function sentenceIndexFromClick(e) {
    if (!sentences.length) return -1;

    let clickedNode = null;
    let clickedOffset = 0;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) { clickedNode = pos.offsetNode; clickedOffset = pos.offset; }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) { clickedNode = range.startContainer; clickedOffset = range.startOffset; }
    }

    if (clickedNode && clickedNode.nodeType === Node.TEXT_NODE) {
      for (let i = 0; i < sentenceNodes.length; i++) {
        const sn = sentenceNodes[i];
        if (sn.node === clickedNode && clickedOffset >= sn.start && clickedOffset <= sn.end) {
          return i;
        }
      }
      let best = -1;
      for (let i = 0; i < sentenceNodes.length; i++) {
        if (sentenceNodes[i].node === clickedNode && sentenceNodes[i].start <= clickedOffset) {
          best = i;
        }
      }
      if (best !== -1) return best;
    }

    const target = e.target;
    for (let i = 0; i < sentenceNodes.length; i++) {
      if (target.contains(sentenceNodes[i].node)) return i;
    }

    return -1;
  }

  function handleDocumentClick(e) {
    if (state === "stopped") return;
    if (toolbar && toolbar.contains(e.target)) return;

    const idx = sentenceIndexFromClick(e);
    if (idx === -1 || idx === currentIndex) return;

    generation++;
    stopAudio();
    browser.runtime.sendMessage({ action: "cancelSynthesis" }).catch(() => {});
    currentIndex = idx;
    state = "playing";
    speakCurrent();
    broadcastState();
  }

  function attachClickHandler() {
    document.removeEventListener("click", handleDocumentClick, true);
    document.addEventListener("click", handleDocumentClick, true);
  }

  function detachClickHandler() {
    document.removeEventListener("click", handleDocumentClick, true);
  }

  // ── Message Handling ──

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case "play":
        play(msg);
        break;
      case "pause":
        pause();
        break;
      case "stop":
        stop();
        break;
      case "next":
        nextSentence();
        break;
      case "prev":
        prevSentence();
        break;
      case "setRate":
        rate = msg.rate;
        prefetchCache.clear();
        break;
      case "setVoice":
        voiceName = msg.voiceName;
        prefetchCache.clear();
        break;
      case "setEdgeVoice":
        edgeVoiceName = msg.edgeVoiceName;
        prefetchCache.clear();
        break;
      case "setEngine":
        engine = msg.engine;
        prefetchCache.clear();
        break;
      case "getState":
        sendResponse(state);
        return;
    }
  });
})();
