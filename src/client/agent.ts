/**
 * The assistant bridge's controls: the opt-in, and the copy button each question grows.
 *
 * Off by default, and that is the load-bearing part rather than the placement. A reader who
 * never wants an assistant sees an unchanged worksheet and is never nudged toward handing
 * their reflections to a third party — which is what makes docs/decisions/0007's "the user's
 * choice becomes real rather than nominal" true of the interface and not only of the network.
 *
 * 0007 asks for four things at the moment the trade is made, and all four are here rather
 * than in prose about them:
 *
 *   1. the literal payload, previewed — not a description of it
 *   2. prior answers off by default, opted into per question
 *   3. one plain sentence at the copy control
 *   4. said once, not a confirmation on every copy
 *
 * The preview is inline and opens where the reader already is. A dialog over the page is the
 * interruption docs/decisions/0001 forbids, and this is a feature for somebody who may be
 * mid-dictation on the same screen.
 */

import { promptFor, priorFrom, findQuestion, explain } from "./prompt.ts";
import { showBanner, dismissBanner } from "./banner.ts";

/**
 * Where the opt-in lives.
 *
 * `localStorage`, not the answer store. It is a preference rather than an answer: putting it
 * in the store would carry it into every export and restore it onto whatever device a backup
 * lands on, quietly turning the feature on for somebody who never asked for it.
 */
const PREFERENCE = "life-compass:assistant";

/**
 * The preference store, or nothing.
 *
 * Reaching for `window.localStorage` is itself what throws when a browser blocks site data —
 * not the `getItem` beneath it — so the access is guarded here rather than inside the
 * functions that use it. app.ts records the same lesson about `sessionStorage`: unguarded, it
 * aborted before the fields were bound, disabling the whole application for exactly the
 * privacy-minded readers most likely to block storage. This is that mistake made a third time
 * unless the access lives behind this function.
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
function setBridge(storage: Storage | null, on: boolean): boolean {
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

function say(text: string): void {
  // Every message here offers a way out. banner.ts pins the region to the bottom of the
  // viewport, so one without a Dismiss sits over whatever field is beneath it until something
  // else happens to replace it — on a phone, mid-dictation, the interruption 0001 forbids.
  showBanner({
    id: "agent",
    text,
    actions: [{ label: "Dismiss", onSelect: () => dismissBanner("agent") }],
  });
}

/** The opt-in on the assistant page. Absent on every other page, which is not an error. */
export function wireAgentPage(document: Document, storage: Storage | null): void {
  const section = document.getElementById("agent");
  const toggle = document.getElementById("agent-on");
  if (section === null || !(toggle instanceof HTMLInputElement)) {
    return;
  }
  section.hidden = false;
  toggle.checked = bridgeIsOn(storage);
  toggle.addEventListener("change", () => {
    // Conditional on the write having happened. Announcing "copy buttons are on" after a
    // failed write tells the reader the opposite of the truth — and because the region holds
    // one message at a time, it would also destroy the failure notice raised a line earlier.
    if (!setBridge(storage, toggle.checked)) {
      toggle.checked = bridgeIsOn(storage);
      say("This browser would not let the setting be saved, so the buttons stay as they were.");
      return;
    }
    say(
      toggle.checked
        ? "Copy buttons are on. Open any worksheet and each question will have one."
        : "Copy buttons are off. The worksheets are unchanged.",
    );
  });
}

/** Put text on the clipboard, or say why not. */
function copyToClipboard(text: string): void {
  // `navigator.clipboard` is undefined outside a secure context — which includes http:// on a
  // LAN address, the way this project is device-tested — and reading `.writeText` off it
  // throws SYNCHRONOUSLY, before any promise exists for a rejection handler to catch. The
  // reader would tap the one button this feature exists for and get nothing whatsoever: no
  // copy, no message, only an error in a console they will never open.
  const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") {
    say("This browser will not copy for us. The text is on screen — select it and copy it.");
    return;
  }
  try {
    clipboard.writeText(text).then(
      () => say("Copied. Paste it into your assistant."),
      () => say("The copy did not happen. The text is on screen — select it and copy it."),
    );
  } catch {
    say("The copy did not happen. The text is on screen — select it and copy it.");
  }
}

type Panel = {
  readonly element: HTMLElement;
  /** Rebuild the payload from the store as it is NOW, and show it. */
  readonly refresh: () => Promise<void>;
};

/** Build the panel a question's button opens: the payload, in full, and what to do with it. */
function panelFor(
  document: Document,
  group: string,
  readEntries: () => Promise<ReadonlyMap<string, string>>,
): Panel {
  const element = document.createElement("div");
  element.className = "agent-panel";
  // Dots are legal in an id and this is only ever used by `aria-controls`, never as a
  // selector — `#agent-panel-day1.chapters` would parse as an id plus a class.
  element.id = `agent-panel-${group}`;
  element.hidden = true;

  const include = document.createElement("input");
  include.type = "checkbox";
  const includeLabel = document.createElement("label");
  includeLabel.append(include, document.createTextNode(" Include what I have already written"));

  const preview = document.createElement("pre");
  preview.className = "agent-preview";
  preview.tabIndex = 0;
  preview.setAttribute("role", "region");
  preview.setAttribute("aria-label", "The exact text that will be copied");

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy this to the clipboard";

  const note = document.createElement("p");
  note.className = "agent-note";
  // 0007 · 3: one plain sentence, at the control, said once. Not a link to a privacy page and
  // not a dialog on every copy — a confirmation each time trains people to dismiss it.
  note.textContent =
    "This is exactly what goes to your clipboard. Whatever you paste it into can keep it.";

  let shown: string | null = null;

  /**
   * Rebuild from the store as it stands now, not as it stood at page load.
   *
   * A snapshot taken at load is wrong in both directions. A reader who edits an answer — or
   * clears one they decided not to say — and then opts it in would hand an assistant the
   * superseded text. And worse in practice: 0013 mints a repeat's instance order on the FIRST
   * write, so in a first session that order does not exist at load, `priorFrom` finds nothing,
   * and a reader who has just dictated five chapters gets a checkbox that silently includes
   * none of them. Repeats are 334 of the 447 blanks.
   */
  const refresh = async (): Promise<void> => {
    const question = findQuestion(group);
    if (question === undefined) {
      preview.textContent = explain({ kind: "unknown-group", group });
      shown = null;
      return;
    }
    const prior = priorFrom(question, await readEntries(), include.checked);
    const made = promptFor(group, prior);
    if (!made.ok) {
      preview.textContent = explain(made.refusal);
      shown = null;
      return;
    }
    // `textContent`, never `innerHTML`: prior answers are the reader's own words, and a
    // restored backup is words from a file. The one surface whose job is showing the literal
    // payload must not be a surface that executes it.
    preview.textContent = made.text;
    shown = made.text;
  };

  include.addEventListener("change", () => {
    void refresh();
  });

  copy.addEventListener("click", () => {
    // Copies exactly what is on screen rather than rebuilding. 0007 · 1 means the preview and
    // the clipboard are ONE value; building it twice makes them two that usually agree.
    if (shown === null) {
      say("There is nothing to copy for this question — the panel above says why.");
      return;
    }
    copyToClipboard(shown);
  });

  element.append(includeLabel, preview, note, copy);
  return { element, refresh };
}

/**
 * Give every question on this page a copy button, when the bridge is on.
 *
 * Built here rather than emitted by the build, so a reader who never opts in carries no extra
 * markup at all. Derived from `[data-question]`, which the build already puts on every
 * rendered group — so the buttons cannot drift from the questions that exist. The selector is
 * deliberately element-agnostic: a `single` is a `<p>`, a `group` and a `checklist` are
 * `<ul>`, a `repeat` is a `<div>` or an `<ol>`, and matching on any one of those would leave
 * most of the workbook with no control.
 */
export function wireQuestionControls(
  document: Document,
  storage: Storage | null,
  readEntries: () => Promise<ReadonlyMap<string, string>>,
): void {
  if (!bridgeIsOn(storage)) {
    return;
  }

  for (const container of document.querySelectorAll("[data-question]")) {
    const group = container.getAttribute("data-question");
    if (group === null) {
      continue;
    }
    // 0015 keeps checklists out of the contract, so a control there could only produce a
    // refusal. A group this build does not know is the same — reachable across a service
    // worker activation, where a page can outlive the schema it was rendered against.
    const question = findQuestion(group);
    if (question === undefined || question.kind === "checklist") {
      continue;
    }
    // Idempotent. Nothing calls this twice today, but it is exported, the tests call it
    // directly, and #68's paste path will want to re-run it — and a second pass would give
    // every question two controls whose panels share one id.
    if (container.previousElementSibling?.classList.contains("agent-panel") === true) {
      continue;
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "agent-open";
    open.textContent = "Ask an assistant";
    // Named for its own question. A screen reader listing this page's buttons would otherwise
    // find five identical "Ask an assistant" with nothing saying which is which (0001).
    const named = question.kind === "single" || question.kind === "repeat" ? question.label : group;
    open.setAttribute("aria-label", `Ask an assistant about ${named}`);

    const panel = panelFor(document, group, readEntries);
    open.setAttribute("aria-controls", panel.element.id);
    open.setAttribute("aria-expanded", "false");

    open.addEventListener("click", () => {
      const opening = panel.element.hidden;
      panel.element.hidden = !opening;
      open.setAttribute("aria-expanded", opening ? "true" : "false");
      if (opening) {
        // Built on open rather than on load: 113 payloads for a page nobody has asked
        // anything of is work with no reader waiting for it.
        void panel.refresh();
      }
    });

    // BEFORE the question, not inside it. Appending put the control after every field — on
    // Day 1's chapters that is below all five, so a reader met it having already written by
    // hand the thing it offered to help with. It is also the only valid place for it:
    // `q-group`, `q-checklist` and one shape of `q-repeat` are `<ul>`/`<ol>`, whose only
    // permitted children are list items.
    container.before(open, panel.element);
  }
}
