/**
 * Optional add-ons.
 *
 * The outside-input questions here are the same two the rigorous Day 0 asks, worded
 * slightly differently for a reader who never opened that track. They are separate
 * questions rather than shared identifiers: a reader can do both, and the same person
 * answering the same prompt twice in two places has given two answers (0011).
 */

import type { Question } from "./types.ts";

export const ADD_ONS: readonly Question[] = [
  { kind: "single", id: "addons.come_to_you_for", label: "What people come to me for", size: "long" },
  { kind: "single", id: "addons.brushed_off", label: "The compliment I brush off", size: "long" },
  // A genuine group: three contiguous bullets, short labels, nothing between them. This is
  // the shape rigorous Day 4's unfair advantages have, and the opposite of the two singles
  // above, whose prompts each carry their own trailing sentence.
  {
    kind: "group",
    id: "addons.experiment",
    fields: [
      { id: "step", label: "The step", size: "long" },
      { id: "by_when", label: "By when (pick a date)", size: "long" },
      { id: "done", label: "Done", size: "long" },
    ],
  },
];
