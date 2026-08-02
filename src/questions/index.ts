/**
 * Which worksheet each set of questions belongs to.
 *
 * The path is stated rather than inferred from the module name. Inferring it would make
 * moving or renaming a file silently re-home its questions, which is the same class of
 * accident docs/decisions/0011 froze identifiers to avoid.
 */

import type { Question } from "./types.ts";
import { DAY1 } from "./day1.ts";
import { DAY2 } from "./day2.ts";
import { DAY3 } from "./day3.ts";
import { DAY4 } from "./day4.ts";
import { DAY5 } from "./day5.ts";
import { RIGOROUS_DAY0 } from "./rigorous-day0.ts";
import { RIGOROUS_DAY1 } from "./rigorous-day1.ts";
import { RIGOROUS_DAY2 } from "./rigorous-day2.ts";

export type Worksheet = {
  /** Repo-relative POSIX path of the Markdown this belongs to. */
  readonly source: string;
  readonly questions: readonly Question[];
};

export const WORKSHEETS: readonly Worksheet[] = [
  { source: "days/day-1-excavation.md", questions: DAY1 },
  { source: "days/day-2-values.md", questions: DAY2 },
  { source: "days/day-3-passions.md", questions: DAY3 },
  { source: "days/day-4-purpose.md", questions: DAY4 },
  { source: "days/day-5-synthesis.md", questions: DAY5 },
  { source: "rigorous/day-0-prep.md", questions: RIGOROUS_DAY0 },
  { source: "rigorous/day-1-excavation.md", questions: RIGOROUS_DAY1 },
  { source: "rigorous/day-2-values.md", questions: RIGOROUS_DAY2 },
];
