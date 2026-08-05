/**
 * Offering a new version rather than imposing one.
 *
 * The worker deliberately no longer calls `skipWaiting()` during install. It did, which
 * meant a deploy activated immediately, swapped the cache and claimed the open page —
 * fine for prose, and precisely the interruption docs/decisions/0001 forbids once
 * answers are being typed. Activation now happens when the reader says so.
 */

import { dismissBanner, showBanner } from "./banner.ts";

/** How long to wait for the reload before admitting it is not coming. */
const ACTIVATION_TIMEOUT_MS = 10_000;

/**
 * Marks that an update actually applied, so the page can confirm it after reloading.
 *
 * Confirming before the reload cannot work reliably. Activation often completes in tens
 * of milliseconds, so a progress message may never paint — and the page it was painted
 * on is destroyed by the reload regardless. The only moment an update can be confirmed
 * honestly is once it has happened.
 *
 * Written when the controller actually changes, NOT when the button is tapped. Marking
 * on the tap meant a failed activation left the marker behind, and the next load
 * announced "Updated" while the same update was still being offered — the app stating
 * the opposite of the truth on the one path where it matters most.
 */
const APPLIED_KEY = "life-compass:update-applied";

export function watchForUpdates(registration: ServiceWorkerRegistration): void {
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

  // Browsers look for a new worker on navigation, so an installed app left open on one
  // page never notices a deploy — which is why verifying this by hand required fully
  // closing and reopening it. Checking when the app returns to the foreground makes an
  // update arrive when someone comes back, rather than when they happen to navigate.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void registration.update();
    }
  });
}

function offer(worker: ServiceWorker): void {
  showBanner({
    id: "update",
    text: "A new version of the workbook is ready.",
    actions: [
      { label: "Later", onSelect: () => dismissBanner() },
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
 */
function accept(worker: ServiceWorker): void {
  showBanner({ id: "update", text: "Updating…", actions: [] });

  // If the reload never arrives, say so rather than leaving "Updating..." forever.
  // A stuck progress message is the same lie as no feedback, told more slowly.
  const giveUp = window.setTimeout(() => {
    showBanner({
      id: "update",
      text: "The update did not finish. Close the app and open it again.",
      actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
    });
  }, ACTIVATION_TIMEOUT_MS);

  // Registered only once the reader has asked, because `controllerchange` also fires on
  // a first install — a listener attached earlier would reload a page nobody asked to
  // have reloaded.
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      window.clearTimeout(giveUp);
      try {
        window.sessionStorage.setItem(APPLIED_KEY, "1");
      } catch {
        // Session storage can be unavailable in some privacy modes. The update has
        // already applied by this point; only the confirmation afterwards is lost.
      }
      window.location.reload();
    },
    { once: true },
  );

  worker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * If an update was just applied, say so.
 *
 * Called on every page load, and silent unless this particular load followed one. This
 * is what makes an update observable at all: the page looks identical before and after,
 * so without it a reader cannot distinguish a successful update from a button that did
 * nothing — which is exactly what happened on the first device test.
 */
export function confirmRecentUpdate(): void {
  let applied: string | null = null;
  try {
    applied = window.sessionStorage.getItem(APPLIED_KEY);
  } catch {
    return;
  }
  if (applied === null) {
    return;
  }

  // Cleared before announcing, and announced only if the clear succeeded. A marker that
  // survives would repeat this on every subsequent load, which is noise wearing the
  // clothes of information.
  try {
    window.sessionStorage.removeItem(APPLIED_KEY);
  } catch {
    return;
  }

  showBanner({
    id: "update",
    text: "Updated. You are on the latest version.",
    actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
  });
}
