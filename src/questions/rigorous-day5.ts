/**
 * Rigorous Day 5 — Synthesis and measurement.
 *
 * The five dimensions are five singles, not one group. Each is a paragraph of prose
 * ending in "· **One change:**", so the label the reader needs is already on the page
 * and a group would have taken one anchor across all five paragraphs.
 *
 * Step 3 is the measurement pass, and it is where sentences earn their place a second
 * time: "aligned hours: ___ / ___ = ___%" is an arithmetic statement, and splitting it
 * into three labelled fields would leave the reader assembling the fraction themselves.
 *
 * The compass template in step 1 is a fenced code block. Its underscores are not blanks
 * and are deliberately left alone — it is a thing to copy into a file of your own, not a
 * thing to fill in on the page.
 */

import type { Question } from "./types.ts";

export const RIGOROUS_DAY5: readonly Question[] = [
  { kind: "single", id: "rday5.career", label: "One change", size: "long" },
  { kind: "single", id: "rday5.money", label: "One change", size: "long" },
  { kind: "single", id: "rday5.place", label: "One change", size: "long" },
  { kind: "single", id: "rday5.people", label: "One change", size: "long" },
  { kind: "single", id: "rday5.time", label: "One change", size: "long" },
  { kind: "single", id: "rday5.definition", label: "My definition", size: "long" },
  {
    kind: "sentence",
    id: "rday5.time_baseline",
    template: "aligned hours: {aligned} / {total} = {percent}%",
    fields: [
      { id: "aligned", label: "Aligned hours", size: "short" },
      { id: "total", label: "Total hours", size: "short" },
      { id: "percent", label: "Percent", size: "short" },
    ],
  },
  {
    kind: "sentence",
    id: "rday5.money_baseline",
    template: "discretionary spend that served the compass: {percent}%",
    fields: [{ id: "percent", label: "Percent", size: "short" }],
  },
  {
    kind: "sentence",
    id: "rday5.targets",
    template: "Time target: {time}% · Money target: {money}%",
    fields: [
      { id: "time", label: "Time target", size: "short" },
      { id: "money", label: "Money target", size: "short" },
    ],
  },
  { kind: "single", id: "rday5.versioning", label: "Cause for each change", size: "long" },
  {
    kind: "repeat",
    id: "rday5.realignment",
    instances: "row",
    label: "Move",
    min: 2,
    max: 2,
    fields: [{ id: "move", label: "Move", size: "long" }],
  },
  { kind: "single", id: "rday5.review_quarterly", label: "Next quarterly review", size: "short" },
  { kind: "single", id: "rday5.review_annual", label: "Next annual review", size: "short" },
];
