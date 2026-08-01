/**
 * Day 1 — Excavation.
 *
 * Labels are plain text. The worksheet currently renders these with varying emphasis
 * and list markers — bullets here, numbers there, blockquotes for the two standalone
 * answers — but that variety is incidental decoration rather than meaning, and encoding
 * it would put formatting detail permanently into a schema that a form UI will ignore.
 * The renderer applies one consistent treatment per kind instead.
 *
 * `min`/`max` come from the worksheet's own wording. Day 1 asks for "5–8 chapters" but
 * exactly five peak moments and three low points, so only the first is a genuine range.
 */

import type { Question } from "./types.ts";

export const DAY1: readonly Question[] = [
  {
    kind: "repeat",
    id: "day1.chapters",
    label: "Chapter",
    min: 5,
    max: 8,
    fields: [
      { id: "title", label: "Title", size: "long" },
      { id: "defined_by", label: "Defined by", size: "long" },
      { id: "learned", label: "Learned", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day1.peaks",
    label: "Moment",
    min: 5,
    max: 5,
    fields: [
      { id: "moment", label: "Moment", size: "long" },
      { id: "doing", label: "Doing", size: "long" },
      { id: "with", label: "With", size: "long" },
      { id: "quality", label: "Underlying quality", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day1.low_points",
    label: "Hard moment",
    min: 3,
    max: 3,
    fields: [
      { id: "moment", label: "Hard moment", size: "long" },
      { id: "violated", label: "Violated / missing", size: "long" },
      { id: "taught", label: "Taught me I need / won't accept", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day1.energizers",
    label: "Activity",
    min: 5,
    max: 5,
    fields: [{ id: "activity", label: "Activity", size: "long" }],
  },
  {
    kind: "repeat",
    id: "day1.drainers",
    label: "Drainer",
    min: 5,
    max: 5,
    fields: [{ id: "activity", label: "Drainer", size: "long" }],
  },
  {
    kind: "single",
    id: "day1.patterns",
    label: "Patterns",
    size: "long",
  },
  {
    kind: "single",
    id: "day1.threads",
    label: "Threads",
    size: "long",
  },
];
