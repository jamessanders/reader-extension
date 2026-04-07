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
  const MAX_BATCH_WORDS = 300;

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

  let sentences = [];
  let sentenceNodes = [];
  let currentIndex = -1;
  let state = "stopped";
  let rate = 1;
  let voiceName = "en-US-JennyNeural";
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

  // Returns { text, endIndex } where text is one or more complete sentences
  // ending at a paragraph boundary within [MIN_BATCH_WORDS, MAX_BATCH_WORDS],
  // or at MAX_BATCH_WORDS if no paragraph boundary falls in range, or earlier
  // if the remaining content is exhausted.
  function buildBatch(startIndex) {
    if (startIndex < 0 || startIndex >= sentences.length) return null;

    const parts = [];
    let wordCount = 0;
    let i = startIndex;

    while (i < sentences.length) {
      const sentence = sentences[i];
      parts.push(sentence);
      wordCount += sentence.trim().split(/\s+/).length;
      i++;

      if (wordCount >= MAX_BATCH_WORDS) break;

      if (wordCount >= MIN_BATCH_WORDS) {
        // Break at a paragraph boundary if the next sentence starts a new block.
        if (i < sentences.length && sentenceNodes[i].block !== sentenceNodes[i - 1].block) break;
      }
    }

    return { text: parts.join(" "), endIndex: i - 1 };
  }

  // ── Highlighting ──
  //
  // We use the CSS Custom Highlight API (Chrome 105+, Firefox 119+) which
  // highlights text via Range objects WITHOUT mutating the DOM. This means
  // sentenceNodes references never go stale between highlights — which was
  // the root cause of out-of-order reading and incorrect highlighting when
  // the old surroundContents / buildSentences approach was used.

  (function injectHighlightStyle() {
    const id = "__read-aloud-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "::highlight(read-aloud) { background-color: #ffe066; color: inherit; }";
    (document.head || document.documentElement).appendChild(style);
  })();

  const USE_CSS_HIGHLIGHTS = window.CSS && typeof CSS.highlights !== "undefined";

  // Fallback overlay container for browsers without the CSS Highlight API.
  let overlayContainer = null;

  function highlightSentence(index) {
    highlightBatch(index, index);
  }

  function highlightBatch(startIndex, endIndex) {
    clearHighlights();
    if (startIndex < 0 || startIndex >= sentenceNodes.length) return;
    const clampedEnd = Math.min(endIndex, sentenceNodes.length - 1);

    // Build Range objects for each sentence in the batch.
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
      // Zero DOM mutation — the browser paints the highlight natively.
      CSS.highlights.set("read-aloud", new Highlight(...ranges));
    } else {
      // Fallback: absolutely-positioned overlay divs derived from client rects.
      // Still no DOM mutation — overlays live in a separate fixed container.
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
      for (const range of ranges) {
        for (const rect of range.getClientRects()) {
          const div = document.createElement("div");
          Object.assign(div.style, {
            position: "fixed",
            top: rect.top + "px", left: rect.left + "px",
            width: rect.width + "px", height: rect.height + "px",
            background: "rgba(255, 224, 102, 0.5)",
            pointerEvents: "none",
          });
          overlayContainer.appendChild(div);
        }
      }
    }

    // Scroll the first sentence of the batch into view.
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
    // No DOM mutation means sentenceNodes references stay valid — no rebuild needed.
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

  // ── Audio Playback via Edge TTS ──

  // AudioContext must be created during a user-gesture call (play()), then it
  // stays unlocked for all subsequent async playback via start().
  function ensureAudioContext() {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContext();
    }
    // Resume in case the browser suspended it (tab hidden, etc.)
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

  // Fetches and decodes audio for a batch starting at startIndex.
  // Returns a Promise<AudioBuffer|null> and stores it in prefetchCache.
  // Safe to call speculatively — generation checks prevent stale results
  // from ever reaching the speaker.
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
          text: batch.text,
          voice: voiceName,
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

    // Build a batch of sentences starting at currentIndex, targeting at least
    // MIN_BATCH_WORDS words while always ending on a complete sentence.
    const batch = buildBatch(currentIndex);
    if (!batch) { stop(); return; }

    currentBatchEndIndex = batch.endIndex;
    highlightBatch(currentIndex, batch.endIndex);
    updateToolbar();

    // Await the audio for this batch — will resolve immediately if prefetched.
    const audioBuffer = await prefetchBatch(currentIndex);
    // Remove from cache now that we've consumed it.
    prefetchCache.delete(currentIndex);

    if (gen !== generation) return;

    if (!audioBuffer) {
      // Synthesis failed — skip the entire batch and try the next one.
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

    // Kick off prefetch of the next batch while this one plays.
    const nextBatchStart = batch.endIndex + 1;
    if (nextBatchStart < sentences.length) {
      prefetchBatch(nextBatchStart);
    }

    source.onended = () => {
      if (gen !== generation) return;
      if (currentSource === source) currentSource = null;
      // Advance past the entire batch that just finished.
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
    if (options.rate) rate = options.rate;
    if (options.voiceName) voiceName = options.voiceName;

    if (state === "paused") { resume(); return; }

    // Create/unlock the AudioContext NOW while we're in the user-gesture window.
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
    // Suspend the AudioContext so no audio plays while paused.
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
      // Resume the context — the current source node will continue from where it was.
      audioCtx.resume().then(() => {
        updateToolbar();
        broadcastState();
      }).catch(() => {
        speakCurrent();
        updateToolbar();
        broadcastState();
      });
    } else {
      // Context was closed or not started — restart current sentence.
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
    // Jump past the entire current batch, not just one sentence.
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
    // Step back to just before the current batch so speakCurrent re-batches from there.
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

    // Exact text-node hit — find the sentence whose range contains the offset.
    if (clickedNode && clickedNode.nodeType === Node.TEXT_NODE) {
      for (let i = 0; i < sentenceNodes.length; i++) {
        const sn = sentenceNodes[i];
        if (sn.node === clickedNode && clickedOffset >= sn.start && clickedOffset <= sn.end) {
          return i;
        }
      }
      // Same text node but between sentences — return the last one before the offset.
      let best = -1;
      for (let i = 0; i < sentenceNodes.length; i++) {
        if (sentenceNodes[i].node === clickedNode && sentenceNodes[i].start <= clickedOffset) {
          best = i;
        }
      }
      if (best !== -1) return best;
    }

    // Fallback: first sentence whose text node lives inside the clicked element.
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
        prefetchCache.clear(); // stale audio encoded at old rate
        break;
      case "setVoice":
        voiceName = msg.voiceName;
        prefetchCache.clear(); // stale audio for old voice
        break;
      case "getState":
        sendResponse(state);
        return;
    }
  });
})();
