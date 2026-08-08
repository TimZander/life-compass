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
import { showBanner } from "./banner.ts";

/**
 * Where the opt-in lives.
 *
 * `localStorage`, not the answer store. It is a preference rather than an answer: putting it
 * in the store would carry it into every export and restore it onto whatever device a backup
 * lands on, quietly turning the feature on for somebody who never asked for it.
 */
const PREFERENCE = "life-compass:assistant";

export function bridgeIsOn(storage: Storage): boolean {
  try {
    return storage.getItem(PREFERENCE) === "on";
  } catch {
    // Storage can throw outright — Safari in private browsing historically did. A bridge
    // that cannot remember its setting is off, which is the safe direction for this one.
    return false;
  }
}

function setBridge(storage: Storage, on: boolean): void {
  try {
    storage.setItem(PREFERENCE, on ? "on" : "off");
  } catch {
    showBanner({
      id: "agent",
      text: "This browser would not let the setting be saved, so it will be off again next time.",
      actions: [],
    });
  }
}

/** The opt-in on the assistant page. Absent on every other page, which is not an error. */
export function wireAgentPage(document: Document, storage: Storage): void {
  const section = document.getElementById("agent");
  const toggle = document.getElementById("agent-on");
  if (section === null || !(toggle instanceof HTMLInputElement)) {
    return;
  }
  section.hidden = false;
  toggle.checked = bridgeIsOn(storage);
  toggle.addEventListener("change", () => {
    setBridge(storage, toggle.checked);
    showBanner({
      id: "agent",
      text: toggle.checked
        ? "Copy buttons are on. Open any worksheet and each question will have one."
        : "Copy buttons are off. The worksheets are unchanged.",
      actions: [],
    });
  });
}

/** Build the panel a question's button opens: the payload, in full, and what to do with it. */
function panelFor(document: Document, group: string, entries: ReadonlyMap<string, string>): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "agent-panel";
  panel.hidden = true;

  const include = document.createElement("input");
  include.type = "checkbox";
  include.id = `agent-prior-${group}`;
  const includeLabel = document.createElement("label");
  includeLabel.htmlFor = include.id;
  includeLabel.textContent = " Include what I have already written for this question";

  const preview = document.createElement("pre");
  preview.className = "agent-preview";
  preview.tabIndex = 0;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy this to the clipboard";

  const note = document.createElement("p");
  note.className = "agent-note";
  // 0007 · 3: one plain sentence, at the control, said once. Not a link to a privacy page and
  // not a dialog on every copy — a confirmation each time trains people to dismiss it.
  note.textContent =
    "This is exactly what goes to your clipboard. Whatever you paste it into can keep it.";

  /** Rebuild the payload. One value, so the preview and the clipboard cannot disagree. */
  const payload = (): string | null => {
    const question = findQuestion(group);
    if (question === undefined) {
      return null;
    }
    const prior = include.checked ? priorFrom(question, entries) : undefined;
    const made = promptFor(group, prior);
    if (!made.ok) {
      preview.textContent = explain(made.refusal);
      return null;
    }
    preview.textContent = made.text;
    return made.text;
  };

  include.addEventListener("change", () => {
    payload();
  });

  copy.addEventListener("click", () => {
    const text = payload();
    if (text === null) {
      return;
    }
    // Writing the clipboard needs no permission, unlike reading it — which is why the paste
    // side (#68) cannot be symmetric with this.
    navigator.clipboard.writeText(text).then(
      () => {
        showBanner({ id: "agent", text: "Copied. Paste it into your assistant.", actions: [] });
      },
      () => {
        showBanner({
          id: "agent",
          text: "This browser would not let the copy happen. The text is on screen — select it and copy it yourself.",
          actions: [],
        });
      },
    );
  });

  panel.append(includeLabel, include, preview, note, copy);
  includeLabel.prepend(include);
  return panel;
}

/**
 * Give every question on this page a copy button, when the bridge is on.
 *
 * Built here rather than emitted by the build, so a reader who never opts in carries no extra
 * markup at all. Derived from `[data-question]`, which the build already puts on every
 * rendered group — so the buttons cannot drift from the questions that exist.
 */
export function wireQuestionControls(
  document: Document,
  storage: Storage,
  entries: ReadonlyMap<string, string>,
): void {
  if (!bridgeIsOn(storage)) {
    return;
  }

  for (const container of document.querySelectorAll("[data-question]")) {
    const group = container.getAttribute("data-question");
    if (group === null) {
      continue;
    }
    // 0015 keeps checklists out of the contract, so a control here would only produce a
    // refusal. Skipped rather than offered and refused.
    if (findQuestion(group)?.kind === "checklist") {
      continue;
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "agent-open";
    open.textContent = "Ask an assistant";
    const panel = panelFor(document, group, entries);

    open.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      open.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
      if (!panel.hidden) {
        // Fill it on open rather than on load: building 113 payloads for a page nobody has
        // asked anything of is work with no reader waiting for it.
        panel.querySelector("input")?.dispatchEvent(new Event("change"));
      }
    });
    open.setAttribute("aria-expanded", "false");

    container.append(open, panel);
  }
}
