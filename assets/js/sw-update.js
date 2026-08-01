// @ts-check
/**
 * Offering a new version rather than imposing one.
 *
 * The worker deliberately no longer calls `skipWaiting()` during install. It did, which
 * meant a deploy activated immediately, swapped the cache and claimed the open page —
 * fine for prose, and precisely the interruption docs/decisions/0001 forbids once
 * answers are being typed. Activation now happens when the reader says so.
 */

import { showBanner } from "./banner.js";

/** @param {ServiceWorkerRegistration} registration */
export function watchForUpdates(registration) {
  // A worker can ALREADY be waiting when this page loads — installed during an earlier
  // visit and never activated because the reader closed the tab. Without this the offer
  // would only ever appear for an update that arrives while a page happens to be open,
  // which is the minority of updates.
  if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
    offer(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (installing === null) {
      return;
    }
    installing.addEventListener("statechange", () => {
      // An existing controller is what distinguishes an update from a first install.
      // On a first install there is nothing to interrupt and nothing to ask about.
      if (installing.state === "installed" && navigator.serviceWorker.controller !== null) {
        offer(installing);
      }
    });
  });
}

/** @param {ServiceWorker} worker */
function offer(worker) {
  showBanner({
    id: "update",
    text: "A new version of the workbook is ready.",
    actions: [
      { label: "Later", onSelect: () => {} },
      { label: "Update", primary: true, onSelect: () => activate(worker) },
    ],
  });
}

/** @param {ServiceWorker} worker */
function activate(worker) {
  // Registered only once the reader has asked, because `controllerchange` also fires on
  // a first install — a listener attached earlier would reload a page nobody asked to
  // have reloaded.
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      window.location.reload();
    },
    { once: true },
  );
  worker.postMessage({ type: "SKIP_WAITING" });
}
