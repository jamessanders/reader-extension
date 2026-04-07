(function () {
  "use strict";

  if (window.__readAloudLoaded) return;
  window.__readAloudLoaded = true;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED",
    "SVG", "CANVAS", "VIDEO", "AUDIO", "IMG", "INPUT", "TEXTAREA",
    "SELECT", "BUTTON", "NAV", "FOOTER", "HEADER",
  ]);

  let sentences = [];
  let sentenceNodes = [];
  let currentIndex = -1;
  let state = "stopped";
  let rate = 1;
  let voiceName = "en-US-JennyNeural";
  let toolbar = null;
  let progressFill = null;
  let audioCtx = null;       // AudioContext — created on first play() (user gesture)
  let currentSource = null;  // AudioBufferSourceNode currently playing
  let generation = 0;        // bumped on stop/skip to cancel in-flight requests

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
        sentenceNodes.push({ node, start: m.index, end: m.index + m[0].length });
      }
    }
  }

  // ── Highlighting ──

  let activeHighlights = [];

  function highlightSentence(index) {
    clearHighlights();
    if (index < 0 || index >= sentenceNodes.length) return;
    const info = sentenceNodes[index];
    const range = document.createRange();
    try {
      range.setStart(info.node, info.start);
      range.setEnd(info.node, Math.min(info.end, info.node.textContent.length));
    } catch { return; }
    const span = document.createElement("span");
    span.className = "read-aloud-highlight";
    try {
      range.surroundContents(span);
      activeHighlights.push(span);
      span.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
  }

  function clearHighlights() {
    for (const span of activeHighlights) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    activeHighlights = [];
    if (sentences.length > 0) buildSentences();
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

  async function speakCurrent() {
    if (currentIndex < 0 || currentIndex >= sentences.length) {
      stop();
      return;
    }

    const gen = ++generation;
    stopAudio();
    highlightSentence(currentIndex);
    updateToolbar();

    let response;
    try {
      response = await browser.runtime.sendMessage({
        action: "synthesize",
        text: sentences[currentIndex],
        voice: voiceName,
        rate,
      });
    } catch (e) {
      if (gen === generation) stop();
      return;
    }

    if (gen !== generation) return;

    if (!response || response.error || !response.audioUrl) {
      currentIndex++;
      if (currentIndex < sentences.length && state === "playing") speakCurrent();
      else stop();
      return;
    }

    // Decode the MP3 data URL via the AudioContext (avoids autoplay restrictions)
    let audioBuffer;
    try {
      const ctx = ensureAudioContext();
      const resp = await fetch(response.audioUrl);
      const arrayBuf = await resp.arrayBuffer();
      audioBuffer = await ctx.decodeAudioData(arrayBuf);
    } catch (e) {
      if (gen === generation) {
        currentIndex++;
        if (currentIndex < sentences.length && state === "playing") speakCurrent();
        else stop();
      }
      return;
    }

    if (gen !== generation) return;

    const ctx = ensureAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    currentSource = source;

    source.onended = () => {
      if (gen !== generation) return;
      if (currentSource === source) currentSource = null;
      currentIndex++;
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
    speakCurrent();
    broadcastState();
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    // Suspend the AudioContext so no audio plays while paused
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
      // Resume the context — the current source node will continue from where it was
      audioCtx.resume().then(() => {
        updateToolbar();
        broadcastState();
      }).catch(() => {
        speakCurrent();
        updateToolbar();
        broadcastState();
      });
    } else {
      // Context was closed or not started — restart current sentence
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
    clearHighlights();
    removeToolbar();
    broadcastState();
  }

  function nextSentence() {
    if (currentIndex >= sentences.length - 1) return;
    generation++;
    stopAudio();
    browser.runtime.sendMessage({ action: "cancelSynthesis" }).catch(() => {});
    currentIndex++;
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
    currentIndex--;
    if (state === "playing" || state === "paused") {
      state = "playing";
      speakCurrent();
      broadcastState();
    }
  }

  function broadcastState() {
    browser.runtime.sendMessage({ action: "stateChanged", state }).catch(() => {});
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
        // Rate change takes effect on next sentence
        break;
      case "setVoice":
        voiceName = msg.voiceName;
        break;
      case "getState":
        sendResponse(state);
        return;
    }
  });
})();
