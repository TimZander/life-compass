/**
 * Whether the assistant bridge is switched on, and nothing else.
 *
 * Separated from `agent.ts` so that the answer can be known without loading the feature. The
 * bridge pulls in the prompt generator, which pulls in the whole question schema — 94 kB raw,
 * 19 kB gzipped — and a static import chain meant every reader downloaded, parsed and cached
 * all of it on every page, including the 404 and every decision record, whether they had opted
 * in or not. The default is off, so for most readers that was the entire cost of a feature
 * they had declined.
 *
 * This module is the part that has to load eagerly: it is two functions and a string.
 */

const PREFERENCE = "life-compass:assistant";

/**
 * The preference store, or nothing.
 *
 * Reaching for `window.localStorage` is itself what throws when a browser blocks site data —
 * not the `getItem` beneath it — so the access is guarded here rather than inside the callers.
 * app.ts records the same lesson about `sessionStorage`: unguarded, it aborted before the
 * fields were bound, disabling the whole application for exactly the privacy-minded readers
 * most likely to block storage.
 */
export function preferences(from: Window): Storage | null {
  try {
    return from.localStorage;
  } catch {
    return null;
  }
}

export function bridgeIsOn(storage: Storage | null): boolean {
  if (storage === null) {
    return false;
  }
  try {
    // Compared against the exact value written, so anything else — a stale key, a value from
    // some other tool, a half-written string — reads as off, which is the safe direction.
    return storage.getItem(PREFERENCE) === "on";
  } catch {
    return false;
  }
}

/** Whether the preference was actually recorded. The caller has to know — see `wireAgentPage`. */
export function setBridge(storage: Storage | null, on: boolean): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(PREFERENCE, on ? "on" : "off");
    return true;
  } catch {
    return false;
  }
}
