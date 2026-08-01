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
  readonly min: number;
  readonly max: number;
  readonly fields: readonly Field[];
};

export type Question = SingleQuestion | RepeatQuestion;

/** Every identifier a question contributes, group and fields alike. */
export function identifiersOf(question: Question): readonly string[] {
  if (question.kind === "single") {
    return [question.id];
  }
  return [question.id, ...question.fields.map((field) => `${question.id}.${field.id}`)];
}
