/**
 * Day 5 — Synthesis.
 *
 * The five dimensions each ask different things, so each is a group rather than one
 * repeat with shared fields. Career and Money ask four questions; Place, People and
 * Time ask three. Forcing them into a repeat would have invented a symmetry the
 * exercise does not have.
 */

import type { Question } from "./types.ts";

export const DAY5: readonly Question[] = [
  {
    kind: "checklist",
    id: "day5.ready",
    items: [
      { id: "values", label: "Values filled in" },
      { id: "passions", label: "Passions filled in" },
      { id: "purpose", label: "Purpose filled in" },
      { id: "non_negotiables", label: "Non-negotiables filled in" },
    ],
  },
  {
    kind: "group",
    id: "day5.career",
    fields: [
      { id: "values_daily", label: "Does my work let me live my values daily, or require me to suppress them?", size: "long" },
      { id: "passions_used", label: "Does it use my passions, or just my skills?", size: "long" },
      { id: "serves_purpose", label: "Is it serving my purpose, or unrelated to it?", size: "long" },
      { id: "change", label: "One specific change that would move this closer to aligned", size: "long" },
    ],
  },
  {
    kind: "group",
    id: "day5.money",
    fields: [
      { id: "in_service", label: "Am I earning and spending in service of what I value, or of habits and expectations?", size: "long" },
      { id: "overspending", label: "What am I overspending on that doesn't serve the compass?", size: "long" },
      { id: "underspending", label: "What am I underspending on that would?", size: "long" },
      { id: "change", label: "One change", size: "long" },
    ],
  },
  {
    kind: "group",
    id: "day5.place",
    fields: [
      { id: "supports", label: "Does where I live support my values, passions, and purpose?", size: "long" },
      { id: "full_yes", label: "What would have to be true about where I live for it to be a full yes?", size: "long" },
      { id: "change", label: "One change", size: "long" },
    ],
  },
  {
    kind: "group",
    id: "day5.people",
    fields: [
      { id: "amplify", label: "Who in my life amplifies the compass? Who pulls against it?", size: "long" },
      { id: "more_less", label: "Who do I need more of? Less of?", size: "long" },
      { id: "change", label: "One change", size: "long" },
    ],
  },
  {
    kind: "group",
    id: "day5.time",
    fields: [
      { id: "percent", label: "Look at last week's calendar. What percentage of waking hours served the compass?", size: "long" },
      { id: "recurring", label: "What recurring time commitments don't?", size: "long" },
      { id: "change", label: "One change", size: "long" },
    ],
  },
  {
    kind: "repeat",
    id: "day5.realignment",
    label: "Move",
    min: 2,
    max: 2,
    fields: [{ id: "move", label: "Move", size: "long" }],
  },
  {
    kind: "group",
    id: "day5.review",
    fields: [
      { id: "quarterly", label: "Next quarterly review (15 min)", size: "long" },
      { id: "annual", label: "Next annual review (90 min)", size: "long" },
    ],
  },
];
