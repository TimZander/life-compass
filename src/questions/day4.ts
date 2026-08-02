/**
 * Day 4 — Purpose.
 *
 * Section 3 is where sentence templates first appear. "The world has enough ___. It
 * needs more ___." is a sentence the reader completes, and splitting it into two
 * labelled fields would capture the same words while asking a different thing.
 */

import type { Question } from "./types.ts";

export const DAY4: readonly Question[] = [
  // Singles rather than groups. Each of these prompts is introduced by its own bold line
  // of prose — "Networks or access:", "Ways of thinking that feel natural to you but
  // aren't to others:" — and a group takes a single anchor, which would have deleted the
  // prose between them. The prompt IS the label here; it is already on the page.
  { kind: "single", id: "day4.skills", label: "Skills", size: "long" },
  { kind: "single", id: "day4.experiences", label: "Experiences", size: "long" },
  { kind: "single", id: "day4.networks", label: "Networks", size: "long" },
  { kind: "single", id: "day4.thinking", label: "Ways of thinking", size: "long" },

  { kind: "single", id: "day4.who", label: "Who", size: "long" },
  { kind: "single", id: "day4.problem", label: "Problem", size: "long" },
  { kind: "single", id: "day4.changes", label: "What changes", size: "long" },
  // The worksheet offers this sentence twice — two attempts at the same prompt, which is
  // the exercise. Two questions rather than one, because two attempts are two answers.
  // The digits are part of a hand-chosen frozen identifier, not positional identity:
  // nothing derives them from order, so reordering the file changes neither.
  {
    kind: "sentence",
    id: "day4.enough_and_more_1",
    template: "The world has enough {excess}. It needs more {lack}.",
    fields: [
      { id: "excess", label: "Enough of", size: "short" },
      { id: "lack", label: "More of", size: "short" },
    ],
  },
  {
    kind: "sentence",
    id: "day4.enough_and_more_2",
    template: "The world has enough {excess}. It needs more {lack}.",
    fields: [
      { id: "excess", label: "Enough of", size: "short" },
      { id: "lack", label: "More of", size: "short" },
    ],
  },
  {
    kind: "sentence",
    id: "day4.harder_to",
    template: "When I’m gone, I want it to be harder for people to {harder} because of work I did.",
    fields: [{ id: "harder", label: "Harder to", size: "short" }],
  },
  {
    kind: "sentence",
    id: "day4.combination",
    template: "The unique combination I bring is {first} + {second} + {third}.",
    fields: [
      { id: "first", label: "First", size: "short" },
      { id: "second", label: "Second", size: "short" },
      { id: "third", label: "Third", size: "short" },
    ],
  },
  {
    kind: "repeat",
    id: "day4.statements",
    instances: "row",
    label: "Purpose statement",
    min: 3,
    max: 3,
    fields: [{ id: "statement", label: "To", size: "long" }],
  },
  { kind: "single", id: "day4.eulogy", label: "Eulogy", size: "long" },
  {
    kind: "sentence",
    id: "day4.chosen_draft",
    template: "Draft # {draft} — because {reason}",
    fields: [
      { id: "draft", label: "Draft number", size: "short" },
      { id: "reason", label: "Because", size: "short" },
    ],
  },
];
