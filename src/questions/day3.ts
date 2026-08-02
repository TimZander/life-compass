/**
 * Day 3 — Passions.
 *
 * The worksheet marked themes 4 and 5 "(optional)" in their own headings and gave them
 * two example slots where the first three had three. A repeat cannot say that about
 * some instances and not others, so the range says it instead: three asked for, five
 * printed, all with the same three slots. The prose above the anchor already reads
 * "Group everything into 3–5 themes", so nothing about the ask has changed.
 */

import type { Question } from "./types.ts";

export const DAY3: readonly Question[] = [
  {
    kind: "repeat",
    id: "day3.energy",
    instances: "row",
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
    instances: "row",
    label: "Activity",
    min: 5,
    max: 5,
    fields: [{ id: "activity", label: "Activity", size: "long" }],
  },
  { kind: "single", id: "day3.attention", label: "Subjects", size: "long" },
  // Two singles rather than a group: the worksheet puts a prompt in prose between them
  // ("What does this reveal about what you're drawn to?"), and a group takes one anchor,
  // which would have swallowed that prompt.
  { kind: "single", id: "day3.hypothetical", label: "What I’d do", size: "long" },
  { kind: "single", id: "day3.reveals", label: "What that reveals", size: "long" },
  {
    kind: "repeat",
    id: "day3.themes",
    instances: "section",
    label: "Theme",
    // "Group everything into 3–5 themes" — a genuine range, so three are asked for and
    // five are printed. The worksheet used to mark 4 and 5 "(optional)" in their
    // headings; the range now carries that, and every theme gets the same three example
    // slots instead of the first three getting three and the last two getting two.
    min: 3,
    max: 5,
    fields: [
      { id: "name", label: "Theme", size: "long" },
      { id: "example_1", label: "Example", size: "long" },
      { id: "example_2", label: "Example", size: "long" },
      { id: "example_3", label: "Example", size: "long" },
    ],
  },
];
