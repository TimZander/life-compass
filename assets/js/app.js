// @ts-check
/**
 * Everything the pages load.
 *
 * A module rather than a classic script: browsers resolve the imports natively, so this
 * needs no bundler (docs/decisions/0003), and the site's CSP allows same-origin modules
 * while forbidding anything inline.
 */

import { watchForUpdates } from "./sw-update.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(watchForUpdates)
      .catch((error) => {
        // Survivable — every page still works from the network — but it silently removes
        // offline support and storage durability (0008), so say so rather than swallow it.
        console.error("Service worker registration failed:", error);
      });
  });
}
