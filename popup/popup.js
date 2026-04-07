(function () {
  const VOICES = [
    { name: "en-US-JennyNeural", label: "Jenny (US, Female)" },
    { name: "en-US-AriaNeural", label: "Aria (US, Female)" },
    { name: "en-US-AvaNeural", label: "Ava (US, Female)" },
    { name: "en-US-EmmaNeural", label: "Emma (US, Female)" },
    { name: "en-US-AnaNeural", label: "Ana (US, Female)" },
    { name: "en-US-MichelleNeural", label: "Michelle (US, Female)" },
    { name: "en-US-GuyNeural", label: "Guy (US, Male)" },
    { name: "en-US-AndrewNeural", label: "Andrew (US, Male)" },
    { name: "en-US-BrianNeural", label: "Brian (US, Male)" },
    { name: "en-US-ChristopherNeural", label: "Christopher (US, Male)" },
    { name: "en-US-EricNeural", label: "Eric (US, Male)" },
    { name: "en-US-RogerNeural", label: "Roger (US, Male)" },
    { name: "en-US-SteffanNeural", label: "Steffan (US, Male)" },
    { name: "en-GB-SoniaNeural", label: "Sonia (UK, Female)" },
    { name: "en-GB-RyanNeural", label: "Ryan (UK, Male)" },
    { name: "en-AU-NatashaNeural", label: "Natasha (AU, Female)" },
    { name: "en-AU-WilliamMultilingualNeural", label: "William (AU, Male)" },
    { name: "en-CA-ClaraNeural", label: "Clara (CA, Female)" },
    { name: "en-CA-LiamNeural", label: "Liam (CA, Male)" },
    { name: "en-IN-NeerjaNeural", label: "Neerja (IN, Female)" },
    { name: "en-IN-PrabhatNeural", label: "Prabhat (IN, Male)" },
  ];

  const btnPlay = document.getElementById("btn-play");
  const btnStop = document.getElementById("btn-stop");
  const btnBack = document.getElementById("btn-back");
  const btnForward = document.getElementById("btn-forward");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const speedSlider = document.getElementById("speed");
  const speedVal = document.getElementById("speed-val");
  const voiceSelect = document.getElementById("voice");
  const statusEl = document.getElementById("status");

  let currentState = "stopped";

  function sendToContent(action, data = {}) {
    return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (!tabs[0]) return;
      return browser.tabs.sendMessage(tabs[0].id, { action, ...data });
    });
  }

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

  function populateVoices(selectedName) {
    voiceSelect.innerHTML = "";
    for (const v of VOICES) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.label;
      voiceSelect.appendChild(opt);
    }
    if (selectedName) voiceSelect.value = selectedName;
  }

  btnPlay.addEventListener("click", () => {
    if (currentState === "playing") {
      sendToContent("pause");
      updateUI("paused");
    } else {
      sendToContent("play", {
        rate: parseFloat(speedSlider.value),
        voiceName: voiceSelect.value,
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

  voiceSelect.addEventListener("change", () => {
    const vn = voiceSelect.value;
    sendToContent("setVoice", { voiceName: vn });
    browser.storage.local.set({ voiceName: vn });
  });

  // Restore saved settings
  browser.storage.local.get(["rate", "voiceName"]).then((res) => {
    if (res.rate) {
      speedSlider.value = res.rate;
      speedVal.textContent = res.rate + "×";
    }
    populateVoices(res.voiceName || VOICES[0].name);
  });

  // Sync state with content script
  sendToContent("getState").then((s) => { if (s) updateUI(s); });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.action === "stateChanged") updateUI(msg.state);
  });
})();
