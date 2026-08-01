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

/** How long to wait for the reload before admitting it is not coming. */
const ACTIVATION_TIMEOUT_MS = 10_000;

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
      { label: "Update", primary: true, onSelect: () => accept(worker) },
    ],
  });
}

/**
 * Take the update, and say so.
 *
 * The banner is replaced rather than dismissed. Dismissing it made a successful update
 * and a silent failure look identical — the strip vanished either way, and because the
 * page reloads into the same content there was nothing at all to see. A control that
 * appears to do nothing is a defect even when it worked.
 *
 * @param {ServiceWorker} worker
 */
function accept(worker) {
  showBanner({ id: "update", text: "Updating\u2026", actions: [] });

  // If the reload never arrives, say that rather than leaving "Updating..." forever.
  // A stuck progress message is the same lie as no feedback, told more slowly.
  window.setTimeout(() => {
    showBanner({
      id: "update",
      text: "The update did not finish. Close the app and open it again.",
      actions: [{ label: "Dismiss", onSelect: () => {} }],
    });
  }, ACTIVATION_TIMEOUT_MS);

  activate(worker);
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
