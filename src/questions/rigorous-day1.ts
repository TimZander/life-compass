/**
 * Rigorous Day 1 — Excavation.
 *
 * The same excavation as the short track, with one addition running through it: every
 * entry is tagged with a one-word quality, turning the notes into something Day 2 reads
 * directly. Those tags are `short` fields beside `long` ones — a word rather than a
 * sentence — which is what the size hint is for.
 *
 * The energy audit is four separate repeats rather than one. The month and the year are
 * deliberately different questions, asked at different depths: the month names a quality
 * for each entry, the year only asks what stood out. Folding them together would flatten
 * that, and the worksheet's whole point is that the two windows can disagree.
 */

import type { Question } from "./types.ts";

export const RIGOROUS_DAY1: readonly Question[] = [
  {
    kind: "repeat",
    id: "rday1.chapters",
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
    id: "rday1.peaks",
    instances: "row",
    label: "Moment",
    min: 5,
    max: 5,
    fields: [
      { id: "moment", label: "Moment", size: "long" },
      { id: "doing", label: "Doing", size: "long" },
      { id: "with", label: "With, or alone", size: "long" },
      { id: "quality", label: "Quality tag", size: "short" },
    ],
  },
  {
    kind: "repeat",
    id: "rday1.low_points",
    instances: "row",
    label: "Hard moment",
    min: 3,
    max: 3,
    fields: [
      { id: "moment", label: "Hard moment", size: "long" },
      { id: "violated", label: "What was violated or missing", size: "long" },
      { id: "value_tag", label: "Value it points to (tag)", size: "short" },
      { id: "taught", label: "What it taught me I need / won’t accept", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "rday1.month_energized",
    instances: "row",
    label: "Energizer",
    min: 5,
    max: 5,
    fields: [
      { id: "what", label: "What it was", size: "long" },
      { id: "quality", label: "Quality it carried", size: "short" },
    ],
  },
  {
    kind: "repeat",
    id: "rday1.month_drained",
    instances: "row",
    label: "Drainer",
    min: 5,
    max: 5,
    fields: [
      { id: "what", label: "What it was", size: "long" },
      { id: "quality", label: "Quality it carried", size: "short" },
    ],
  },
  {
    kind: "repeat",
    id: "rday1.year_energizing",
    instances: "row",
    label: "Moment",
    min: 5,
    max: 5,
    fields: [{ id: "moment", label: "Moment", size: "long" }],
  },
  {
    kind: "repeat",
    id: "rday1.year_draining",
    instances: "row",
    label: "Moment",
    min: 5,
    max: 5,
    fields: [{ id: "moment", label: "Moment", size: "long" }],
  },
  { kind: "single", id: "rday1.patterns", label: "Patterns", size: "long" },
  { kind: "single", id: "rday1.threads", label: "Threads", size: "long" },
  { kind: "single", id: "rday1.external", label: "External observations", size: "long" },
];
