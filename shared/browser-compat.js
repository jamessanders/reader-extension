// Normalize the `browser` global so shared extension code works in both
// Firefox (which exposes `browser` natively) and Chrome (which only exposes
// `chrome`). This file must be loaded before any other extension script.
if (typeof browser === "undefined") {
  globalThis.browser = chrome;
}
