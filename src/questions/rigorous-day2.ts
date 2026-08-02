/**
 * Rigorous Day 2 — Values.
 *
 * The rigorous move is order: candidates are generated from Day 1's evidence first, and
 * the word list is consulted only afterwards to fill gaps. That ordering is why
 * `generated` and `added_from_list` are separate questions — they are answered at
 * different points and the first must stay legible while the second is written.
 *
 * `generated` is the first `"line"` repeat in the workbook. Ten candidate values, each
 * with the evidence for it, on ten lines: stacking the evidence beneath each value would
 * make twenty lines of page for ten words, and the list would stop reading as the quick
 * scan the exercise asks for.
 */

import type { Question } from "./types.ts";

export const RIGOROUS_DAY2: readonly Question[] = [
  {
    kind: "repeat",
    id: "rday2.generated",
    instances: "line",
    label: "Value",
    min: 10,
    max: 15,
    fields: [
      { id: "value", label: "Value", size: "short" },
      { id: "evidence", label: "Evidence", size: "short" },
    ],
  },
  { kind: "single", id: "rday2.added_from_list", label: "Added from the list", size: "long" },
  // Two singles rather than a group, for the same reason as Day 0: each is introduced by
  // its own bold question and the second carries a sentence after it.
  { kind: "single", id: "rday2.claimed_not_lived", label: "Claimed but not lived", size: "long" },
  { kind: "single", id: "rday2.disconfirming", label: "Disconfirming evidence", size: "long" },
  {
    kind: "repeat",
    id: "rday2.shortlist_ten",
    instances: "row",
    label: "Value",
    min: 10,
    max: 10,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "repeat",
    id: "rday2.shortlist_five",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "repeat",
    id: "rday2.operationalised",
    instances: "section",
    label: "Value",
    min: 5,
    max: 5,
    fields: [
      { id: "name", label: "Value", size: "long" },
      { id: "definition", label: "My definition", size: "long" },
      { id: "living", label: "Living it looks like", size: "long" },
      { id: "betraying", label: "Betraying it looks like", size: "long" },
      { id: "evidence", label: "Day 1 evidence", size: "long" },
    ],
  },
  { kind: "single", id: "rday2.aspirations", label: "Aspirations", size: "long" },
  {
    kind: "repeat",
    id: "rday2.conflicts",
    instances: "row",
    label: "Decision",
    min: 3,
    max: 3,
    fields: [
      { id: "decision", label: "Decision", size: "long" },
      { id: "chosen", label: "The value I actually chose by", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "rday2.ranked",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
];
