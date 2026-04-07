(function () {
  "use strict";

  // The MS TTS service validates that requests appear to come from the
  // real Edge Read Aloud extension. We intercept WebSocket upgrade requests
  // to speech.platform.bing.com and spoof the required headers.
  const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
  const EDGE_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
    " (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

  function setHeader(headers, name, value) {
    const lower = name.toLowerCase();
    const existing = headers.find((h) => h.name.toLowerCase() === lower);
    if (existing) {
      existing.value = value;
    } else {
      headers.push({ name, value });
    }
  }

  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const headers = details.requestHeaders || [];
      setHeader(headers, "Origin", EDGE_ORIGIN);
      setHeader(headers, "User-Agent", EDGE_UA);
      setHeader(headers, "Pragma", "no-cache");
      setHeader(headers, "Cache-Control", "no-cache");
      return { requestHeaders: headers };
    },
    { urls: ["*://speech.platform.bing.com/*"] },
    ["blocking", "requestHeaders"]
  );

  // Handle TTS synthesis requests from the content script
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === "synthesize") {
      const ratePercent = Math.round((msg.rate - 1) * 100);
      return self.edgeTTS
        .synthesize(msg.text, msg.voice, ratePercent)
        .then((dataUrl) => {
          if (!dataUrl) return { error: "No audio received from TTS service" };
          return { audioUrl: dataUrl };
        })
        .catch((err) => {
          console.error("[ReadAloud] synthesis error:", err.message);
          return { error: err.message };
        });
    }

    if (msg.action === "cancelSynthesis") {
      self.edgeTTS.cancel();
      return;
    }

    // Relay state changes from content script → popup
    if (msg.action === "stateChanged") {
      browser.runtime.sendMessage(msg).catch(() => {});
    }
  });
})();
