// @ts-check
/**
 * The banner surface.
 *
 * One strip of screen, several things it may eventually say — a new version is ready,
 * installing keeps your answers, storage is not durable. Written as one component
 * because three written separately would be three banners that can appear at once and
 * compete for the same space.
 *
 * Two rules come straight from docs/decisions/0001 and are the reason this is not just
 * `alert()`:
 *
 *   It is never modal. A dialog over the page is the interruption that record forbids.
 *
 *   It never appears while someone is typing. Dictating into a field is fragile — the
 *   text arrives in bursts and a stolen focus or a reflow loses it — so a message that
 *   arrives mid-sentence waits until the sentence is finished.
 */

/**
 * @typedef {{ label: string, onSelect: () => void, primary?: boolean }} BannerAction
 * @typedef {{ id: string, text: string, actions: readonly BannerAction[] }} BannerMessage
 */

const REGION_ID = "banner-region";

/**
 * The live region, which the layout renders as static markup.
 *
 * It is NOT created here on demand. A screen reader only announces changes to a live
 * region that existed before the change — creating the region and filling it in the same
 * task is routinely missed entirely. Since docs/decisions/0001 makes accessibility the
 * point rather than a courtesy, an announcement that silently does not happen is worse
 * here than almost anywhere.
 *
 * @returns {HTMLElement | null}
 */
function region() {
  const found = document.getElementById(REGION_ID);
  if (found === null) {
    // Loud rather than silent: the layout is supposed to provide this, and quietly
    // recreating it would restore the announcement bug it exists to prevent.
    console.error(`No #${REGION_ID} in the document; the layout should render it.`);
  }
  return found;
}

/** Is the reader mid-input right now? */
function isTyping() {
  const active = document.activeElement;
  if (active === null || !(active instanceof HTMLElement)) {
    return false;
  }
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable;
}

/**
 * The message waiting for a pause in typing, if any.
 *
 * A single slot rather than a queue, and one listener rather than one per call. Adding a
 * listener per deferred message leaked one for every message a reader typed through, and
 * let two already-scheduled timeouts both observe "not typing" and render twice. One
 * slot also makes "the newest wins" true, which was previously only claimed.
 *
 * @type {BannerMessage | null}
 */
let pending = null;
let watchingForPause = false;

/**
 * Blurring one field to focus the next fires `focusout` while the reader is still very
 * much mid-thought, and `document.activeElement` has not moved yet. Letting focus settle
 * first avoids treating a tab between fields as a pause.
 */
function onFocusOut() {
  window.setTimeout(() => {
    if (isTyping() || pending === null) {
      return;
    }
    const message = pending;
    pending = null;
    watchingForPause = false;
    document.removeEventListener("focusout", onFocusOut);
    render(message);
  }, 0);
}

/** @param {BannerMessage} message */
function deferUntilPause(message) {
  pending = message;
  if (watchingForPause) {
    return;
  }
  watchingForPause = true;
  document.addEventListener("focusout", onFocusOut);
}

/** @param {BannerMessage} message */
function render(message) {
  const host = region();
  if (host === null) {
    return;
  }
  host.replaceChildren();

  const banner = document.createElement("div");
  banner.className = "banner";
  banner.dataset["banner"] = message.id;

  const text = document.createElement("p");
  text.className = "banner-text";
  // textContent, never innerHTML: the CSP forbids inline script, and this forbids the
  // question of whether a message could ever carry markup.
  text.textContent = message.text;
  banner.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "banner-actions";
  for (const action of message.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.className = action.primary === true ? "banner-action banner-primary" : "banner-action";
    // The action decides what happens to the banner. Dismissing here first made
    // "Update" depend on immediately re-showing a banner this had just torn down —
    // a hidden contract between two files, where every action reads as dismissing.
    button.addEventListener("click", action.onSelect);
    actions.appendChild(button);
  }
  banner.appendChild(actions);
  host.appendChild(banner);
}

/**
 * Offer a message, waiting for a pause in typing if necessary.
 *
 * One message shows at a time and the newest wins — including while a message is still
 * waiting for a pause. Precedence between *kinds* of message becomes a real decision
 * when install and storage messages arrive alongside this one; until then, last-wins is
 * the whole rule.
 *
 * @param {BannerMessage} message
 */
export function showBanner(message) {
  if (isTyping()) {
    deferUntilPause(message);
    return;
  }
  render(message);
}

export function dismissBanner() {
  pending = null;
  region()?.replaceChildren();
}
