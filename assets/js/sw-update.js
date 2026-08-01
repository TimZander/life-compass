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

/**
 * Marks that an update was accepted, so the page can confirm it AFTER reloading.
 *
 * Confirming before the reload cannot work reliably. Activation often completes in tens
 * of milliseconds, so a progress message may never paint — and the page it was painted
 * on is destroyed by the reload regardless. The only moment an update can be confirmed
 * honestly is once it has actually happened, which is on the other side.
 */
const ACCEPTED_KEY = "life-compass:update-accepted";

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
  try {
    window.sessionStorage.setItem(ACCEPTED_KEY, "1");
  } catch {
    // Session storage can be unavailable in some privacy modes. The update still
    // applies; only the confirmation afterwards is lost, so this is not worth failing.
  }

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

/**
 * If an update was just applied, say so.
 *
 * Called on every page load, and silent unless this particular load is the one that
 * followed an accepted update. This is what makes the update observable at all: the page
 * looks identical before and after, so without it a reader has no way to distinguish a
 * successful update from a button that did nothing — which is exactly what happened on
 * the first device test.
 */
export function confirmRecentUpdate() {
  let accepted = null;
  try {
    accepted = window.sessionStorage.getItem(ACCEPTED_KEY);
    window.sessionStorage.removeItem(ACCEPTED_KEY);
  } catch {
    return;
  }
  if (accepted === null) {
    return;
  }
  showBanner({
    id: "update",
    text: "Updated. You are on the latest version.",
    actions: [{ label: "Dismiss", onSelect: () => {} }],
  });
}
