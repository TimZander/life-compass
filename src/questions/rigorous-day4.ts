/**
 * Rigorous Day 4 — Purpose.
 *
 * Step 1's four unfair advantages ARE a group, unlike the short track's: here they are
 * four contiguous bullets with nothing between them, where the short track puts a bold
 * line of prose before each. Same worksheet, same question, different shape — which is
 * why the block scan is not enough on its own and the lines between blocks have to be
 * read every time.
 *
 * Step 3 goes the other way: three bullets that look contiguous but each carry their own
 * trailing prose, so they are singles with indented anchors.
 */

import type { Question } from "./types.ts";

export const RIGOROUS_DAY4: readonly Question[] = [
  {
    kind: "group",
    id: "rday4.advantages",
    fields: [
      { id: "skills", label: "Skills (technical and otherwise)", size: "long" },
      { id: "experiences", label: "Experiences that gave you unusual perspective", size: "long" },
      { id: "networks", label: "Networks or access", size: "long" },
      {
        id: "thinking",
        label: "Ways of thinking that feel natural to you but aren’t to others",
        size: "long",
      },
    ],
  },
  { kind: "single", id: "rday4.outside_input", label: "Strengths others named", size: "long" },
  { kind: "single", id: "rday4.who", label: "Who", size: "long" },
  { kind: "single", id: "rday4.problem", label: "Problem", size: "long" },
  { kind: "single", id: "rday4.changes", label: "What changes", size: "long" },
  {
    kind: "sentence",
    id: "rday4.enough_and_more",
    template: "The world has enough {excess}. It needs more {lack}.",
    fields: [
      { id: "excess", label: "Enough of", size: "short" },
      { id: "lack", label: "More of", size: "short" },
    ],
  },
  {
    kind: "sentence",
    id: "rday4.harder_to",
    template: "When I’m gone, I want it to be harder for people to {harder} because of work I did.",
    fields: [{ id: "harder", label: "Harder to", size: "short" }],
  },
  {
    kind: "sentence",
    id: "rday4.combination",
    template: "The unique combination I bring is {first} + {second} + {third}.",
    fields: [
      { id: "first", label: "First", size: "short" },
      { id: "second", label: "Second", size: "short" },
      { id: "third", label: "Third", size: "short" },
    ],
  },
  { kind: "single", id: "rday4.good_at", label: "Good at", size: "long" },
  { kind: "single", id: "rday4.energizes", label: "Energizes me", size: "long" },
  { kind: "single", id: "rday4.world_needs", label: "The world needs / who I’d serve", size: "long" },
  { kind: "single", id: "rday4.intersection", label: "Intersection", size: "long" },
  {
    kind: "repeat",
    id: "rday4.statements",
    instances: "row",
    label: "Purpose statement",
    min: 3,
    max: 3,
    fields: [{ id: "statement", label: "To", size: "long" }],
  },
  { kind: "single", id: "rday4.eulogy", label: "Eulogy", size: "long" },
  {
    kind: "sentence",
    id: "rday4.chosen_draft",
    template: "Draft # {draft} , because {reason}",
    fields: [
      { id: "draft", label: "Draft number", size: "short" },
      { id: "reason", label: "Because", size: "short" },
    ],
  },
  { kind: "single", id: "rday4.revised", label: "Revised purpose statement", size: "long" },
];
