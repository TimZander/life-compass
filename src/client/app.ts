/**
 * Everything the pages load.
 *
 * A module rather than a classic script: browsers resolve the imports natively, so this
 * needs no bundler (docs/decisions/0003), and the site's CSP allows same-origin modules
 * while forbidding anything inline.
 */

import { confirmRecentUpdate, watchForUpdates } from "./sw-update.ts";
import { createAnswers } from "./answers.ts";
import { bindAnswers, BLANK_SELECTOR } from "./fields.ts";
import { openStore } from "./store.ts";
import { dismissBanner, showBanner } from "./banner.ts";

// Runs before registration, because it reports on the load that already happened rather
// than on anything the worker is about to do.
confirmRecentUpdate();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        try {
          watchForUpdates(registration);
        } catch (error) {
          // Separated from the registration failure below: registration succeeding and
          // update-watching throwing are different problems, and one message for both
          // sends whoever reads it to the wrong place.
          console.error("Watching for service worker updates failed:", error);
        }
      })
      .catch((error) => {
        // Survivable — every page still works from the network — but it silently removes
        // offline support and storage durability (0008), so say so rather than swallow it.
        console.error("Service worker registration failed:", error);
      });
  });
}

/**
 * Bind the page's blanks to on-device storage.
 *
 * Deliberately not awaited by anything: a page with no blanks, or a browser with storage
 * switched off, still reads and prints exactly as before (0010). Failure is reported once,
 * through the same banner surface as everything else, rather than thrown into the console
 * where a reader would never see it (0008 makes what storage can and cannot promise
 * something the app has to say out loud).
 */
async function bindAnswerFields(): Promise<void> {
  if (document.querySelector(BLANK_SELECTOR) === null) {
    return;
  }
  const store = await openStore();
  const answers = createAnswers(store, {
    onFailure: () =>
      showBanner({
        id: "storage",
        text: "Your answers are not being saved on this device right now.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
      }),
    // Without this the failure message outlives the failure: it is raised once and, with
    // nothing to clear it, stays on screen for the rest of the page even after the very
    // next write succeeds.
    onRecovery: () => dismissBanner(),
  });

  // The page-hide path, and the reason `flush` waits for the write rather than starting it.
  // `pagehide` rather than `beforeunload`: mobile browsers freeze a backgrounded tab and
  // may never fire the latter, which is exactly the session a dictating reader has.
  //
  // Registered before `bindAnswers` is awaited, not after: binding reads the whole store,
  // and a reader who backgrounds the tab during that read is the same reader this handler
  // exists for.
  window.addEventListener("pagehide", () => {
    void answers.flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void answers.flush();
    }
  });

  await bindAnswers(document, answers, store, {
    // Says that writing has stopped, not just that reading failed. The earlier wording
    // mentioned only the answers already stored, so a reader could dictate a page of new
    // text into a refused group having been told nothing that applied to it.
    onUnwritable: (_group, reason) =>
      showBanner({
        id: "storage",
        text:
          reason === "unreadable"
            ? "Some answers here could not be read, so this section is not saving. Your earlier answers are untouched."
            : "This section has more blanks than answers saved for it, so it is not saving. Your earlier answers are untouched.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
      }),
    onFailure: (error: unknown) => {
      console.error("life-compass: a group could not be prepared for saving", error);
      showBanner({
        id: "storage",
        text: "Your answers are not being saved on this device right now.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
      });
    },
  });
}

void bindAnswerFields().catch((error: unknown) => {
  console.error("life-compass: answers could not be bound to this page", error);
  showBanner({
    id: "storage",
    text: "Your answers cannot be saved on this device. The page still works for printing.",
    actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
  });
});
