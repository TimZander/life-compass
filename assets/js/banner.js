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

/** @returns {HTMLElement} */
function region() {
  const existing = document.getElementById(REGION_ID);
  if (existing !== null) {
    return existing;
  }
  const created = document.createElement("div");
  created.id = REGION_ID;
  // polite, so a screen reader finishes the current utterance rather than cutting it off.
  created.setAttribute("aria-live", "polite");
  document.body.appendChild(created);
  return created;
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
 * Run once the reader is not typing.
 *
 * The timeout matters: blurring one field to focus the next fires `focusout` while the
 * reader is still very much mid-thought, and `document.activeElement` has not yet moved
 * to the new field. Letting focus settle first avoids treating a tab between fields as
 * a pause.
 *
 * @param {() => void} run
 */
function whenNotTyping(run) {
  if (!isTyping()) {
    run();
    return;
  }
  /** @type {(event: Event) => void} */
  const check = () => {
    window.setTimeout(() => {
      if (!isTyping()) {
        document.removeEventListener("focusout", check);
        run();
      }
    }, 0);
  };
  document.addEventListener("focusout", check);
}

/** @param {BannerMessage} message */
function render(message) {
  const host = region();
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
    button.addEventListener("click", () => {
      dismissBanner();
      action.onSelect();
    });
    actions.appendChild(button);
  }
  banner.appendChild(actions);
  host.appendChild(banner);
}

/**
 * Offer a message, waiting for a pause in typing if necessary.
 *
 * Only one message shows at a time and the newest wins. That is sufficient while there
 * is exactly one kind of message; precedence becomes a real decision when install and
 * storage messages arrive alongside this one.
 *
 * @param {BannerMessage} message
 */
export function showBanner(message) {
  whenNotTyping(() => render(message));
}

export function dismissBanner() {
  region().replaceChildren();
}
