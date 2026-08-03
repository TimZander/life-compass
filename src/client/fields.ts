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
import { answerKey, newInstanceId, orderKey, readOrder, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

/** A blank, once it is a real form control. */
type Field = {
  readonly element: HTMLInputElement | HTMLTextAreaElement;
  /** Storage key for a single-valued question; absent while a repeat is unmaterialised. */
  readonly group?: string;
  readonly slot?: number;
  /** `title` — the part after the group, for a repeat; the whole identifier otherwise. */
  readonly field: string;
};

export type BindOptions = {
  /** Told when a group's stored order cannot be read, so the reader can be warned. */
  readonly onUnreadable?: (group: string) => void;
};

/**
 * Replace one blank with a control that looks the same and can be typed into.
 *
 * `short` blanks stay `<input>` because all 31 of them sit inside a sentence — "The world
 * has enough ___" — and a block element there would break the sentence in half. `long`
 * blanks become a `<textarea>`: they hold dictated paragraphs, and a single line that
 * scrolls sideways hides what was just said, which for a voice-first workbook is the
 * failure mode rather than a cosmetic one.
 */
function upgrade(span: HTMLElement): HTMLInputElement | HTMLTextAreaElement {
  const short = span.classList.contains("fill-sm");
  const control = document.createElement(short ? "input" : "textarea");
  if (control instanceof HTMLInputElement) {
    control.type = "text";
  } else {
    control.rows = 1;
  }
  control.className = span.className;
  const field = span.dataset["field"];
  if (field !== undefined) {
    control.dataset["field"] = field;
  }
  // The label a screen reader reads is the prose around the blank, which is already on the
  // page — 0004 keeps it there deliberately. Naming the control after its identifier would
  // read out "day1 chapters title" instead.
  control.setAttribute("aria-label", span.closest("li, p, h3")?.textContent?.trim() ?? "Answer");
  span.replaceWith(control);
  return control;
}

/** Every blank on the page, upgraded, with its address resolved from the markup. */
function collect(root: ParentNode): readonly Field[] {
  const fields: Field[] = [];
  for (const span of [...root.querySelectorAll<HTMLElement>("span.fill, span.fill-sm")]) {
    const identifier = span.dataset["field"];
    if (identifier === undefined) {
      continue;
    }
    const slotElement = span.closest<HTMLElement>("[data-instance]");
    const element = upgrade(span);
    if (slotElement === null) {
      // No enclosing slot means a single-valued question, whose identifier is already the
      // whole key. 0013 · C1 says so explicitly, because "no marker" is otherwise easy to
      // read as a bug.
      fields.push({ element, field: identifier });
      continue;
    }
    const group = slotElement.closest<HTMLElement>("[data-question]")?.dataset["question"];
    const slot = Number(slotElement.dataset["instance"]);
    if (group === undefined || !Number.isInteger(slot)) {
      continue;
    }
    fields.push({ element, group, slot, field: identifier.slice(group.length + 1) });
  }
  return fields;
}

/**
 * Bind every blank on the page to storage.
 *
 * Returns once stored answers have been restored. Typing before that resolves is safe:
 * restoring skips any field that already holds something or currently has focus, so a
 * reader who starts dictating during load never has their words replaced by an older
 * answer.
 */
export async function bindAnswers(
  root: ParentNode,
  answers: Answers,
  store: Store,
  options: BindOptions = {},
): Promise<void> {
  const fields = collect(root);
  const stored = await answers.load();

  /** Instance identifiers per group, once known. Absent means not yet materialised. */
  const instances = new Map<string, readonly string[]>();
  const unreadable = new Set<string>();

  for (const group of new Set(fields.map((field) => field.group).filter((one) => one !== undefined))) {
    const order = readOrder(stored.get(orderKey(group)));
    if (order.kind === "order") {
      instances.set(group, order.instances);
    } else if (order.kind === "unreadable") {
      // Never materialise over this. Minting a fresh set would write new identifiers on
      // top of answers that are still there, and orphan every one of them (0013 · Q3).
      unreadable.add(group);
      options.onUnreadable?.(group);
    }
  }

  const keyFor = (field: Field): string | undefined => {
    if (field.group === undefined) {
      return field.field;
    }
    const known = instances.get(field.group);
    const instance = known?.[field.slot ?? -1];
    return instance === undefined ? undefined : answerKey(field.group, instance, field.field);
  };

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
    }
  }

  const materialising = new Map<string, Promise<void>>();

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
  async function materialise(group: string, slots: number, trigger: Field): Promise<void> {
    const minted = Array.from({ length: slots }, () => newInstanceId());
    const instance = minted[trigger.slot ?? 0];
    if (instance === undefined) {
      return;
    }
    const entries = new Map([
      [orderKey(group), writeOrder(minted)],
      [answerKey(group, instance, trigger.field), trigger.element.value],
    ]);
    const won = await store.claim(orderKey(group), entries);
    if (won) {
      instances.set(group, minted);
      return;
    }
    const order = readOrder((await answers.load()).get(orderKey(group)));
    if (order.kind === "order") {
      instances.set(group, order.instances);
      return;
    }
    unreadable.add(group);
    options.onUnreadable?.(group);
  }

  for (const field of fields) {
    field.element.addEventListener("input", () => {
      const value = field.element.value;
      if (field.group === undefined) {
        answers.set(field.field, value);
        return;
      }
      if (unreadable.has(field.group)) {
        return;
      }
      const key = keyFor(field);
      if (key !== undefined) {
        answers.set(key, value);
        return;
      }
      // First keystroke in a group nobody has answered yet. The value is re-read from the
      // element after materialising rather than captured here, so a burst of dictation
      // arriving while the transaction is in flight is stored whole rather than truncated
      // to whatever the first keystroke happened to be.
      const group = field.group;
      const slots = Math.max(...fields.filter((one) => one.group === group).map((one) => (one.slot ?? 0) + 1));
      const pending = materialising.get(group) ?? materialise(group, slots, field);
      materialising.set(group, pending);
      void pending.then(() => {
        materialising.delete(group);
        const settled = keyFor(field);
        if (settled !== undefined) {
          answers.set(settled, field.element.value);
        }
      });
    });
  }
}
