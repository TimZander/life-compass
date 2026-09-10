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
 *   2. prior answers off by default, opted into per numbered item
 *   3. one plain sentence at the copy control
 *   4. said once, not a confirmation on every copy
 *
 * The preview is inline and opens where the reader already is. A dialog over the page is the
 * interruption docs/decisions/0001 forbids, and this is a feature for somebody who may be
 * mid-dictation on the same screen.
 */

import { promptFor, priorFrom, contextFrom, findQuestion, explain, nameFor } from "./prompt.ts";
import { showBanner, dismissBanner } from "./banner.ts";
import { bridgeIsOn, setBridge } from "./bridge.ts";
// Types only, so the emit carries no edge to it: `paste.ts` reaches the reply reader and the
// planner, and a worksheet must not pay for either until a reader asks to bring answers back.
// The value import is the `await import` inside the panel, on a tap.
import type { PasteElements, PasteSurface } from "./paste.ts";
import type { Store } from "./store.ts";

/**
 * What the bridge needs from the page it is wired into.
 *
 * An object rather than four positional arguments, and every field required: three of them
 * exist only for the paste half, and a caller that forgot one would ship a panel whose Save
 * button writes and then leaves the worksheet showing the answers it had before.
 */
export type BridgeOptions = {
  /** Everything stored, read fresh each time a panel opens. */
  readonly readEntries: () => Promise<ReadonlyMap<string, string>>;
  /** Opened when a reader actually pastes something, not when the page loads. */
  readonly openStore: () => Promise<Store>;
  /**
   * Told what to say once answers have landed, to be said after the reload. Must not throw.
   *
   * A sentence rather than counts, because the sentence is built where the wording lives: the
   * stranded half of it is `paste.ts`'s, and that module is in hand at the moment this runs.
   * Handing counts to `app.ts` would put a second copy of that wording in a third file.
   */
  readonly onSaved: (message: string) => void;
  /**
   * Start the page again, so the fields show what is now stored.
   *
   * `bindAnswers` restores a stored answer only into a blank that is still empty, so without
   * this the answers just saved are in the store and nowhere on screen. `wireRestore` and
   * `wireErase` reload for exactly this reason, and both record that `reload()` fires
   * `pagehide`, which `app.ts` flushes on — so a phrase being dictated elsewhere on the page
   * is not lost to it.
   */
  readonly reload: () => void;
};

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
  /**
   * Put the panel back to how it opens: the prompt showing, no plan pending.
   *
   * Called when the panel closes. A review is built from one read of the store, so one left
   * standing behind a closed panel is a Save button offering a plan measured against answers
   * the reader may have changed since — the staleness #83 records for the copy half, at the
   * altitude only the thing that owns both halves can see.
   */
  readonly rest: () => void;
};

/**
 * `prompt.ts`'s `Part` with the question already looked up.
 *
 * Carried rather than resolved twice: `itemsOn` proves every group resolves before it builds an
 * item out of them, so a second lookup could only ever succeed.
 */
type ResolvedPart = { readonly group: string; readonly question: NonNullable<ReturnType<typeof findQuestion>> };

/**
 * Where the answers went, said so that it is true wherever they went.
 *
 * A reply routes by the group each block names (0015), so a panel is where a reader pastes and
 * not where the answers necessarily land: a Day 4 reply pasted into Day 2's panel is saved
 * under Day 4, and the reader is looking at Day 2 when the page comes back. The first version
 * of this said "They are on this page now" every time, which is the commonest case and a lie in
 * the rest of them — reported from use.
 *
 * Told by which questions were written rather than by counting answers per page: the counts
 * would have to be split by something this does not know, and "some of them" is honest without
 * arithmetic that can be wrong. "Elsewhere in the workbook" rather than a page name, because
 * naming a page means deriving one from a source path, which 0011 keeps this codebase from
 * doing anywhere else.
 */
export function savedNote(answers: number, written: readonly string[], here: ReadonlySet<string>): string {
  const count = `Saved ${answers} ${answers === 1 ? "answer" : "answers"}.`;
  const elsewhere = written.filter((group) => !here.has(group));
  if (elsewhere.length === 0) {
    return `${count} ${answers === 1 ? "It is" : "They are"} on this page now.`;
  }
  if (elsewhere.length === written.length) {
    return answers === 1
      ? `${count} It is saved elsewhere in the workbook, under the question it names.`
      : `${count} They are saved elsewhere in the workbook, under the questions they name.`;
  }
  return `${count} Some are on this page; the rest are saved elsewhere in the workbook, under the questions they name.`;
}

/**
 * The half of the panel that brings a reply back: the box, and the review before it lands.
 *
 * Built here, driven by `paste.ts`. The review 0007 · C3 asks for is one piece of code however
 * many places the surface appears (#111), so nothing about what a reader is shown before an
 * irreversible write is decided in this file — only where the elements are and what happens
 * once answers have landed.
 *
 * `paste.ts` arrives on the tap that reveals this, not on page load. It reaches the reply
 * reader and the planner, and a reader who opens a panel to copy a prompt and never pastes
 * anything should not pay for either.
 */
function replyHalfFor(
  document: Document,
  item: NumberedItem,
  options: BridgeOptions,
): { readonly element: HTMLElement; readonly standDown: () => void; readonly enter: () => void } {
  const element = document.createElement("div");
  element.className = "agent-reply";
  element.id = `agent-reply-${item.id}`;
  element.hidden = true;

  const text = document.createElement("textarea");
  text.rows = 6;
  text.spellcheck = false;
  const label = document.createElement("label");
  // The label wraps the field rather than pointing at it, so a panel mints no identifier of
  // its own. There is one panel per numbered item and up to eight on a page; `for`/`id` would
  // need a scheme, and the only thing needing one is `aria-controls` on the swap.
  label.append(document.createTextNode("The assistant's reply — paste the whole of it"), text);

  const read = document.createElement("button");
  read.type = "button";
  read.textContent = "Read this reply";
  read.setAttribute("aria-disabled", "true");

  const confirm = document.createElement("div");
  confirm.hidden = true;
  const heading = document.createElement("p");
  heading.className = "agent-reply-heading";
  heading.textContent = "What this would change";
  const summary = document.createElement("p");
  const skipped = document.createElement("p");
  // The same class `paste.ts` gives the one on /agent, because it is the same warning doing the
  // same job and the stylesheet already says how it looks. `role="status"` and present from the
  // start: a screen reader announces a change to a region that existed beforehand, and one
  // created and filled in the same task is routinely missed (0001).
  skipped.className = "paste-skipped";
  skipped.setAttribute("role", "status");
  skipped.hidden = true;
  const detail = document.createElement("div");
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Save these answers";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";

  // INSIDE `confirm`, all of it. `paste.ts` hides the review by hiding that one element, so
  // siblings would leave this heading standing over a review that had been emptied — the
  // containment its `PasteElements` states and cannot check.
  //
  // A `p` rather than an `h3`: a panel sits at whatever depth its worksheet put it, so a fixed
  // level would land wrong on most pages, and a heading at the wrong level is worse for
  // navigation than prose that reads as a heading.
  confirm.append(heading, summary, skipped, detail, go, cancel);
  element.append(label, read, confirm);

  const elements = {
    text,
    read,
    confirm,
    summary,
    detail,
    skipped,
    go,
    cancel,
  } satisfies PasteElements;

  let surface: PasteSurface | null = null;
  let wiring: Promise<void> | null = null;

  // Until the module lands the button is on screen and inert, and a control that appears to do
  // nothing is the silence 0008 forbids. Registered before the surface's own listener and
  // saying nothing once there is one.
  read.addEventListener("click", () => {
    if (surface === null) {
      say("Still getting ready to read a reply — try again in a moment.");
    }
  });

  const enter = (): void => {
    // Wired once, which `wirePasteSurface` requires: a second wiring over one element set
    // attaches a second set of listeners, each with its own pending plan, so one tap of Save
    // would merge twice.
    wiring ??= import("./paste.ts")
      .then(({ wirePasteSurface, strandedNote }) => {
        surface = wirePasteSurface(elements, options.openStore, {
          onSaved: ({ answers, strandedBlocks, groups }) => {
            // Read at the moment of saving rather than when the panel was built: what a page
            // renders is fixed, but reading it here means nothing has to be kept in step.
            const here = new Set(
              [...document.querySelectorAll("[data-question]")].map(
                (one) => one.getAttribute("data-question") ?? "",
              ),
            );
            const line = savedNote(answers, groups, here);
            // Guarded here as well as in `paste.ts`, because the reload must happen either
            // way. Left to that backstop, a sentence that could not be stashed would take the
            // reload down with it — and a worksheet still showing blanks over answers that are
            // saved is worse than a missing message.
            try {
              options.onSaved(
                strandedBlocks === 0 ? line : `${line} ${strandedNote(strandedBlocks)}`,
              );
            } catch (error) {
              console.error("life-compass: the save could not be announced", error);
            }
            options.reload();
          },
        });
        read.removeAttribute("aria-disabled");
      })
      .catch((error: unknown) => {
        // Cleared, so the next tap tries again rather than awaiting a promise that has already
        // failed. Said to the reader as well as the console: this is the route somebody who
        // cannot type comfortably came for.
        wiring = null;
        console.error("life-compass: the reply box could not be loaded", error);
        say("The box for bringing a reply back could not be loaded. Reloading the page may fix it.");
      });
    text.focus();
  };

  return { element, standDown: () => surface?.standDown(), enter };
}

/** Build the panel an item's button opens: the payload, in full, and what to do with it. */
function panelFor(
  document: Document,
  item: NumberedItem,
  options: BridgeOptions,
): Panel {
  const { readEntries } = options;
  const { name } = item;
  const element = document.createElement("div");
  element.className = "agent-panel";
  // Dots are legal in an id and this is only ever used by `aria-controls`, never as a
  // selector — `#agent-panel-day1.chapters` would parse as an id plus a class.
  element.id = `agent-panel-${item.id}`;
  element.hidden = true;

  const include = document.createElement("input");
  include.type = "checkbox";
  const includeLabel = document.createElement("label");
  // What the tick covers grew with #105 and the label grew with it. A question that names an
  // earlier one — "from your circled list" — carries that answer too, and a checkbox saying
  // only "what I have already written" would be describing half of what it does on the one
  // surface 0007 · 1 makes responsible for the whole of it.
  includeLabel.append(
    include,
    document.createTextNode(" Include what I have already written, here and in what this builds on"),
  );

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
      // Every question of the item, in the order the page asks them, each with its own stored
      // answers. `item.name` is what the worksheet calls the item — the heading's own text —
      // which is what `promptFor` needs to say that several questions are one exercise. It is
      // ignored where an item holds a single question, so those prompts are unchanged.
      const made = promptFor(
        name,
        item.parts.map(({ group, question }) => ({
          group,
          prior: priorFrom(question, entries, wanted),
          // Read from the same entries and gated on the same tick. `contextFrom` returns
          // nothing at all when the tick is off, so nothing an earlier question holds can
          // reach the clipboard without the reader having asked for it here.
          context: contextFrom(question, entries, wanted),
        })),
      );
      if (!made.ok) {
        // Logged as well as shown. Every refusal reachable here is a fault rather than an
        // ordinary outcome — a group the schema does not hold means the markup and this build
        // disagree, which happens across a service worker activation — and the reader's copy
        // of the message says nothing a developer could act on.
        console.error("life-compass: this question cannot be asked about", made.refusal);
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
  const prompt = document.createElement("div");
  prompt.className = "agent-prompt";
  prompt.append(includeLabel, scrollNote, preview, note, copy);

  const { element: reply, standDown, enter } = replyHalfFor(document, item, options);

  /**
   * The two halves, one at a time.
   *
   * Never both: before a reader has copied there is nothing to paste, and once they have, the
   * preview has done its job. Showing both would double the panel's height on the phone this
   * is used from, which is the clutter this shape exists to avoid — #110 asks for the reply to
   * come back where the prompt was copied, not for a second box beside it.
   */
  const show = (half: "prompt" | "reply"): void => {
    // The plan goes when the reply half does. It was built from one read of the store, and a
    // reader who goes back to the prompt, dictates, and returns must not find Save still
    // offering it.
    if (half === "prompt") {
      standDown();
    }
    prompt.hidden = half === "reply";
    reply.hidden = half === "prompt";
    toReply.setAttribute("aria-expanded", half === "reply" ? "true" : "false");
  };

  const toReply = document.createElement("button");
  toReply.type = "button";
  toReply.className = "agent-swap";
  toReply.textContent = "Paste a reply";
  // Named for the item, like the button that opens the panel: a screen reader listing this
  // page's buttons would otherwise find one "Paste a reply" per numbered item with nothing
  // saying which is which (0001).
  toReply.setAttribute("aria-label", `Paste an assistant's reply about ${name}`);
  toReply.setAttribute("aria-controls", reply.id);
  toReply.setAttribute("aria-expanded", "false");
  toReply.addEventListener("click", () => {
    show("reply");
    // Focus follows the swap, on an explicit tap. 0001 forbids moving somebody mid-dictation;
    // it does not forbid putting the caret where the reader just asked to type.
    enter();
  });

  const back = document.createElement("button");
  back.type = "button";
  back.className = "agent-swap";
  back.textContent = "Back to the prompt";
  back.setAttribute("aria-label", `Back to the prompt for ${name}`);
  back.addEventListener("click", () => {
    show("prompt");
    // Returned to the control that left, rather than dropped to the body. `standDown` hides
    // the review, and hiding an element that holds focus is what `erase.ts` records as
    // stranding a keyboard reader with nothing announced.
    toReply.focus();
  });
  reply.append(back);

  prompt.append(toReply);
  element.append(prompt, reply);
  return { element, refresh, rest: () => show("prompt") };
}

/** One numbered item's worth of control: what it covers, what to call it, where it goes. */
type NumberedItem = {
  /** What the worksheet calls it — the heading's own text, or the question's for an orphan. */
  readonly name: string;
  /** Unique within the page, for the panel's id. The heading's slug, or the group. */
  readonly id: string;
  /** The item's first question. Where the control goes is derived from it — see `placeBefore`. */
  readonly first: Element;
  /** The numbered heading this item is named after, when it has one. */
  readonly heading: Element | null;
  readonly parts: ResolvedPart[];
};

/**
 * Where an item's control goes: directly under the numbered heading it is named after.
 *
 * Found on a device, three times over. Placing it against the item's FIRST question — which is
 * what one control per question did, correctly, because it spoke only for what was beside it —
 * makes an item-wide control look like that question's. Day 1's energy audit asks three things
 * under three bold labels and the control sat under the first of them, with nothing beside the
 * other two; day 3's hypothetical asks two and the control sat on the first blank; day 4's
 * unfair advantages asks four. Every rule that tried to be cleverer about it — climb out of the
 * list, stop above a sub-heading, stop above a bold label — fixed the case in front of it and
 * left the next one, because what a worksheet puts between a heading and its first blank is
 * prose, or a label, or a quote, or nothing, and no ordering of those is the general answer.
 *
 * Under the heading is. It is where the reader's eye already is when they decide whether to
 * ask, it is the same place on every page, and it is what #82 · AC1 asks for in the words
 * "each above its section". The cost is that the control precedes the item's own instruction —
 * an offer of help before the task is stated — which is a fair trade for a control that is
 * never mistaken for belonging to one question of several.
 *
 * A question outside every numbered item has no heading to sit under, so its control stays
 * where it always was: immediately above the question itself.
 */
function place(item: NumberedItem, open: Element, panel: Element): void {
  if (item.heading === null) {
    item.first.before(open, panel);
    return;
  }
  item.heading.after(open, panel);
}

/**
 * Every numbered item on this page, in the order the reader meets them.
 *
 * `data-section` is the slug of the enclosing numbered heading (#93), and it is the only thing
 * in the markup that says where one task ends and the next begins. Bucketing on it is the whole
 * of #82: a reader works through a worksheet in numbered items, not in questions, so day 4's
 * fourteen controls were fourteen invitations to fourteen conversations about five tasks.
 *
 * A question outside every numbered heading is an item of its own. There is exactly one —
 * `values.additions`, on a reference page with no headings at all — and build.test.ts pins it
 * by name as the single exception rather than leaving it as a silent zero.
 *
 * Checklists are dropped per QUESTION rather than per container, which is the difference this
 * slice makes: 0015 keeps them out of the contract, so an item holding one alongside real
 * questions must offer the rest. An item holding nothing else gets no control at all, which is
 * what `promptFor` refusing a checklist-only list says from the other end.
 */
function itemsOn(document: Document): readonly NumberedItem[] {
  const found = new Map<string, NumberedItem>();
  for (const container of document.querySelectorAll("[data-question]")) {
    // `?? ""` rather than a guard: the selector guarantees the attribute, so a null branch here
    // is unreachable, and an empty group resolves to no question and is dropped a line below.
    const group = container.getAttribute("data-question") ?? "";
    // A group this build does not know is skipped for the same reason a checklist is: the
    // prompt could only refuse it. Reachable across a service worker activation, where a page
    // can outlive the schema it was rendered against — and dropping the question rather than
    // the item is what stops one stale identifier costing a reader every question beside it.
    const question = findQuestion(group);
    if (question === undefined) {
      // Consequence changed with #82 and is worth the line: this used to remove a whole
      // control, which is visible. Now it shrinks an item — the prompt says "It asks 3
      // questions" over what the page shows as 4 — so the only way anyone learns is this.
      console.error("life-compass: this build has no question called", group);
      continue;
    }
    if (question.kind === "checklist") {
      continue;
    }
    const section = container.getAttribute("data-section") ?? "";
    const id = section === "" ? group : section;
    const already = found.get(id);
    if (already !== undefined) {
      already.parts.push({ group, question });
      continue;
    }
    // The heading whose `id` is the slug is the same element the build slugged, so its text is
    // what the page calls this item — "3. The contribution question (15 min)". `promptFor` uses
    // it to say four questions are one exercise; it ignores the name where an item holds a
    // single question, which is every orphan and 37 of the 63 items.
    const heading = section === "" ? null : document.getElementById(section);
    if (section !== "" && heading === null) {
      // Said out loud rather than absorbed. The slug in `data-section` is the heading's own id
      // by construction, so a missing one means the markup and this build disagree — and the
      // symptom is every control on the page quietly reverting to per-question naming.
      console.error("life-compass: no heading for the numbered item", section);
    }
    const name = heading?.textContent?.trim();
    found.set(id, {
      id,
      name: name === undefined || name === "" ? nameFor(question, group) : name,
      first: container,
      heading,
      parts: [{ group, question }],
    });
  }
  return [...found.values()];
}

/**
 * Give every numbered item on this page a copy button, when the bridge is on.
 *
 * Built here rather than emitted by the build, so a reader who never opts in carries no extra
 * markup at all. Derived from `[data-question]` and `[data-section]`, which the build already
 * puts on every rendered question — so the buttons cannot drift from the questions that exist,
 * and `data-section` is absent on exactly the one question that belongs to no numbered item. The
 * selector is deliberately element-agnostic: a `single` is a `<p>`, a `group` and a `checklist`
 * are `<ul>`, a `repeat` is a `<div>` or an `<ol>`, and matching on any one of those would leave
 * most of the workbook with no control.
 */
export function wireQuestionControls(
  document: Document,
  storage: Storage | null,
  options: BridgeOptions,
): void {
  if (!bridgeIsOn(storage)) {
    return;
  }

  for (const item of itemsOn(document)) {
    // Idempotent, keyed on the panel this item would build rather than on what sits beside it.
    // Nothing calls this twice today, but it is exported and the tests call it directly — and a
    // second pass would give every item two controls whose panels share one id, and two reply
    // boxes wired over one element set, which `wirePasteSurface` forbids.
    //
    // Written out twice, in two spellings, until #110 — the duplication this file's own
    // comments elsewhere argue against.
    if (document.getElementById(`agent-panel-${item.id}`) !== null) {
      continue;
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "agent-open";
    open.textContent = "Ask an assistant";
    // Named for the item it covers. A screen reader listing this page's buttons would otherwise
    // find five identical "Ask an assistant" with nothing saying which is which (0001).
    //
    // No tie-breaking suffix any more. #78 added "… (2)" because day 4 asks the same sentence
    // twice and two buttons read identically; those two questions are now one control, and
    // every one of the 63 numbered items has a heading distinct within its page — so the
    // suffix has nothing left to disambiguate. `nameFor` still earns its keep for the one
    // orphan and for the names paste.ts shows per group.
    open.setAttribute("aria-label", `Ask an assistant about ${item.name}`);

    const panel = panelFor(document, item, options);
    open.setAttribute("aria-controls", panel.element.id);
    open.setAttribute("aria-expanded", "false");

    open.addEventListener("click", () => {
      const opening = panel.element.hidden;
      panel.element.hidden = !opening;
      open.setAttribute("aria-expanded", opening ? "true" : "false");
      if (opening) {
        // Built on open rather than on load: up to eight payloads for a page nobody has asked
        // anything of is work with no reader waiting for it.
        void panel.refresh();
        return;
      }
      // Closed, so back to how it opens. A review left standing behind a closed panel is a
      // Save button offering a plan built from a read of the store the reader has had every
      // opportunity to make stale since.
      panel.rest();
    });

    // Under the heading, never after the questions. Appending put the control after every field
    // — on Day 1's chapters that is below all five, so a reader met it having already written
    // by hand the thing it offered to help with.
    place(item, open, panel.element);
  }
}
