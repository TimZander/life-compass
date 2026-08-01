/**
 * Day 3 — Passions.
 *
 * Themes 4 and 5 are marked optional in the prose and carry two example slots where the
 * first three carry three. The repeat gives all five the same three, which adds two
 * blanks and removes an inconsistency that read as arbitrary rather than meaningful.
 */

import type { Question } from "./types.ts";

export const DAY3: readonly Question[] = [
  {
    kind: "repeat",
    id: "day3.energy",
    label: "Activity",
    min: 5,
    max: 5,
    fields: [
      { id: "activity", label: "Activity", size: "long" },
      { id: "context", label: "What / how / who", size: "long" },
      { id: "fuel", label: "What specifically fuels me", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day3.flow",
    label: "Activity",
    min: 5,
    max: 5,
    fields: [{ id: "activity", label: "Activity", size: "long" }],
  },
  { kind: "single", id: "day3.attention", label: "Subjects", size: "long" },
  // Two singles rather than a group: the worksheet puts a prompt in prose between them
  // ("What does this reveal about what you're drawn to?"), and a group takes one anchor,
  // which would have swallowed that prompt.
  { kind: "single", id: "day3.hypothetical", label: "What I'd do", size: "long" },
  { kind: "single", id: "day3.reveals", label: "What that reveals", size: "long" },
  {
    kind: "repeat",
    id: "day3.themes",
    label: "Theme",
    min: 5,
    max: 5,
    fields: [
      { id: "name", label: "Theme", size: "long" },
      { id: "example_1", label: "Example", size: "long" },
      { id: "example_2", label: "Example", size: "long" },
      { id: "example_3", label: "Example", size: "long" },
    ],
  },
];
