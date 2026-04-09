(function () {
  // Kokoro voices ordered by quality grade (A → F).
  // Grades from: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
  // Star mapping: A/A- → ★★★★★  B- → ★★★★  C+ → ★★★  C/C- → ★★  D+/D/D-/F+ → ★
  const KOKORO_VOICES = [
    // Grade A / A-
    { name: "af_heart",    label: "Heart (US, Female) ★★★★★" },
    { name: "af_bella",    label: "Bella (US, Female) ★★★★★" },
    // Grade B-
    { name: "af_nicole",   label: "Nicole (US, Female) ★★★★" },
    { name: "bf_emma",     label: "Emma (UK, Female) ★★★★" },
    // Grade C+
    { name: "af_aoede",    label: "Aoede (US, Female) ★★★" },
    { name: "af_kore",     label: "Kore (US, Female) ★★★" },
    { name: "af_sarah",    label: "Sarah (US, Female) ★★★" },
    { name: "am_fenrir",   label: "Fenrir (US, Male) ★★★" },
    { name: "am_michael",  label: "Michael (US, Male) ★★★" },
    { name: "am_puck",     label: "Puck (US, Male) ★★★" },
    // Grade C / C-
    { name: "af_alloy",    label: "Alloy (US, Female) ★★" },
    { name: "af_nova",     label: "Nova (US, Female) ★★" },
    { name: "af_sky",      label: "Sky (US, Female) ★★" },
    { name: "bf_isabella", label: "Isabella (UK, Female) ★★" },
    { name: "bm_fable",    label: "Fable (UK, Male) ★★" },
    { name: "bm_george",   label: "George (UK, Male) ★★" },
    // Grade D+ / D / D- / F+
    { name: "bm_lewis",    label: "Lewis (UK, Male) ★" },
    { name: "af_jessica",  label: "Jessica (US, Female) ★" },
    { name: "af_river",    label: "River (US, Female) ★" },
    { name: "am_echo",     label: "Echo (US, Male) ★" },
    { name: "am_eric",     label: "Eric (US, Male) ★" },
    { name: "am_liam",     label: "Liam (US, Male) ★" },
    { name: "am_onyx",     label: "Onyx (US, Male) ★" },
    { name: "bf_alice",    label: "Alice (UK, Female) ★" },
    { name: "bf_lily",     label: "Lily (UK, Female) ★" },
    { name: "bm_daniel",   label: "Daniel (UK, Male) ★" },
    { name: "am_santa",    label: "Santa (US, Male) ★" },
    { name: "am_adam",     label: "Adam (US, Male) ★" },
  ];

  // Microsoft Edge neural voices via the Read Aloud WebSocket API.
  const EDGE_VOICES = [
    { name: "en-US-JennyNeural",                   label: "Jenny (US, Female)" },
    { name: "en-US-AriaNeural",                    label: "Aria (US, Female)" },
    { name: "en-US-AvaNeural",                     label: "Ava (US, Female)" },
    { name: "en-US-EmmaNeural",                    label: "Emma (US, Female)" },
    { name: "en-US-AnaNeural",                     label: "Ana (US, Female)" },
    { name: "en-US-MichelleNeural",                label: "Michelle (US, Female)" },
    { name: "en-US-GuyNeural",                     label: "Guy (US, Male)" },
    { name: "en-US-AndrewNeural",                  label: "Andrew (US, Male)" },
    { name: "en-US-BrianNeural",                   label: "Brian (US, Male)" },
    { name: "en-US-ChristopherNeural",             label: "Christopher (US, Male)" },
    { name: "en-US-EricNeural",                    label: "Eric (US, Male)" },
    { name: "en-US-RogerNeural",                   label: "Roger (US, Male)" },
    { name: "en-US-SteffanNeural",                 label: "Steffan (US, Male)" },
    { name: "en-GB-SoniaNeural",                   label: "Sonia (UK, Female)" },
    { name: "en-GB-RyanNeural",                    label: "Ryan (UK, Male)" },
    { name: "en-AU-NatashaNeural",                 label: "Natasha (AU, Female)" },
    { name: "en-AU-WilliamMultilingualNeural",     label: "William (AU, Male)" },
    { name: "en-CA-ClaraNeural",                   label: "Clara (CA, Female)" },
    { name: "en-CA-LiamNeural",                    label: "Liam (CA, Male)" },
    { name: "en-IN-NeerjaNeural",                  label: "Neerja (IN, Female)" },
    { name: "en-IN-PrabhatNeural",                 label: "Prabhat (IN, Male)" },
  ];

  const DEFAULT_SERVICE_URL = "http://localhost:5423";

  const btnPlay      = document.getElementById("btn-play");
  const btnStop      = document.getElementById("btn-stop");
  const btnBack      = document.getElementById("btn-back");
  const btnForward   = document.getElementById("btn-forward");
  const iconPlay     = document.getElementById("icon-play");
  const iconPause    = document.getElementById("icon-pause");
  const speedSlider  = document.getElementById("speed");
  const speedVal     = document.getElementById("speed-val");
  const engineSelect = document.getElementById("engine");
  const kokoroVoice  = document.getElementById("kokoro-voice");
  const edgeVoice    = document.getElementById("edge-voice");
  const statusEl     = document.getElementById("status");
  const serviceInput    = document.getElementById("service-url");
  const serviceDot      = document.getElementById("service-dot");
  const serviceHint     = document.getElementById("service-hint");
  const lmStudioInput   = document.getElementById("lmstudio-url");
  const lmStudioDot     = document.getElementById("lmstudio-dot");
  const lmStudioHint    = document.getElementById("lmstudio-hint");
  const lmStudioEnabled = document.getElementById("lmstudio-enabled");
  const lmStudioUrlRow  = document.getElementById("lmstudio-url-row");

  const DEFAULT_LMSTUDIO_URL = "http://localhost:1234";

  const kokoroOnlyEls = document.querySelectorAll(".kokoro-only");
  const edgeOnlyEls   = document.querySelectorAll(".edge-only");

  let currentState = "stopped";
  let checkTimeout = null;

  function sendToContent(action, data = {}) {
    return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (!tabs[0]) return;
      return browser.tabs.sendMessage(tabs[0].id, { action, ...data });
    });
  }

  // ── Playback state UI ──

  function updateUI(state) {
    currentState = state;
    if (state === "playing") {
      iconPlay.classList.add("hidden");
      iconPause.classList.remove("hidden");
      statusEl.textContent = "Playing";
      statusEl.className = "status playing";
    } else if (state === "paused") {
      iconPlay.classList.remove("hidden");
      iconPause.classList.add("hidden");
      statusEl.textContent = "Paused";
      statusEl.className = "status paused";
    } else {
      iconPlay.classList.remove("hidden");
      iconPause.classList.add("hidden");
      statusEl.textContent = "Stopped";
      statusEl.className = "status";
    }
  }

  // ── Engine UI ──

  function applyEngineUI(eng) {
    if (eng === "edge") {
      kokoroOnlyEls.forEach((el) => el.classList.add("hidden"));
      edgeOnlyEls.forEach((el) => el.classList.remove("hidden"));
    } else {
      kokoroOnlyEls.forEach((el) => el.classList.remove("hidden"));
      edgeOnlyEls.forEach((el) => el.classList.add("hidden"));
    }
  }

  // ── Service health check ──

  function setServiceStatus(dotState, hint) {
    serviceDot.className = "service-dot " + dotState;
    serviceHint.textContent = hint;
  }

  async function checkService(url) {
    setServiceStatus("checking", "Checking…");
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.modelReady) {
        setServiceStatus("ok", "Connected — model ready");
      } else {
        setServiceStatus("warming", "Connected — model loading…");
      }
    } catch {
      setServiceStatus("error", "Unreachable — is the service running?");
    }
  }

  function setLmStudioStatus(dotState, hint) {
    lmStudioDot.className = "service-dot " + dotState;
    lmStudioHint.textContent = hint;
  }

  async function checkLmStudio(url) {
    if (!lmStudioEnabled.checked) {
      setLmStudioStatus("", "");
      return;
    }
    setLmStudioStatus("checking", "Checking…");
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const modelCount = body.data?.length ?? 0;
      if (modelCount > 0) {
        const modelName = body.data[0].id || "model";
        setLmStudioStatus("ok", `Connected — ${modelName}`);
      } else {
        setLmStudioStatus("warming", "Connected — no model loaded");
      }
    } catch {
      setLmStudioStatus("error", "Unreachable — is the LLM service running?");
    }
  }

  function applyLmStudioUI(enabled) {
    lmStudioUrlRow.style.opacity = enabled ? "" : "0.4";
    lmStudioInput.disabled = !enabled;
    if (!enabled) {
      setLmStudioStatus("", "Disabled — text sent to Kokoro as-is");
    } else {
      const url = lmStudioInput.value.trim() || DEFAULT_LMSTUDIO_URL;
      checkLmStudio(url);
    }
  }

  // ── Voice lists ──

  function populateVoices(select, voices, selectedName) {
    select.innerHTML = "";
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.label;
      select.appendChild(opt);
    }
    const match = voices.find((v) => v.name === selectedName);
    select.value = match ? selectedName : voices[0].name;
  }

  // ── Event Listeners ──

  btnPlay.addEventListener("click", () => {
    if (currentState === "playing") {
      sendToContent("pause");
      updateUI("paused");
    } else {
      sendToContent("play", {
        rate: parseFloat(speedSlider.value),
        engine: engineSelect.value,
        voiceName: kokoroVoice.value,
        edgeVoiceName: edgeVoice.value,
      });
      updateUI("playing");
    }
  });

  btnStop.addEventListener("click", () => {
    sendToContent("stop");
    updateUI("stopped");
  });

  btnBack.addEventListener("click", () => sendToContent("prev"));
  btnForward.addEventListener("click", () => sendToContent("next"));

  speedSlider.addEventListener("input", () => {
    const r = parseFloat(speedSlider.value);
    speedVal.textContent = r + "×";
    sendToContent("setRate", { rate: r });
    browser.storage.local.set({ rate: r });
  });

  engineSelect.addEventListener("change", () => {
    const eng = engineSelect.value;
    applyEngineUI(eng);
    sendToContent("setEngine", { engine: eng });
    browser.storage.local.set({ engine: eng });
    if (eng === "kokoro") {
      const url = serviceInput.value.trim() || DEFAULT_SERVICE_URL;
      checkService(url);
    }
  });

  kokoroVoice.addEventListener("change", () => {
    const vn = kokoroVoice.value;
    sendToContent("setVoice", { voiceName: vn });
    browser.storage.local.set({ voiceName: vn });
  });

  edgeVoice.addEventListener("change", () => {
    const vn = edgeVoice.value;
    sendToContent("setEdgeVoice", { edgeVoiceName: vn });
    browser.storage.local.set({ edgeVoiceName: vn });
  });

  serviceInput.addEventListener("input", () => {
    clearTimeout(checkTimeout);
    const url = serviceInput.value.trim() || DEFAULT_SERVICE_URL;
    checkTimeout = setTimeout(() => {
      browser.storage.local.set({ serviceUrl: url });
      checkService(url);
    }, 600);
  });

  let lmStudioCheckTimeout = null;

  lmStudioEnabled.addEventListener("change", () => {
    const enabled = lmStudioEnabled.checked;
    browser.storage.local.set({ lmStudioEnabled: enabled });
    applyLmStudioUI(enabled);
  });

  lmStudioInput.addEventListener("input", () => {
    clearTimeout(lmStudioCheckTimeout);
    const url = lmStudioInput.value.trim() || DEFAULT_LMSTUDIO_URL;
    lmStudioCheckTimeout = setTimeout(() => {
      browser.storage.local.set({ lmStudioUrl: url });
      if (lmStudioEnabled.checked) checkLmStudio(url);
    }, 600);
  });

  // ── Restore saved settings ──

  browser.storage.local.get(["rate", "voiceName", "edgeVoiceName", "engine", "serviceUrl", "lmStudioUrl", "lmStudioEnabled"])
    .then((res) => {
      if (res.rate) {
        speedSlider.value = res.rate;
        speedVal.textContent = res.rate + "×";
      }

      const eng = res.engine || "kokoro";
      engineSelect.value = eng;
      applyEngineUI(eng);

      populateVoices(kokoroVoice, KOKORO_VOICES, res.voiceName || KOKORO_VOICES[0].name);
      populateVoices(edgeVoice, EDGE_VOICES, res.edgeVoiceName || EDGE_VOICES[0].name);

      const url = res.serviceUrl || DEFAULT_SERVICE_URL;
      serviceInput.value = url === DEFAULT_SERVICE_URL ? "" : url;
      if (eng === "kokoro") checkService(url);

      const lmEnabled = !!res.lmStudioEnabled;
      lmStudioEnabled.checked = lmEnabled;
      const lmUrl = res.lmStudioUrl || DEFAULT_LMSTUDIO_URL;
      lmStudioInput.value = lmUrl === DEFAULT_LMSTUDIO_URL ? "" : lmUrl;
      if (eng === "kokoro") applyLmStudioUI(lmEnabled);
    });

  // Sync playback state with the content script.
  sendToContent("getState").then((s) => { if (s) updateUI(s); });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.action === "stateChanged") updateUI(msg.state);
  });
})();
