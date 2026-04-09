// Chrome MV3 service worker entry point.
// importScripts loads the compat shim first so `browser` is defined before
// the shared background script runs.
importScripts("browser-compat.js", "main.js");
