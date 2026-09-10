/**
 * The box that brings an assistant's answers back, and the review before they land.
 *
 * A box rather than a clipboard read, and that is the primary mechanism rather than a
 * degraded one. `navigator.clipboard.readText()` prompts on Android Chrome and needs a
 * gesture plus native UI on Safari; support varies further beyond that. Copying out and
 * pasting back are therefore not symmetric in implementation however symmetric they look, and
 * a per-question paste button that was the only way in would strand every browser that will
 * not grant the read. Every block names the group it answers (0015), so one box can take a
 * question, a day, or a whole compass and route each block where it belongs.
 *
 * Loaded only on /agent, which is why it may import the reader statically: no worksheet page
 * pulls this in. #110 is where a worksheet's own panel becomes a second caller, and it will
 * import this on a tap rather than on load, because the reader and the planner arrive with it.
 *
 * Nothing is read until the reader asks for it, and nothing is written until they have seen
 * what would change. 0007 · C3 forbids a silent overwrite, and the shape that satisfies it
 * here is counts for everything plus the old and new text for the overwrites specifically —
 * an addition fills a blank and needs no review, while a whole day's additions shown in full
 * would put a screen of text between the reader and the button.
 *
 * It comes in two halves. `wirePasteSurface` reads a reply, shows what it would change, and
 * writes it if the reader says so, against whatever elements it is handed. `wirePaste` finds
 * `/agent`'s elements by id, decides whether that page shows them at all, and supplies the
 * ending that is true on that page. The split is there because a review surface is the code
 * that keeps 0007 · C3 true, and a second copy of it — for the worksheet panel #110 wants —
 * would drift from this one in exactly the ways that are hard to see.
 *
 * Nothing about /agent changed when the halves were separated, and its own suite is the
 * assertion: all 27 tests that drive the real page through `wirePaste` were left untouched.
 * What the split adds is that the surface can be driven through elements nobody found on a
 * page, which one describe block proves directly — against a document that still holds
 * `/agent`'s own box, so a surface that went back to looking things up by id would drive the
 * wrong elements rather than quietly pass.
 */

import { readBlocks, planFor, explain, type Change, type Plan } from "./agent-answers.ts";
import { showBanner, dismissBanner } from "./banner.ts";
import { bridgeIsOn } from "./bridge.ts";
import { findQuestion, nameFor } from "./prompt.ts";
import type { Store } from "./store.ts";

function say(text: string): void {
  showBanner({
    id: "paste",
    text,
    actions: [{ label: "Dismiss", onSelect: () => dismissBanner("paste") }],
  });
}

/** The question's name as the page says it, rather than the identifier the block used. */
function titleOf(group: string): string {
  const question = findQuestion(group);
  return question === undefined ? group : nameFor(question, group);
}

/** "Chapter 2 · Title", or just the field where a question has no slots. */
function rowTitle(change: Change): string {
  const field = change.slot === undefined ? change.label : `${change.slot} · ${change.label}`;
  return `${titleOf(change.group)} — ${field}`;
}

/** One overwrite, shown in full: what is there, and what would replace it. */
function rowFor(document: Document, change: Change): HTMLElement {
  const row = document.createElement("div");
  row.className = "paste-change";

  const heading = document.createElement("p");
  heading.className = "paste-change-title";
  heading.textContent = rowTitle(change);

  const before = document.createElement("blockquote");
  before.className = "paste-before";
  // `textContent`, never `innerHTML`, on both halves. One is the reader's own words and the
  // other came out of a paste; the surface whose job is showing them literally must not be a
  // surface that executes them.
  before.textContent = change.before;
  const beforeLabel = document.createElement("p");
  beforeLabel.className = "paste-label";
  beforeLabel.textContent = "Now:";

  const after = document.createElement("blockquote");
  after.className = "paste-after";
  after.textContent = change.after;
  const afterLabel = document.createElement("p");
  afterLabel.className = "paste-label";
  afterLabel.textContent = "Would become:";

  row.append(heading, beforeLabel, before, afterLabel, after);
  return row;
}

/**
 * What one question would gain, counted the way its page counts.
 *
 * A repeat stores a field per slot, so day 1's five peak experiences are twenty stored
 * answers — and telling a reader who gave five things that twenty are new is both alarming and
 * in the wrong unit. Entries are what the page shows and what they think they wrote; the field
 * total goes in brackets for anyone who wants it. Everything else has no slots, so its answers
 * ARE its units and it counts them directly.
 */
function tallyFor(plan: Plan, group: string): string {
  const mine = [...plan.additions, ...plan.changes].filter((one) => one.group === group);
  const changedHere = plan.changes.filter((one) => one.group === group).length;
  const slots = mine.filter((one) => one.slot !== undefined);

  if (slots.length === 0) {
    const total = mine.length;
    const nouns = total === 1 ? "answer" : "answers";
    return changedHere === 0
      ? `${titleOf(group)} — ${total} new ${nouns}`
      : `${titleOf(group)} — ${total} ${nouns}, ${changedHere} replacing what you wrote`;
  }

  // A slot counts as updated if ANY of its fields would replace something, and new otherwise.
  const updated = new Set(
    plan.changes.filter((one) => one.group === group).map((one) => one.slot),
  );
  const touched = new Set(slots.map((one) => one.slot));
  const fresh = touched.size - updated.size;
  const parts: string[] = [];
  if (fresh > 0) {
    parts.push(`${fresh} new ${fresh === 1 ? "entry" : "entries"}`);
  }
  if (updated.size > 0) {
    parts.push(`${updated.size} ${updated.size === 1 ? "entry" : "entries"} updated`);
  }
  return `${titleOf(group)} — ${parts.join(", ")} (${mine.length} answers in all)`;
}

/** The one sentence the decision turns on: is anything you wrote at risk? */
function summarise(plan: Plan): string {
  const changed = plan.changes.length;
  const settled =
    plan.unchanged > 0
      ? ` ${plan.unchanged} ${plan.unchanged === 1 ? "answer matches" : "answers match"} what you already have.`
      : "";
  if (changed === 0) {
    return `Nothing you have already written would change.${settled}`;
  }
  return `${changed} ${changed === 1 ? "answer would replace" : "answers would replace"} something you wrote — ${changed === 1 ? "it is" : "they are"} shown below.${settled}`;
}

/**
 * What the reader is told about answers left out for still naming the example question.
 *
 * One wording, built once, because the same fact is said on five paths — the confirmation
 * surface, the nothing-to-change banner, a refusal, and each caller's own ending — and five
 * sentences saying it would be five sentences that can drift apart. At module scope rather
 * than inside the surface, because `wirePaste`'s ending needs it too and a second copy there
 * is exactly what this exists to prevent.
 */
export function strandedNote(count: number): string {
  return count === 1
    ? "One block of that reply still named the example question, so nothing in it could be matched. If a question you talked about is missing, that is the one — ask your assistant to send it again with the question's own name."
    : `${count} blocks of that reply still named the example question, so nothing in them could be matched. If questions you talked about are missing, those are the ones — ask your assistant to send them again with each question's own name.`;
}

/**
 * The elements one paste surface drives.
 *
 * Named rather than found, so the surface does not go looking: `/agent` reads them out of the
 * markup `layout.ts` emits, and a panel builds its own. Typed as widely as each use allows —
 * `Element` where the code only listens, fills, or sets an attribute — so a caller
 * constructing them is not made to prove more than the behaviour needs.
 *
 * **`summary`, `skipped`, `detail`, `go` and `cancel` must be inside `confirm`.** The surface
 * hides the review by hiding `confirm` alone, so a caller that builds them as siblings gets a
 * container that hides nothing and leaves whatever else it holds — a heading, on `/agent` —
 * standing over an emptied review. It is not checkable from here, since a caller may nest them
 * any depth down, so it is said here instead.
 *
 * They must also live in the document that holds `#banner-region`: every message this surface
 * produces goes through `banner.ts`, which resolves that region on the global document. The
 * surface is scoped to the elements it is given, not to a document of its own.
 */
export type PasteElements = {
  readonly text: HTMLTextAreaElement;
  readonly read: Element;
  /** Holds the review and everything in it, and is unhidden when there is one. */
  readonly confirm: HTMLElement;
  readonly summary: Element;
  readonly detail: Element;
  /** What could not be matched, when anything could not be. Hidden until it says something. */
  readonly skipped: HTMLElement;
  readonly go: Element;
  readonly cancel: Element;
};

/**
 * What landed, in the units the reader is told about.
 *
 * Two counts of two different things, which is why neither is called `count`: `answers` is what
 * "Saved 3 answers" counts, and `strandedBlocks` is what "2 blocks of that reply" counts. This
 * module already carries a test for the same class of mistake made one layer down — the right
 * arithmetic in the wrong unit — and both numbers are about to be rendered to a reader by a
 * caller that did not compute either of them.
 */
export type PasteResult = {
  readonly answers: number;
  readonly strandedBlocks: number;
  /**
   * The questions written to, in the order the blocks named them.
   *
   * Here because a caller cannot work it out and must not guess it. Every block names its own
   * question (0015), so a reply pasted into one panel routes to whatever it answers — a Day 4
   * reply pasted on Day 2 is saved under Day 4. A caller that assumed otherwise told the reader
   * their answers were on the page in front of them when they were on another one.
   */
  readonly groups: readonly string[];
};

export type PasteOptions = {
  /**
   * Told what landed, once it has. Runs on a successful save and on no other path — not on a
   * refusal, not on a failed read, not on a failed write, not on Cancel. **Must not throw.**
   *
   * Required, with no default, because the two callers end differently for a reason rather
   * than by preference and neither ending is the natural fallback for the other. `/agent` has
   * no fields to update, so it empties the box and says what was saved — wording that is true
   * on that page and nowhere else. A worksheet has the fields the answers belong in, and
   * `bindAnswers` fills a blank only while it is empty, so a panel will reload instead, exactly
   * as `wireRestore` and `wireErase` do, and report afterwards. Making this optional would let
   * a panel author forget it and ship a reader "open the worksheet to see them" on the
   * worksheet; required, that is a compile error. `RestoreOptions` and `EraseOptions` take
   * every one of their callbacks the same way, for the same reason.
   *
   * `strandedBlocks` travels with `answers` because it is said at the end for a reason
   * `readReply` records: the box is emptied a line earlier, so a reader told only "Saved 3
   * answers" has nothing left to learn that a fourth never arrived.
   *
   * A throw here is caught and logged rather than left to become an unhandled rejection —
   * `import.ts` records what that cost the last time, a reader told "nothing on this device has
   * changed" after the store had been replaced. Caught is not the same as harmless: the save
   * has already landed and whatever this was supposed to do has not, so it must not throw.
   */
  readonly onSaved: (result: PasteResult) => void;
};

/**
 * A wired surface, for a caller that shows and hides it.
 *
 * `/agent`'s box is wired once and lives for the page, so it never needs this. A panel that
 * swaps between a prompt and a paste box does: a review is built from one read of the store, so
 * one left standing while the reader goes back to the prompt, dictates, and returns is a Save
 * button offering a plan measured against answers that have since changed. That is the
 * staleness `generation` guards inside a single read, at the altitude a caller controls.
 */
export type PasteSurface = {
  /** Put it back to rest: no plan pending, no review showing, Save disabled. */
  readonly standDown: () => void;
};

/**
 * Wire the paste box on the assistant page.
 *
 * `openStore` rather than a `Store`: the box is built when the page loads and most readers
 * will never use it, so the database is opened when somebody actually pastes something.
 */
export function wirePaste(
  document: Document,
  storage: Storage | null,
  openStore: () => Promise<Store>,
): void {
  const view = document.defaultView;
  const section = document.getElementById("paste");
  const text = document.getElementById("paste-text");
  const read = document.getElementById("paste-read");
  const confirm = document.getElementById("paste-confirm");
  const summary = document.getElementById("paste-summary");
  const detail = document.getElementById("paste-detail");
  const skipped = document.getElementById("paste-skipped");
  const go = document.getElementById("paste-go");
  const cancel = document.getElementById("paste-cancel");
  // One `instanceof`, for the one element whose subtype the surface actually uses: the
  // textarea's `value`. `getElementById` already returns `HTMLElement | null`, so a null check
  // is the whole of what there is to prove about the rest — including the two whose `hidden`
  // this toggles. An earlier draft of this refactor tightened those two to `instanceof` as
  // well; that is a runtime behaviour change smuggled into a change that claims to make none,
  // in a branch no test reaches, so it went back.
  if (
    view === null ||
    section === null ||
    !(text instanceof view.HTMLTextAreaElement) ||
    read === null ||
    confirm === null ||
    summary === null ||
    detail === null ||
    skipped === null ||
    go === null ||
    cancel === null
  ) {
    // The build emits all of these together, so a missing one means the markup and this module
    // have drifted — and the symptom is a paste box that quietly is not there. Said out loud
    // rather than absorbed, exactly as `wireRestore` does for the same reason.
    console.error("life-compass: the paste box is missing from this page");
    return;
  }

  // Shown only to a reader who has switched the bridge on. Offering to bring an assistant's
  // answers back to somebody who has declined the assistant is the nudge 0007 rules out, and
  // it would also be incoherent: the copy buttons that produce these replies are not there.
  const reveal = (): void => {
    section.hidden = !bridgeIsOn(storage);
  };
  reveal();
  document.getElementById("agent-on")?.addEventListener("change", reveal);

  wirePasteSurface(
    { text, read, confirm, summary, detail, skipped, go, cancel },
    openStore,
    {
      // The ending that is true on this page: there are no fields here to fill, so the box is
      // emptied and the reader is pointed at the worksheet. Passed rather than defaulted, so
      // the wording lives with the page it describes.
      onSaved: ({ answers, strandedBlocks }) => {
        text.value = "";
        const line = `Saved ${answers} ${answers === 1 ? "answer" : "answers"}. Open the worksheet to see them.`;
        // Repeated at the end, because this is the end. The notice has just been cleared and
        // the box has just been emptied, so a reader who is told only "Saved 3 answers" has no
        // way left to find out that a fourth never arrived.
        say(strandedBlocks === 0 ? line : `${line} ${strandedNote(strandedBlocks)}`);
      },
    },
  );
}

/**
 * Read a reply, show what it would change, and write it if the reader says so.
 *
 * The review 0007 · C3 asks for is assembled here and nowhere else — what a reader is shown
 * before an irreversible write is one piece of code however many places the surface appears.
 * The parts it is built from are elsewhere by design: `planFor` works out what is new, changed
 * and unchanged, and `summarise`, `tallyFor` and `rowFor` render it.
 *
 * A caller supplies the elements and what to do once answers have landed. It does not get to
 * supply a different review, a different refusal, or a different definition of what "nothing
 * was saved" means.
 *
 * **Wire one set of elements once.** Nothing here guards against a second call over the same
 * elements, and a second call would attach a second set of listeners, each with its own pending
 * plan — so one tap of Save would merge twice. A caller that imports this module on a tap wants
 * to keep the surface it made, not make another; that is what `PasteSurface` is returned for.
 *
 * The document is taken from the elements rather than passed, so the two cannot disagree about
 * which one the rows are built in.
 */
export function wirePasteSurface(
  elements: PasteElements,
  openStore: () => Promise<Store>,
  options: PasteOptions,
): PasteSurface {
  const document = elements.confirm.ownerDocument;
  const { text, read, confirm, summary, detail, skipped, go, cancel } = elements;

  /** The plan the reader has been SHOWN, which is the only thing Save may apply. */
  let pending: Plan | null = null;
  /**
   * How many answers the reading set aside, carried alongside the plan it belongs to.
   *
   * Kept until the save, because the save is the last thing the reader is told and it used to
   * end on unqualified success — with the reply cleared out of the box a line earlier, so the
   * evidence of what was left out was gone at the same moment the reader was told everything
   * had worked.
   */
  let pendingStranded = 0;
  /**
   * Which read is current.
   *
   * Two can overlap — read, edit the box, read again — and without this the one that RESOLVES
   * last would win rather than the one that STARTED last, so an older store read could paint a
   * confirmation over a newer one. The reader would then be approving a summary built from
   * text they had already replaced. The same defect, and the same guard, as the preview panels
   * in agent.ts.
   */
  let generation = 0;

  const standDown = (): void => {
    pending = null;
    pendingStranded = 0;
    skipped.textContent = "";
    skipped.hidden = true;
    confirm.hidden = true;
    detail.replaceChildren();
    summary.textContent = "";
    go.setAttribute("aria-disabled", "true");
  };
  standDown();

  const readReply = async (): Promise<void> => {
    const mine = (generation += 1);
    // Cleared FIRST. Leaving the previous confirmation standing while the next reply is read
    // is what let a reader approve a plan built from text they had already replaced.
    standDown();

    const reading = readBlocks(text.value);
    if (!reading.ok) {
      say(explain(reading.refusal));
      return;
    }

    let entries: ReadonlyMap<string, string>;
    let store: Store;
    try {
      store = await openStore();
      // Read at the moment of asking rather than at page load: the reader may have written
      // more since, and what they are shown has to be measured against what is there now.
      entries = await store.readAll();
    } catch (error) {
      console.error("life-compass: the saved answers could not be read", error);
      say("Your saved answers could not be read just now, so this reply cannot be checked against them. Nothing on this device has changed.");
      return;
    }
    if (mine !== generation) {
      return;
    }

    // `warn`, not `error`: an assistant leaving a placeholder on a block is an ordinary reply
    // fault the reader is told about directly, not the developer-facing disagreement `error` is
    // reserved for in this tier. Logged at all so a device session shows it happened.
    if (reading.stranded > 0) {
      console.warn("life-compass: blocks were left out of a reply", reading.stranded);
    }

    const planned = planFor(reading.blocks, entries);
    if (!planned.ok) {
      // Both, and the refusal first: the paste is being rejected, and separately some of it
      // could not be matched at all. Telling the reader only the first sends them to fix a
      // reply that has a second problem waiting behind it.
      say(
        reading.stranded === 0
          ? explain(planned.refusal)
          : `${explain(planned.refusal)} ${strandedNote(reading.stranded)}`,
      );
      return;
    }
    if (planned.plan.writes.size === 0) {
      // A real outcome, not a failure: an assistant asked to review what the reader already
      // had, and it agreed with all of it. Saying nothing would read as the button not working.
      //
      // The stranded half is said here too. This branch never reaches the confirmation
      // surface, so without it a reply whose only NEW answer was the one left naming the
      // example group reports "nothing to change" — which is true of what was read and false
      // about what the reader dictated.
      say(
        reading.stranded === 0
          ? "Those answers are already saved, word for word. There is nothing to change."
          : `The answers that could be read are already saved, word for word. ${strandedNote(reading.stranded)}`,
      );
      return;
    }

    pending = planned.plan;
    pendingStranded = reading.stranded;
    summary.textContent = summarise(planned.plan);
    // A line per question, then the overwrites in full. Additions are counted rather than
    // listed: they fill blanks, and a whole day of them would put a screen of text between
    // the reader and the button. `replaceChildren` rather than innerHTML, on both.
    const tally = document.createElement("ul");
    tally.className = "paste-tally";
    for (const group of planned.plan.groups) {
      const line = document.createElement("li");
      line.textContent = tallyFor(planned.plan, group);
      tally.append(line);
    }
    detail.replaceChildren(
      tally,
      ...planned.plan.changes.map((change) => rowFor(document, change)),
    );
    confirm.hidden = false;
    // Filled AFTER the panel is showing, into the region the layout renders empty at load.
    // Both halves are the announcement: a live region has to exist before the change to it,
    // and the change has to happen somewhere visible. Said here and nowhere else — it was
    // also going through the banner, which put the same forty words on screen twice and took
    // over half a phone with them.
    if (reading.stranded > 0) {
      skipped.textContent = strandedNote(reading.stranded);
      skipped.hidden = false;
    }
    go.removeAttribute("aria-disabled");
  };

  read.addEventListener("click", () => {
    void readReply().catch((error: unknown) => {
      console.error("life-compass: the reply could not be read", error);
      say("That reply could not be read. Nothing on this device has changed.");
    });
  });

  cancel.addEventListener("click", () => {
    standDown();
    say("Nothing was saved.");
  });

  go.addEventListener("click", () => {
    // `aria-disabled` rather than `disabled`: a disabled element cannot hold focus, so
    // disabling the button somebody has just activated drops them to the document body
    // mid-flow. The same reasoning as the restore control.
    const applying = pending;
    const applyingStranded = pendingStranded;
    if (applying === null) {
      return;
    }
    // Taken out of `pending` before the await, so a second tap cannot apply it twice.
    pending = null;
    go.setAttribute("aria-disabled", "true");
    void (async () => {
      try {
        const store = await openStore();
        // Exactly what was shown. Re-planning here against a fresh read would apply something
        // the reader never saw, which is the same promise broken from the other end.
        await store.merge(applying.writes);
      } catch (error) {
        console.error("life-compass: the answers could not be saved", error);
        say("Those answers could not be saved on this device. What was already here is unchanged.");
        return;
      }
      // Stood down BEFORE the caller is told, so nothing the hook does — reloading, for a
      // panel — can race a surface that still holds an applied plan.
      standDown();
      // Caught, and only logged. The write has already landed, so the one thing that must not
      // happen here is the reader being told nothing: outside a `try` this becomes an
      // unhandled rejection on a `void`ed promise and the banner stays empty over a store that
      // has changed. `import.ts` records paying for that once — "told the reader 'nothing on
      // this device has changed' AFTER the store had been replaced, the one sentence that must
      // never be false, false exactly when it mattered". The hook is documented as not
      // throwing; this is what happens when it does anyway.
      try {
        options.onSaved({
          answers: applying.changes.length + applying.additions.length,
          strandedBlocks: applyingStranded,
          groups: applying.groups,
        });
      } catch (error) {
        console.error("life-compass: the save could not be announced", error);
      }
    })();
  });

  return { standDown };
}
