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
import { ASKS } from "./schema.ts";
import { showBanner, dismissBanner } from "./banner.ts";
import { bridgeIsOn, setBridge } from "./bridge.ts";

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

/** Trim a line of its Markdown and cut it to something a screen reader will not read forever. */
function clip(line: string): string {
  const plain = line.replace(/[*_`>#]/g, "").trim();
  return plain.length > 60 ? `${plain.slice(0, 57)}…` : plain;
}

/**
 * A short human name for a question, for the places a screen reader reads one out.
 *
 * Ordered by what the reader can actually see, which is not what the schema calls the thing.
 *
 * A `repeat`'s label names one SLOT, not the question: day 2 has four separate groups whose
 * label is "Value", because each renders "Value 1", "Value 2"… underneath a heading that is
 * the real question. Preferring the label gave that page four identical buttons standing for
 * four different things — and the same on rigorous day 2 (five) and day 1 (three).
 *
 * A `sentence` is the sentence. Everything else is named by the FIRST line of its ask, which
 * is the heading printed directly above the control. This read the LAST line, which is the
 * line nearest the anchor — usually the tail of a paragraph. All five of day 5's questions
 * came out as "gap?", so the attribute added to stop a quarter of these buttons reading out
 * an identifier had replaced unique identifiers with identical fragments: worse on the one
 * axis it exists for. Across the workbook the three rules together take the pages carrying a
 * duplicate name from nine to one.
 */
export function nameFor(
  question: { readonly kind: string; readonly id: string },
  group: string,
): string {
  if (
    question.kind === "sentence" &&
    "template" in question &&
    typeof question.template === "string" &&
    question.template !== ""
  ) {
    // Gaps are spelled `{excess}` in the template. Read aloud the braces are noise, and
    // dropping them alone inverts the sentence — "the world has enough excess" — so the gap
    // is named as the gap it is.
    return clip(question.template.replace(/\{[^}]*\}/g, "blank"));
  }
  const heading = (ASKS[group] ?? "").split("\n").find((line) => clip(line) !== "");
  if (heading !== undefined) {
    return clip(heading);
  }
  if ("label" in question && typeof question.label === "string" && question.label !== "") {
    return question.label;
  }
  return group;
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
  name: string,
  // Passed in rather than looked up again. `wireQuestionControls` has already proved this
  // group resolves before it builds a panel for it, so the second lookup could only ever
  // succeed — and the `unknown-group` arm it guarded was unreachable code carrying a message
  // no reader could ever be shown. A mutation sweep found it by deleting the arm with the
  // suite green.
  question: NonNullable<ReturnType<typeof findQuestion>>,
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
  // The same name the button uses, for the same reason. This said "…for day5.career" — the
  // raw identifier the button's own label goes to lengths to avoid, inside the panel that
  // button opens.
  preview.setAttribute("aria-label", `The exact text that will be copied for ${name}`);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy this to the clipboard";

  const note = document.createElement("p");
  note.className = "agent-note";
  // 0007 · 3: one plain sentence, at the control, said once. Not a link to a privacy page and
  // not a dialog on every copy — a confirmation each time trains people to dismiss it.
  note.textContent =
    "This is exactly what goes to your clipboard. Whatever you paste it into can keep it.";

  const scrollNote = document.createElement("p");
  scrollNote.className = "agent-scroll";
  // ABOVE the preview, and only when there is something out of sight. It read "The whole
  // message is below" from a position underneath the box, pointing at the consent sentence
  // and the copy button rather than at the text it meant — and it said so even when the whole
  // payload fitted, which on the shortest questions is most of the time.
  scrollNote.textContent = "This is longer than the box — scroll inside it to read the rest.";
  scrollNote.hidden = true;

  let shown: string | null = null;
  /**
   * Which rebuild is current.
   *
   * Two can overlap — open the panel, tick, untick — and without this the one that RESOLVES
   * last wins rather than the one that STARTED last, so an older store read can paint over a
   * newer preview. `shown` is cleared while one is in flight so a copy taken mid-rebuild
   * cannot send the previous payload: with the checkbox just ticked the reader would believe
   * their answers travelled when they did not, and with it just unticked the answers they
   * removed would still be on the clipboard. 0007 · 1 makes the preview and the clipboard one
   * value; a window where the checkbox disagrees with both is the same defect in time.
   */
  let generation = 0;

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
    const mine = (generation += 1);
    shown = null;
    copy.setAttribute("aria-disabled", "true");
    // Cleared, not left standing. `shown` covered the clipboard and this did not, so a reader
    // who UNTICKED the box watched their own answers sit in the preview for the whole length
    // of a store read — the checkbox saying one thing and the consent surface showing another,
    // which is the defect `generation` exists to prevent, left in place on the surface 0007 · 1
    // actually names. If the read never resolves it stayed there for good.
    preview.textContent = "Working out what to copy…";
    scrollNote.hidden = true;
    // Read BEFORE the await, not after. It happens to be correct today only because argument
    // evaluation runs left to right after the awaited call resolves — so hoisting this line,
    // which is the obvious readability edit, would silently invert the preview.
    const wanted = include.checked;
    let entries: ReadonlyMap<string, string>;
    try {
      entries = await readEntries();
    } catch (error) {
      if (mine !== generation) {
        return;
      }
      // Said, not swallowed. This used to resolve to an empty Map inside app.ts, so a reader
      // whose store would not open ticked the box, watched nothing change, and was told
      // nothing — and for a repeat it is worse than missing words: the instance identifiers go
      // too, which 0015 · C3 forbids and which produces exactly the reply the importer cannot
      // accept. Refusing is the honest end of that, and 0008 asks for it out loud.
      console.error("life-compass: the saved answers could not be read", error);
      preview.textContent =
        "Your saved answers could not be read just now, so there is nothing safe to copy yet. Reloading the page may fix it.";
      return;
    }
    if (mine !== generation) {
      return;
    }
    try {
      // One question per control still, so one part per prompt — #82's third slice is what
      // groups these by the numbered item they sit in. A prompt covering a single question
      // reads exactly as it did before items existed.
      //
      // The item name is empty rather than `name`, deliberately. `name` is this button's
      // accessible label: a clipped first line of an ask, sometimes carrying a "(2)"
      // disambiguator — not what the worksheet calls the numbered item. It happens to be
      // discarded on the one-question path, so passing it would be inert today and wrong the
      // day that changes, and nothing in the types could tell the two strings apart.
      const made = promptFor("", [{ group, prior: priorFrom(question, entries, wanted) }]);
      if (!made.ok) {
        // Logged as well as shown. Every refusal reachable here is a fault rather than an
        // ordinary outcome — a group the schema does not hold means the markup and this build
        // disagree, which happens across a service worker activation — and the reader's copy
        // of the message says nothing a developer could act on.
        console.error("life-compass: no message could be built", made.refusal);
        preview.textContent = explain(made.refusal);
        return;
      }
      // `textContent`, never `innerHTML`: prior answers are the reader's own words, and a
      // restored backup is words from a file. The one surface whose job is showing the literal
      // payload must not be a surface that executes it.
      preview.textContent = made.text;
      shown = made.text;
      copy.removeAttribute("aria-disabled");
      // Measured, not assumed. Under jsdom every box is zero-sized, so both heights are 0 and
      // the note stays hidden — which is what the test asserts, deliberately: whether a payload
      // overflows is the one thing about this panel only a real layout can decide.
      scrollNote.hidden = preview.scrollHeight <= preview.clientHeight;
    } catch (error) {
      // `promptFor` is not documented as throwing, but it reaches `answerKey`, which does:
      // build/questions.ts records that a field id with an interior dot "passes through
      // unremarked", and fields.ts guards that exact throw where this did not. Both callers
      // `void` this function, so without a handler a throw went nowhere at all — an unhandled
      // rejection, a preview stuck on "Working out what to copy…", and a copy button held
      // disabled for the rest of the session with nothing said. 0008 forbids exactly that.
      console.error("life-compass: the message could not be built", error);
      preview.textContent = "This message could not be built. Reloading the page may fix it.";
    }
  };

  include.addEventListener("change", () => {
    void refresh();
  });

  copy.addEventListener("click", () => {
    // Copies exactly what is on screen rather than rebuilding. 0007 · 1 means the preview and
    // the clipboard are ONE value; building it twice makes them two that usually agree.
    if (shown === null) {
      // `aria-disabled` rather than `disabled`: a disabled element cannot hold focus, so
      // disabling the button somebody has just activated drops them to the document body
      // mid-flow. The same reasoning as the restore control in export.ts.
      say("Still working out what to copy — try again in a moment.");
      return;
    }
    copyToClipboard(shown);
  });

  // Order is part of the contract, not a detail: the consent sentence and the control that
  // acts on it come AFTER the payload they describe, so nothing asks the reader to agree to
  // something they have not been shown yet (0007 · 1). Reversing this list left the copy
  // button above the text it copies, with the suite green.
  element.append(includeLabel, scrollNote, preview, note, copy);
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

  const names = new Map<string, number>();
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
    // find five identical "Ask an assistant" with nothing saying which is which (0001) — see
    // `nameFor` for where the name comes from and why the obvious sources are wrong.
    //
    // Then disambiguated within the page, because a good rule still leaves one honest tie:
    // day 4 asks the same sentence twice on purpose. Two buttons reading identically is the
    // same "which of these is which" by a different road, so the second one says which it is.
    const base = nameFor(question, group);
    const nth = (names.get(base) ?? 0) + 1;
    names.set(base, nth);
    const name = nth === 1 ? base : `${base} (${nth})`;
    open.setAttribute("aria-label", `Ask an assistant about ${name}`);

    const panel = panelFor(document, group, name, question, readEntries);
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
