/**
 * Rigorous Day 3 — Passions.
 *
 * Step 2 mines the Day 0 records, and its shape is three named sources — Calendar,
 * History, Spending — each asked the same two questions. Structurally that is a repeat,
 * but the names come from the worksheet rather than from the reader, and a repeat's
 * instances are the reader's to add and remove (#24). A fixed-name repeat variant would
 * be schema surface for one question, so these are three groups instead, each keeping
 * its name as the prose line above it. Three identifiers also means #24 can bind each
 * source separately, which one six-field blob would not allow.
 *
 * Themes 4 and 5 carried one example slot where the first three carried two, and were
 * marked "(optional)" in their own headings. As on the short track, the range says that
 * instead: the prose above the anchor already reads "3–5 themes".
 */

import type { Question } from "./types.ts";

export const RIGOROUS_DAY3: readonly Question[] = [
  {
    kind: "repeat",
    id: "rday3.energy",
    instances: "row",
    label: "Activity",
    min: 5,
    max: 5,
    fields: [
      { id: "activity", label: "Activity", size: "long" },
      { id: "context", label: "What / how / who?", size: "long" },
      { id: "fuel", label: "What specifically fuels me", size: "long" },
    ],
  },
  {
    kind: "group",
    id: "rday3.calendar",
    fields: [
      { id: "shows", label: "What it actually shows", size: "long" },
      { id: "matched", label: "Did it match what I’d have guessed?", size: "short" },
    ],
  },
  {
    kind: "group",
    id: "rday3.history",
    fields: [
      { id: "shows", label: "What it actually shows", size: "long" },
      { id: "matched", label: "Did it match what I’d have guessed?", size: "short" },
    ],
  },
  {
    kind: "group",
    id: "rday3.spending",
    fields: [
      { id: "shows", label: "What it actually shows", size: "long" },
      { id: "matched", label: "Did it match what I’d have guessed?", size: "short" },
    ],
  },
  { kind: "single", id: "rday3.flow", label: "Flow activities", size: "long" },
  { kind: "single", id: "rday3.attention", label: "Subjects", size: "long" },
  { kind: "single", id: "rday3.hypothetical", label: "What I’d do", size: "long" },
  {
    kind: "sentence",
    id: "rday3.reconciling",
    template: "Hypothetical says {hypothetical} ; the data says {data} ; reconciling: {reconciling}",
    fields: [
      { id: "hypothetical", label: "Hypothetical", size: "short" },
      { id: "data", label: "Data", size: "short" },
      { id: "reconciling", label: "Reconciling", size: "short" },
    ],
  },
  {
    kind: "repeat",
    id: "rday3.themes",
    instances: "section",
    label: "Theme",
    min: 5,
    max: 5,
    fields: [
      { id: "name", label: "Theme", size: "long" },
      { id: "data_example", label: "Data example", size: "long" },
      { id: "other_example", label: "Other example", size: "long" },
    ],
  },
];
