/**
 * The shape of a question.
 *
 * Definitions live here rather than in the Markdown so that identifiers can be
 * compile-time checked (docs/decisions/0004), and every identifier is frozen and
 * registered rather than derived from anything (docs/decisions/0011). Nothing in this
 * file may be computed from a heading, a filename, or a position: that is exactly the
 * mistake 0011 exists to prevent.
 */

/**
 * Roughly how much room an answer wants.
 *
 * Recorded once here rather than guessed per renderer, because three separate things
 * need it and would otherwise each invent their own answer: the on-screen field (which
 * docs/decisions/0001 wants generous, because dictating into a cramped input is worse
 * than dictating into a roomy one), the printed worksheet (which has to allocate ruled
 * lines and cannot infer them — docs/decisions/0010), and the blank rendered today.
 *
 * The existing stylesheet already encodes exactly this distinction, at 15rem and 6rem,
 * which is why there are two values and not five: the worksheets have been making this
 * call by hand all along.
 */
export type Size = "short" | "long";

/** One answerable field inside a repeated group. */
export type Field = {
  /** Final identifier segment. Full identifier is `<question id>.<field id>`. */
  readonly id: string;
  readonly label: string;
  readonly size: Size;
};

/** A single answer, not repeated. */
export type SingleQuestion = {
  readonly kind: "single";
  /** Full frozen identifier, e.g. `day1.threads`. */
  readonly id: string;
  readonly label: string;
  readonly size: Size;
};

/**
 * A group the reader fills in more than once — chapters, values, peak moments.
 *
 * `min` and `max` come from the worksheet's own instructions ("divide your life into
 * 5–8 chapters"), so the count is the reader's within that range rather than a fixed
 * number of template slots.
 */
export type RepeatQuestion = {
  readonly kind: "repeat";
  /** Full frozen identifier of the group, e.g. `day1.chapters`. */
  readonly id: string;
  /** Singular noun for one instance, e.g. "Chapter". */
  readonly label: string;
  /**
   * How much weight one instance carries.
   *
   * `"line"` puts every field on one numbered line, separated by em dashes — right where
   * an instance is a single short thought, like the rigorous Day 2's ten candidate values
   * and the evidence for each. `"row"` gives the first field the line and stacks the rest
   * beneath it, which is right when the fields are sentences rather than words.
   * `"section"` gives each instance a heading composed from the label, its number, and
   * its first field: "Value 1 — ______" — right where an instance is a unit of work in
   * its own right and gets referred back to for the rest of the workbook.
   *
   * This is semantic weight rather than decoration, in the same way the size hint is.
   * Headings are also navigation: a screen reader moves by them, so rendering five
   * sections as five list rows removes five landmarks from the page — which
   * docs/decisions/0001 makes a real cost rather than a stylistic one. `"line"` earns its
   * place lower down the same scale: ten brainstormed words stacked two-deep is twenty
   * lines of a page for ten words, and the list stops reading as a list.
   */
  readonly instances: "line" | "row" | "section";
  /**
   * Fewest instances the worksheet asks for, and how many slots the sheet prints.
   *
   * These are two jobs for one number, and where a question has a genuine range they
   * pull apart: Day 1 asks for "5–8 chapters" and prints five, because eight blocks of
   * three fields is a wall of ruled lines rather than an invitation. Printing the
   * ceiling instead was tried and reverted — the extra slots read as padding.
   *
   * The cost is that `min` overstates the requirement wherever the range is real. That
   * only bites when something enforces it, which is #24, and #24 is where the third
   * number belongs if one turns out to be needed. It is not worth carrying now for the
   * two questions that would use it.
   */
  readonly min: number;
  /** Most the reader may add once #24 can add them. Not printed. */
  readonly max: number;
  readonly fields: readonly Field[];
};

/**
 * Ticks the reader works through — a readiness list rather than questions with answers.
 * Day 5 opens with four before you assemble the compass, and Day 0 of the rigorous
 * track with four more.
 *
 * One question with several items, not one question per tick: four separate questions
 * would need four anchors in the prose and would render as four separate lists.
 */
export type ChecklistQuestion = {
  readonly kind: "checklist";
  readonly id: string;
  readonly items: readonly { readonly id: string; readonly label: string }[];
};

/**
 * A sentence the reader completes.
 *
 * `template` carries the prose with named gaps — "The world has enough {excess}. It
 * needs more {lack}." — and the renderer interleaves text and blanks. Twenty-one of
 * these appear across the workbook, and flattening them into labelled fields would
 * capture the same data while changing what is being asked: completing a sentence is a
 * different act from filling a form, and the sentence is the exercise.
 *
 * Every `{name}` must have a matching field, every field must appear in the template,
 * and no name may be used twice. The build checks all three, because a gap with no
 * field renders as nothing at all, a field with no gap is an answer the reader can
 * never give, and a repeated name puts two blanks on one identifier.
 */
export type SentenceQuestion = {
  readonly kind: "sentence";
  readonly id: string;
  readonly template: string;
  readonly fields: readonly Field[];
};

/**
 * Several distinct prompts answered together — not repeated, and not one question.
 *
 * Day 5 asks five different things about Career and five different things about Money;
 * Day 4 asks for skills, experiences, networks and ways of thinking in one breath. These
 * are neither a repeat (the prompts differ) nor separate questions (they would need an
 * anchor each — about thirty across two worksheets, which would leave the Markdown more
 * anchor than prose).
 */
export type GroupQuestion = {
  readonly kind: "group";
  readonly id: string;
  readonly fields: readonly Field[];
};

export type Question =
  | SingleQuestion
  | GroupQuestion
  | RepeatQuestion
  | ChecklistQuestion
  | SentenceQuestion;

/** Every identifier a question contributes, group and fields alike. */
export function identifiersOf(question: Question): readonly string[] {
  if (question.kind === "single") {
    return [question.id];
  }
  if (question.kind === "checklist") {
    return [question.id, ...question.items.map((item) => `${question.id}.${item.id}`)];
  }
  return [question.id, ...question.fields.map((field) => `${question.id}.${field.id}`)];
}

/**
 * One `{name}` gap in a sentence template.
 *
 * Shared with the renderer, which splits on it. Two copies of this pattern would let the
 * renderer accept a gap the checker never validated — the check would pass and the blank
 * would render anyway.
 */
export const GAP = /\{([A-Za-z0-9_]+)\}/;

/** The `{name}` gaps in a sentence template, in the order they appear, duplicates kept. */
export function gapsOf(template: string): readonly string[] {
  return [...template.matchAll(new RegExp(GAP, "g"))].map((match) => match[1] ?? "");
}
