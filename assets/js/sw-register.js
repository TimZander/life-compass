// Registers the service worker, which is what makes the workbook work offline and —
// via installation — what makes browser storage durable (docs/decisions/0008).
//
// A separate file rather than an inline script because the site's CSP has no
// 'unsafe-inline', and build/headers.ts refuses to let it gain one. That constraint
// costs one request and removes a whole category of injection.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      // Registration failing is survivable — every page still works from the network —
      // but it silently removes offline support and storage durability, so say so
      // rather than swallowing it.
      console.error("Service worker registration failed:", error);
    });
  });
}
