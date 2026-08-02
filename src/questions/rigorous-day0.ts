/**
 * Rigorous Day 0 — Prep.
 *
 * Two questions and a gathering checklist. The checklist is the second in the workbook
 * after Day 5's readiness list, and the reason `checklist` exists as a kind: four ticks
 * are one question with four items, not four questions.
 *
 * Identifiers are prefixed `r` rather than reusing `day0`, because the rigorous track is
 * a parallel workbook rather than a longer version of the same one — a reader can do
 * both, and their answers are different answers (0011).
 */

import type { Question } from "./types.ts";

export const RIGOROUS_DAY0: readonly Question[] = [
  {
    kind: "checklist",
    id: "rday0.gather",
    items: [
      {
        id: "calendar",
        label: "Export or screenshot last month’s calendar — where your time actually went.",
      },
      {
        id: "spending",
        label:
          "Pull last 2–3 months of spending, roughly categorized — where your money actually went.",
      },
      {
        id: "history",
        label:
          "Open your browser / watch / listen history and note what you return to unprompted.",
      },
      {
        id: "screen_time",
        label:
          "Grab your screen-time breakdown by app or category, if your phone tracks it.",
      },
    ],
  },
  // Two singles rather than one group: each is introduced by its own bold question, and
  // the second carries a sentence of explanation after the question mark. A group takes
  // one anchor spanning both, which would have deleted the prose between them — the
  // near-miss from the days/ slice, in a file where it would have been just as invisible.
  { kind: "single", id: "rday0.come_to_you_for", label: "What people come to me for", size: "long" },
  { kind: "single", id: "rday0.brushed_off", label: "The compliment I brush off", size: "long" },
];
