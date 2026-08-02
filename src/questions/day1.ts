/**
 * Day 1 — Excavation.
 *
 * Labels are plain text. The worksheet renders these with varying emphasis and list
 * markers — bullets here, numbers there, blockquotes for the two standalone answers —
 * but that variety is incidental decoration rather than meaning, and encoding it would
 * put formatting detail permanently into a schema that a form UI will ignore. The
 * renderer applies one consistent treatment per kind instead, deriving the emphasis it
 * does apply from the label's own punctuation rather than from a flag.
 *
 * Days 2 and 3 found the edge of that: `instances` is presentation the schema DOES
 * carry, because a heading is a landmark a screen reader navigates by, and losing five
 * of them is a cost to a reader rather than a change of look (docs/decisions/0001).
 * The line is whether a form UI could ignore it without harming anyone.
 *
 * `min`/`max` come from the worksheet's own wording. Day 1 asks for "5–8 chapters" but
 * exactly five peak moments and three low points, so only the first is a genuine range.
 * Five chapter slots are printed, not eight: eight blocks of three fields is a wall of
 * ruled lines, and the reader who has eight chapters is the one who will notice the
 * range and ask for more room.
 */

import type { Question } from "./types.ts";

export const DAY1: readonly Question[] = [
  {
    kind: "repeat",
    id: "day1.chapters",
    instances: "row",
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
    instances: "row",
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
    instances: "row",
    label: "Hard moment",
    min: 3,
    max: 3,
    fields: [
      { id: "moment", label: "Hard moment", size: "long" },
      { id: "violated", label: "Violated / missing", size: "long" },
      { id: "taught", label: "Taught me I need / won’t accept", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day1.energizers",
    instances: "row",
    label: "Activity",
    min: 5,
    max: 5,
    fields: [{ id: "activity", label: "Activity", size: "long" }],
  },
  {
    kind: "repeat",
    id: "day1.drainers",
    instances: "row",
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
