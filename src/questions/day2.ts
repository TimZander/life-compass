/**
 * Day 2 — Values.
 *
 * The worksheet narrows: fifty candidate words, then ten, then five, then each of the
 * five is operationalised and stress-tested. The narrowing lists are separate questions
 * rather than one, because they are answered at different points and the earlier ones
 * stay legible after the later ones are filled in — that is the exercise.
 *
 * `### Value 1 — ______` was a heading the reader names. That becomes a repeat whose
 * first field is the name, following the normalisation already applied to Day 1: the
 * page loses four `###` headings and gains a numbered list.
 */

import type { Question } from "./types.ts";

export const DAY2: readonly Question[] = [
  {
    kind: "single",
    id: "day2.brainstorm",
    label: "Words that landed",
    size: "long",
  },
  {
    kind: "repeat",
    id: "day2.shortlist_ten",
    label: "Value",
    min: 10,
    max: 10,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "repeat",
    id: "day2.shortlist_five",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "repeat",
    id: "day2.operationalised",
    label: "Value",
    min: 5,
    max: 5,
    fields: [
      { id: "name", label: "Value", size: "long" },
      { id: "definition", label: "My definition", size: "long" },
      { id: "living", label: "Living it looks like", size: "long" },
      { id: "betraying", label: "Betraying it looks like", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day2.conflicts",
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
    id: "day2.ranked",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
];
