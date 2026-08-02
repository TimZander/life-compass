/**
 * Day 2 — Values.
 *
 * The worksheet narrows: fifty candidate words, then ten, then five, then each of the
 * five is operationalised and stress-tested. The narrowing lists are separate questions
 * rather than one, because they are answered at different points and the earlier ones
 * stay legible after the later ones are filled in — that is the exercise.
 *
 * `### Value 1 — ______` was a heading the reader names five times over. That is a
 * repeat whose first field is the name, but a section-weight one: flattening the five
 * into list rows would have taken five headings off the page, and a heading is a
 * landmark a screen reader navigates by (docs/decisions/0001). The narrowing lists
 * above it are rows — a value there is one word, not a unit of work.
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
    instances: "row",
    label: "Value",
    min: 10,
    max: 10,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "repeat",
    id: "day2.shortlist_five",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "repeat",
    id: "day2.operationalised",
    instances: "section",
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
    id: "day2.ranked",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
];
