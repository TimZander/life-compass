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
  // "Add only words that name something real you missed". Missed from what is the whole
  // instruction, and the rigorous track's own point is that step 1 comes first.
  {
    kind: "single",
    id: "rday2.added_from_list",
    label: "Added from the list",
    size: "long",
    reads: ["rday2.generated"],
  },
  // Two singles rather than a group, for the same reason as Day 0: each is introduced by
  // its own bold question and the second carries a sentence after it.
  //
  // Both run the contrarian check over the candidates from steps 1 and 2, so both name them.
  // Declared per question rather than once for the item: the item is a fact about the page,
  // and a question that moved to another page would take its dependency with it.
  {
    kind: "single",
    id: "rday2.claimed_not_lived",
    label: "Claimed but not lived",
    size: "long",
    reads: ["rday2.generated", "rday2.added_from_list"],
  },
  {
    kind: "single",
    id: "rday2.disconfirming",
    label: "Disconfirming evidence",
    size: "long",
    reads: ["rday2.generated", "rday2.added_from_list"],
  },
  {
    kind: "repeat",
    id: "rday2.shortlist_ten",
    instances: "row",
    label: "Value",
    min: 10,
    max: 10,
    fields: [{ id: "value", label: "Value", size: "long" }],
    // "From everything above" — which on this track is four questions across three items,
    // the disconfirmation pass included: a candidate this reader has already crossed out is
    // exactly what an assistant must not put back on the list.
    reads: [
      "rday2.generated",
      "rday2.added_from_list",
      "rday2.claimed_not_lived",
      "rday2.disconfirming",
    ],
  },
  {
    kind: "repeat",
    id: "rday2.shortlist_five",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
    reads: ["rday2.shortlist_ten"],
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
    // "For each of your 5".
    reads: ["rday2.shortlist_five"],
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
    // "Test your ranking against 3 recent hard decisions."
    reads: ["rday2.shortlist_five"],
  },
  {
    kind: "repeat",
    id: "rday2.ranked",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
    reads: ["rday2.shortlist_five"],
  },
];
