/**
 * One-page anchor — the whole compass in half an hour.
 *
 * Three of its four steps are a quoted sentence the reader completes, and the quoting is
 * the point: these are lines you say to yourself on a Tuesday, not fields you fill. The
 * anchors sit INSIDE their blockquotes so the quoting survives, which works because
 * markdown-it parses blockquote content as blocks like any other — the review date needs
 * it especially, since the two questions that follow it live in the same quote.
 */

import type { Question } from "./types.ts";

export const ANCHOR_PAGE: readonly Question[] = [
  // Singles, not a group: the second prompt carries a parenthetical of its own ("Anger is
  // a reliable pointer to a held value"), and a group takes one anchor across both.
  { kind: "single", id: "anchor.alive", label: "Value being honored", size: "long" },
  { kind: "single", id: "anchor.angry", label: "Value being violated", size: "long" },
  { kind: "single", id: "anchor.costly", label: "One I would defend when costly", size: "long" },
  {
    kind: "repeat",
    id: "anchor.ranked",
    instances: "row",
    label: "Value",
    min: 3,
    max: 3,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
  {
    kind: "sentence",
    id: "anchor.theme",
    template: "“For the next 90 days I’m optimizing for {focus} over {tradeoff}.”",
    fields: [
      { id: "focus", label: "Optimizing for", size: "short" },
      { id: "tradeoff", label: "Over", size: "short" },
    ],
  },
  {
    kind: "sentence",
    id: "anchor.decision_rule",
    template: "“When I’m stuck between options, I default to the one that {rule}.”",
    fields: [{ id: "rule", label: "Default to the one that", size: "short" }],
  },
  {
    kind: "sentence",
    id: "anchor.review_date",
    template: "Re-read this on {date} (≈90 days out) and ask two questions:",
    fields: [{ id: "date", label: "Review date", size: "short" }],
  },
];
