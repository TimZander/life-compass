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

export type BannerAction = {
  readonly label: string;
  readonly onSelect: () => void;
  readonly primary?: boolean;
};

export type BannerMessage = {
  readonly id: string;
  readonly text: string;
  readonly actions: readonly BannerAction[];
};

const REGION_ID = "banner-region";

/**
 * The live region, which the layout renders as static markup.
 *
 * It is NOT created here on demand. A screen reader only announces changes to a live
 * region that existed before the change — creating the region and filling it in the same
 * task is routinely missed entirely. Since docs/decisions/0001 makes accessibility the
 * point rather than a courtesy, an announcement that silently does not happen is worse
 * here than almost anywhere.
 */
function region(): HTMLElement | null {
  const found = document.getElementById(REGION_ID);
  if (found === null) {
    // Loud rather than silent: the layout is supposed to provide this, and quietly
    // recreating it would restore the announcement bug it exists to prevent.
    console.error(`No #${REGION_ID} in the document; the layout should render it.`);
  }
  return found;
}

/** Is the reader mid-input right now? */
/** Input types somebody actually composes text in, as opposed to operates. */
const TEXT_ENTRY = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

function isTyping(): boolean {
  const active = document.activeElement;
  if (active === null || !(active instanceof HTMLElement)) {
    return false;
  }
  if (active.tagName === "TEXTAREA" || active.isContentEditable) {
    return true;
  }
  // Not every `<input>` is somebody mid-sentence. A file input keeps focus after its
  // picker closes, so treating it as typing deferred the message explaining why the file
  // was refused — the reader picked the wrong thing and was told nothing at all, which is
  // the opposite of what deferring is for. A checkbox and a button are the same: operating
  // a control is not composing text, and a message about the control just operated is
  // exactly the message that should not wait.
  return (
    active instanceof HTMLInputElement && TEXT_ENTRY.has(active.type.toLowerCase())
  );
}

/**
 * The message waiting for a pause in typing, if any.
 *
 * A single slot rather than a queue, and one listener rather than one per call. Adding a
 * listener per deferred message leaked one for every message a reader typed through, and
 * let two already-scheduled timeouts both observe "not typing" and render twice. One
 * slot also makes "the newest wins" true, which was previously only claimed.
 */
let pending: BannerMessage | null = null;
let watchingForPause = false;

/**
 * Blurring one field to focus the next fires `focusout` while the reader is still very
 * much mid-thought, and `document.activeElement` has not moved yet. Letting focus settle
 * first avoids treating a tab between fields as a pause.
 */
function onFocusOut(): void {
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

function deferUntilPause(message: BannerMessage): void {
  pending = message;
  if (watchingForPause) {
    return;
  }
  watchingForPause = true;
  document.addEventListener("focusout", onFocusOut);
}

function render(message: BannerMessage): void {
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
    // Called with no arguments, which is what `BannerAction` declares. Passing the handler
    // straight to `addEventListener` handed it the click event instead, and a handler whose
    // first parameter is optional — `dismissBanner(id?)` — silently took the event as that
    // id, matched nothing, and dismissed nothing. TypeScript cannot see it: a function of
    // fewer parameters is assignable to one of more.
    button.addEventListener("click", () => action.onSelect());
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
 */
export function showBanner(message: BannerMessage): void {
  if (isTyping()) {
    deferUntilPause(message);
    return;
  }
  render(message);
}

export function dismissBanner(id?: string): void {
  // With an id, only that message is cleared. Without one, everything is — which is right
  // for a reader pressing Dismiss and wrong for a caller clearing its own message: storage
  // recovering used to tear down whatever happened to be showing, including sw-update's
  // "a new version is ready" prompt, and `pending` being nulled discarded one that was
  // still queued behind a reader who was mid-sentence.
  if (id !== undefined) {
    if (pending?.id === id) {
      pending = null;
    }
    const showing = region()?.firstElementChild;
    if (showing?.getAttribute("data-banner") !== id) {
      return;
    }
  } else {
    pending = null;
  }
  region()?.replaceChildren();
}
