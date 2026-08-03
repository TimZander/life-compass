/**
 * Turning printed blanks into fields, and keeping what is typed into them.
 *
 * The build renders every blank as `<span class="fill" data-field="…">______</span>`, and
 * the pair (nearest `data-instance`, own `data-field`) is a blank's address (0013). That
 * makes the markup self-describing: this module needs no copy of the schema, because the
 * page already says which group a blank belongs to, which slot it sits in, and which
 * field it is.
 *
 * The governing constraint is docs/decisions/0001. Someone is dictating into these
 * fields, so nothing here may re-render, re-focus, or write back into a field the reader
 * is using. Values flow one way — out of the field and into storage — with exactly one
 * exception, restoring on load, which is guarded so it can never land on a field that has
 * been touched.
 */

import type { Answers } from "./answers.ts";
import {
  answerKey,
  newInstanceId,
  orderKey,
  readOrder,
  writeOrder,
  type StoredOrder,
} from "./keys.ts";
import type { Store } from "./store.ts";

/**
 * Where a blank belongs in a repeat.
 *
 * One object rather than two optional properties, because `group` without `slot` is not a
 * state that means anything: it would be keyed onto slot 0's identifier and put two blanks
 * on one key, which is the collision this whole scheme exists to prevent. Making it
 * inexpressible is cheaper than checking for it.
 */
type Repeat = {
  readonly group: string;
  readonly slot: number;
};

/** A blank, once it is a real form control. */
type Field = {
  readonly element: HTMLTextAreaElement;
  /** Absent for a single-valued question, whose identifier is already the whole key. */
  readonly repeat?: Repeat;
  /** `title` — the part after the group, for a repeat; the whole identifier otherwise. */
  readonly field: string;
};

export type BindOptions = {
  /**
   * Told when a group cannot be written to, so the reader can be warned.
   *
   * Both reasons are silent otherwise, and both cost the reader words they have already
   * spoken: a stored order that cannot be read (0013 · Q3), and one with fewer instances
   * than the page has slots, which happens when a repeat's `min` is raised after somebody
   * has answered (0013 · Q2).
   */
  readonly onUnwritable?: (group: string, reason: "unreadable" | "short") => void;
  /** Told when materialising a group failed outright, so the reader is not left guessing. */
  readonly onFailure?: (error: unknown) => void;
};

/** The selector for every blank the build emits. Shared so a caller cannot drift from it. */
export const BLANK_SELECTOR = "span.fill, span.fill-sm";

/** Measures a string in a control's own font, off-screen, with one reused element. */
let ruler: HTMLSpanElement | undefined;

function widthOf(control: HTMLTextAreaElement): number {
  const owner = control.ownerDocument;
  if (ruler === undefined || ruler.ownerDocument !== owner) {
    ruler = owner.createElement("span");
    ruler.setAttribute("aria-hidden", "true");
    ruler.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;white-space:pre;visibility:hidden";
    owner.body.appendChild(ruler);
  }
  const style = owner.defaultView?.getComputedStyle(control);
  if (style !== undefined) {
    ruler.style.font = style.font;
    ruler.style.letterSpacing = style.letterSpacing;
  }
  // The longest line, not the whole value: a wrapped answer is as wide as its widest line.
  ruler.textContent = control.value.split("\n").reduce((a, b) => (a.length >= b.length ? a : b), "");
  return ruler.offsetWidth;
}

/**
 * The class a short blank wears once its answer no longer fits on one line.
 *
 * A short blank sits inside a sentence, so it is `inline-block` — but an inline-block that
 * wraps does not flow with the prose around it. The second and later lines start at the
 * blank's own left edge, mid-paragraph, and the rest of the sentence stays stranded up on
 * the first line. It is unreadable, and it is what a device showed the moment an answer ran
 * past one line.
 *
 * So a long answer stops pretending to be part of the line and takes one of its own.
 */
const GROWN = "fill-grown";

/**
 * Size a control to what is in it, so nothing said is hidden by its box.
 *
 * Both directions. A short blank was given a fixed 6rem, which any real answer overruns —
 * the text then scrolls out of sight while the reader is still talking, which is the
 * failure this module exists to prevent, not a cosmetic one. It grows along its line while
 * it fits, and drops to its own full-width line when it does not.
 *
 * style.css also asks for `field-sizing: content`, which does the same job natively and
 * covers the first paint before this runs. This does not check for it and skip: that would
 * make the JavaScript depend on a particular line surviving in a stylesheet it does not
 * own, and a browser that ended up with new script and older CSS would then size nothing
 * at all. Doing the work unconditionally costs one span measurement per keystroke on the
 * 74 short blanks in the site, and cannot fall between the two.
 */
function fit(control: HTMLTextAreaElement): void {
  if (control.classList.contains("fill-sm")) {
    // The width the answer would need on a single line, measured independently of how the
    // control is laid out right now — so this cannot oscillate between the two states by
    // reading back a width it set itself a keystroke ago.
    const needed = widthOf(control);
    const available = control.parentElement?.clientWidth ?? 0;
    const grown = available > 0 && needed > available;
    control.classList.toggle(GROWN, grown);
    // Cleared rather than set when grown: the stylesheet takes the width from there, and an
    // inline width would pin a full-width box to whatever the text measured.
    control.style.width = grown || needed <= 0 ? "" : `${needed}px`;
  }
  // Collapse first, or the box can only ever grow: scrollHeight of an already-tall
  // textarea includes the empty space, so deleting a paragraph would leave the height.
  control.style.height = "auto";
  control.style.height = `${control.scrollHeight}px`;
}

/**
 * Replace one blank with a control that looks the same and can be typed into.
 *
 * Always a `<textarea>`, short blanks included. An `<input>` was tried for the 31 that sit
 * inside a sentence — "The world has enough ___" — on the grounds that a block element
 * there would break the sentence in half. It kept the sentence and lost the answer: an
 * input cannot wrap, so anything longer than the gap scrolls out of sight while the reader
 * is still speaking. An inline-block textarea keeps the sentence AND grows, which is what
 * the size difference should have meant all along. `fill-sm` and `fill` now differ only in
 * how style.css lays them out.
 *
 * The class comes across so the control keeps the ruled-line look, and style.css has a
 * matching `textarea.fill` rule that undoes the parts of `.fill` which exist only to hide
 * the printed underscores. Without that rule this line renders every answer 9999px
 * off-screen — it shipped that way once, past a green suite, because nothing here had been
 * opened in a browser.
 */
function upgrade(span: HTMLElement): HTMLTextAreaElement {
  const control = document.createElement("textarea");
  control.rows = 1;
  control.className = span.className;
  const field = span.dataset["field"];
  if (field !== undefined) {
    control.dataset["field"] = field;
  }
  // The name comes from the schema, via `data-label` on the blank. Deriving it from the
  // surrounding prose was tried and was worse than useless: a `q-single` blank sits alone
  // in its paragraph, so the name came out as the literal "______", and two blanks in one
  // row got the same name — with the second corrupted by the sibling this function had
  // already replaced, making it depend on iteration order.
  control.setAttribute("aria-label", span.dataset["label"] ?? "Answer");
  span.replaceWith(control);
  return control;
}

/**
 * Every blank on the page, upgraded, with its address resolved from the markup.
 *
 * A blank whose address cannot be resolved is left as printed rather than upgraded. An
 * unbound control looks identical to a bound one and silently swallows everything said
 * into it, which is worse than a blank that visibly cannot be typed in.
 */
function collect(root: ParentNode): readonly Field[] {
  const fields: Field[] = [];
  for (const span of [...root.querySelectorAll<HTMLElement>(BLANK_SELECTOR)]) {
    const identifier = span.dataset["field"];
    if (identifier === undefined) {
      continue;
    }
    const slotElement = span.closest<HTMLElement>("[data-instance]");
    if (slotElement === null) {
      // No enclosing slot means a single-valued question, whose identifier is already the
      // whole key. 0013 · C1 says so explicitly, because "no marker" is otherwise easy to
      // read as a bug.
      fields.push({ element: upgrade(span), field: identifier });
      continue;
    }
    const group = slotElement.closest<HTMLElement>("[data-question]")?.dataset["question"];
    const marker = slotElement.dataset["instance"];
    // Tested against the digits the build actually emits rather than handed to `Number`,
    // which reads "" as 0, "01" and "1e0" as 1, and "0x2" as 2 — three ways for two slots
    // to resolve to one storage key.
    if (group === undefined || marker === undefined || !/^\d+$/.test(marker)) {
      continue;
    }
    // The blank's identifier is the group's plus a dot plus the field. Checked rather than
    // assumed: slicing a prefix that is not there yields a truncated segment that would be
    // written straight into permanent storage.
    const prefix = `${group}.`;
    if (!identifier.startsWith(prefix)) {
      continue;
    }
    fields.push({
      element: upgrade(span),
      repeat: { group, slot: Number(marker) },
      field: identifier.slice(prefix.length),
    });
  }
  return fields;
}

/**
 * Bind every blank on the page to storage.
 *
 * Returns once stored answers have been restored. Typing before that resolves is safe in
 * both directions, and both took a defect to get right: listeners are attached BEFORE the
 * stored answers are awaited, so a phrase dictated during load is queued rather than
 * dropped, and restoring then skips any field that already holds something, so it is not
 * overwritten either. An earlier version attached listeners afterwards and lost every word
 * said in that window — silently, with the text still on screen.
 */
export async function bindAnswers(
  root: ParentNode,
  answers: Answers,
  store: Store,
  options: BindOptions = {},
): Promise<void> {
  const fields = collect(root);

  /** Instance identifiers per group, once known. Absent means not yet materialised. */
  const instances = new Map<string, readonly string[]>();
  /** Groups that must not be written to, and the reason, so it is only reported once. */
  const unwritable = new Map<string, "unreadable" | "short">();
  const materialising = new Map<string, Promise<void>>();

  /** How many slots the page is showing for a group — fixed by the markup, so computed once. */
  const slotCount = new Map<string, number>();
  for (const { repeat: x } of fields) {
    if (x !== undefined) {
      slotCount.set(x.group, Math.max(slotCount.get(x.group) ?? 0, x.slot + 1));
    }
  }

  function refuse(group: string, reason: "unreadable" | "short"): void {
    if (unwritable.has(group)) {
      return;
    }
    unwritable.set(group, reason);
    options.onUnwritable?.(group, reason);
  }

  /**
   * Adopt a stored order, or refuse the group.
   *
   * A stored order with fewer instances than the page has slots is refused rather than
   * used. Using it leaves the extra slots with no key at all, and every word dictated into
   * them is discarded on every keystroke with nothing said — the failure 0013 · Q2 leaves
   * open. Refusing loudly is not an answer to Q2; it is the difference between an open
   * question and silent data loss.
   */
  function adopt(group: string, order: StoredOrder): void {
    if (order.kind === "unreadable") {
      // Never materialise over this. Minting a fresh set would write new identifiers on
      // top of answers that are still there, and orphan every one of them (0013 · Q3).
      refuse(group, "unreadable");
      return;
    }
    if (order.kind === "absent") {
      return;
    }
    if (order.instances.length < (slotCount.get(group) ?? 0)) {
      refuse(group, "short");
      return;
    }
    instances.set(group, order.instances);
  }

  const keyFor = (field: Field): string | undefined => {
    if (field.repeat === undefined) {
      return field.field;
    }
    const instance = instances.get(field.repeat.group)?.[field.repeat.slot];
    return instance === undefined
      ? undefined
      : answerKey(field.repeat.group, instance, field.field);
  };

  /**
   * Mint identifiers for every slot of a group and store the order with the first answer.
   *
   * All-or-nothing, in one transaction (0013). The triggering answer goes in the same
   * claim because its key does not exist until the identifiers do — writing the order
   * first and the answer after would leave a window where a crash loses the answer but
   * keeps the order, and the slot would then look answered-and-empty forever.
   *
   * `claim` refuses if another tab got there first, and this tab then adopts the winner's
   * identifiers rather than its own. Without that, whichever order landed second would
   * strand the other tab's answers under identifiers nothing references.
   */
  async function materialise(group: string, trigger: Repeat, field: Field): Promise<void> {
    const minted = Array.from({ length: slotCount.get(group) ?? 0 }, () => newInstanceId());
    const instance = minted[trigger.slot];
    if (instance === undefined) {
      return;
    }
    const entries = new Map([
      [orderKey(group), writeOrder(minted)],
      [answerKey(group, instance, field.field), field.element.value],
    ]);
    if (await store.claim(orderKey(group), entries)) {
      instances.set(group, minted);
      return;
    }
    adopt(group, readOrder((await answers.load()).get(orderKey(group))));
  }

  /**
   * Record a field's current value, materialising its group first if it has to.
   *
   * Every path out of here either reaches `answers.set` or tells the reader. Nothing may
   * fail quietly: `newInstanceId` throws where `crypto.randomUUID` is unavailable, `claim`
   * rejects on a quota abort, and an unhandled rejection here would leave the reader
   * dictating into a group that stopped saving with no sign of it (0011 · C6).
   */
  function record(field: Field): void {
    const repeat = field.repeat;
    if (repeat === undefined) {
      answers.set(field.field, field.element.value);
      return;
    }
    if (unwritable.has(repeat.group)) {
      return;
    }
    const key = keyFor(field);
    if (key !== undefined) {
      answers.set(key, field.element.value);
      return;
    }
    // First keystroke in a group nobody has answered yet. The value is re-read from the
    // element after materialising rather than captured here, so a burst of dictation
    // arriving while the transaction is in flight is stored whole rather than truncated
    // to whatever the first keystroke happened to be.
    const group = repeat.group;
    const pending = materialising.get(group) ?? materialise(group, repeat, field);
    materialising.set(group, pending);
    void pending
      .then(() => {
        const settled = keyFor(field);
        if (settled !== undefined) {
          answers.set(settled, field.element.value);
          return;
        }
        // Materialising resolved and the field still has no key. `adopt` has already told
        // the reader why; saying nothing here would drop the value in silence.
        refuse(group, unwritable.get(group) ?? "short");
      })
      .catch((error: unknown) => {
        options.onFailure?.(error);
        refuse(group, "unreadable");
      })
      .finally(() => {
        // In `finally`, not in `then`. Leaving a rejected promise memoised here made the
        // group permanently dead: every later keystroke reused it, `then` never ran, and
        // nothing was ever saved again.
        materialising.delete(group);
      });
  }

  // Attached before the await below, so nothing dictated during load is missed.
  for (const field of fields) {
    field.element.addEventListener("input", () => {
      fit(field.element);
      record(field);
    });
  }

  const stored = await answers.load();
  for (const group of slotCount.keys()) {
    adopt(group, readOrder(stored.get(orderKey(group))));
  }

  for (const field of fields) {
    const key = keyFor(field);
    const value = key === undefined ? undefined : stored.get(key);
    // Guarded rather than assigned. `load` is async, so a fast reader can be mid-sentence
    // by the time it resolves, and overwriting that is the exact loss 0001 forbids.
    //
    // Emptiness is the whole guard, and deliberately so. Skipping a focused field as well
    // was tried: a reader who taps a blank and pauses before speaking would then never
    // see their stored answer, and their first phrase would save over it — the answer
    // lost silently rather than merely appearing at a surprising moment. An empty field
    // holds nothing of theirs to protect.
    if (value !== undefined && field.element.value === "") {
      field.element.value = value;
    } else if (field.element.value !== "") {
      // Dictated while `load` was in flight. The `input` event for it has already fired
      // and been recorded, but a group that materialised in between would have keyed it
      // under nothing — recording again now that the order is known costs one redundant
      // write and closes the window.
      record(field);
    }
    fit(field.element);
  }
}
