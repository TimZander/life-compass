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
 * Loaded only on /agent, which is why it may import the reader statically: a worksheet page
 * never pulls this in.
 *
 * Nothing is read until the reader asks for it, and nothing is written until they have seen
 * what would change. 0007 · C3 forbids a silent overwrite, and the shape that satisfies it
 * here is counts for everything plus the old and new text for the overwrites specifically —
 * an addition fills a blank and needs no review, while a whole day's additions shown in full
 * would put a screen of text between the reader and the button.
 */

import { readBlocks, planFor, explain, type Change, type Plan } from "./agent-answers.ts";
import { showBanner, dismissBanner } from "./banner.ts";
import { bridgeIsOn } from "./bridge.ts";
import { findQuestion } from "./prompt.ts";
import { nameFor } from "./agent.ts";
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

/** What the plan would do, in one sentence a reader can decide on. */
function summarise(plan: Plan): string {
  const parts: string[] = [];
  if (plan.additions.length > 0) {
    parts.push(`${plan.additions.length} ${plan.additions.length === 1 ? "answer is" : "answers are"} new`);
  }
  if (plan.changes.length > 0) {
    parts.push(
      `${plan.changes.length} would change ${plan.changes.length === 1 ? "something" : "things"} you wrote`,
    );
  }
  if (plan.unchanged > 0) {
    parts.push(`${plan.unchanged} ${plan.unchanged === 1 ? "matches" : "match"} what you already have`);
  }
  const where = plan.groups.map(titleOf).join(", ");
  return `${parts.join(", ")}. This came back for: ${where}.`;
}

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
  const go = document.getElementById("paste-go");
  const cancel = document.getElementById("paste-cancel");
  if (
    view === null ||
    section === null ||
    !(text instanceof view.HTMLTextAreaElement) ||
    read === null ||
    confirm === null ||
    summary === null ||
    detail === null ||
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

  /** The plan the reader has been SHOWN, which is the only thing Save may apply. */
  let pending: Plan | null = null;
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

    const planned = planFor(reading.blocks, entries);
    if (!planned.ok) {
      say(explain(planned.refusal));
      return;
    }
    if (planned.plan.writes.size === 0) {
      // A real outcome, not a failure: an assistant asked to review what the reader already
      // had, and it agreed with all of it. Saying nothing would read as the button not working.
      say("Those answers are already saved, word for word. There is nothing to change.");
      return;
    }

    pending = planned.plan;
    summary.textContent = summarise(planned.plan);
    // Overwrites in full, additions by count. `replaceChildren` rather than innerHTML.
    detail.replaceChildren(...planned.plan.changes.map((change) => rowFor(document, change)));
    confirm.hidden = false;
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
      standDown();
      text.value = "";
      const count = applying.changes.length + applying.additions.length;
      say(`Saved ${count} ${count === 1 ? "answer" : "answers"}. Open the worksheet to see them.`);
    })();
  });
}
