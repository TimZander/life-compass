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
    // "From your circled list" — which is the brainstorm, plus whatever the reader added on
    // the list's own page. Both, because item 1 says "Add your own" and the reference page is
    // where those additions are kept, so either alone is a partial reading of one list.
    reads: ["day2.brainstorm", "values.additions"],
  },
  {
    kind: "repeat",
    id: "day2.shortlist_five",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
    // The ten, not the fifty. "Force-rank down to 5" is a step of the narrowing, and handing
    // back the whole brainstorm would reopen a decision the reader has already made.
    reads: ["day2.shortlist_ten"],
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
    // "For each of your 5" — and the five are five words the assistant otherwise has to ask
    // the reader to say again before it can define the first of them.
    reads: ["day2.shortlist_five"],
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
    // "Take your ranking from step 3" — the whole exercise is testing that ranking against
    // real decisions, so a prompt without it is asking about nothing in particular.
    reads: ["day2.shortlist_five"],
  },
  {
    kind: "repeat",
    id: "day2.ranked",
    instances: "row",
    label: "Value",
    min: 5,
    max: 5,
    fields: [{ id: "value", label: "Value", size: "long" }],
    // The same five its sibling tests. An adjusted ranking is an edit of that list, and the
    // context section carries it once for the item rather than twice.
    reads: ["day2.shortlist_five"],
  },
];
