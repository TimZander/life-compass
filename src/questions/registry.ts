/**
 * Every question identifier this project has ever used.
 *
 * docs/decisions/0011 makes identifiers frozen: stored answers key off them, and there
 * is no server on which to run a migration, so a rename is a data migration that has to
 * keep working for readers who return years later. This file is what makes freezing
 * enforceable rather than merely intended — the build fails when a question uses an
 * identifier that is not registered, and when a registered `active` identifier no longer
 * appears in any question. Renaming therefore takes two deliberate edits instead of one.
 *
 * A `retired` entry naming `renamedTo` IS the migration: stored data carrying the old
 * identifier is rewritten on read. Retiring without `renamedTo` means the answers become
 * orphans, which are kept and surfaced rather than deleted, because this is writing that
 * exists nowhere else.
 *
 * Expect this file to become the longest in the schema and never to shrink. There is no
 * floor on how old arriving data might be, so no entry can ever be deleted. That is
 * working as intended, not rot.
 */

export type RegistryEntry = {
  readonly id: string;
  readonly status: "active" | "retired";
  /** ISO date the identifier was retired. Required when status is `retired`. */
  readonly retiredOn?: string;
  /** Identifier that supersedes this one. Absent means the answers become orphans. */
  readonly renamedTo?: string;
  readonly note?: string;
};

export const REGISTRY: readonly RegistryEntry[] = [
  // ---- Day 1 — Excavation ------------------------------------------------------
  { id: "day1.chapters", status: "active" },
  { id: "day1.chapters.title", status: "active" },
  { id: "day1.chapters.defined_by", status: "active" },
  { id: "day1.chapters.learned", status: "active" },

  { id: "day1.peaks", status: "active" },
  { id: "day1.peaks.moment", status: "active" },
  { id: "day1.peaks.doing", status: "active" },
  { id: "day1.peaks.with", status: "active" },
  { id: "day1.peaks.quality", status: "active" },

  { id: "day1.low_points", status: "active" },
  { id: "day1.low_points.moment", status: "active" },
  { id: "day1.low_points.violated", status: "active" },
  { id: "day1.low_points.taught", status: "active" },

  { id: "day1.energizers", status: "active" },
  { id: "day1.energizers.activity", status: "active" },

  { id: "day1.drainers", status: "active" },
  { id: "day1.drainers.activity", status: "active" },

  { id: "day1.patterns", status: "active" },
  { id: "day1.threads", status: "active" },

  // ---- day-2-values ----

  { id: "day2.brainstorm", status: "active" },

  { id: "day2.shortlist_ten", status: "active" },
  { id: "day2.shortlist_ten.value", status: "active" },

  { id: "day2.shortlist_five", status: "active" },
  { id: "day2.shortlist_five.value", status: "active" },

  { id: "day2.operationalised", status: "active" },
  { id: "day2.operationalised.name", status: "active" },
  { id: "day2.operationalised.definition", status: "active" },
  { id: "day2.operationalised.living", status: "active" },
  { id: "day2.operationalised.betraying", status: "active" },

  { id: "day2.conflicts", status: "active" },
  { id: "day2.conflicts.decision", status: "active" },
  { id: "day2.conflicts.chosen", status: "active" },

  { id: "day2.ranked", status: "active" },
  { id: "day2.ranked.value", status: "active" },

  // ---- day-3-passions ----

  { id: "day3.energy", status: "active" },
  { id: "day3.energy.activity", status: "active" },
  { id: "day3.energy.context", status: "active" },
  { id: "day3.energy.fuel", status: "active" },

  { id: "day3.flow", status: "active" },
  { id: "day3.flow.activity", status: "active" },

  { id: "day3.attention", status: "active" },

  { id: "day3.hypothetical", status: "active" },

  { id: "day3.reveals", status: "active" },

  { id: "day3.themes", status: "active" },
  { id: "day3.themes.name", status: "active" },
  { id: "day3.themes.example_1", status: "active" },
  { id: "day3.themes.example_2", status: "active" },
  { id: "day3.themes.example_3", status: "active" },

  // ---- day-4-purpose ----

  { id: "day4.skills", status: "active" },

  { id: "day4.experiences", status: "active" },

  { id: "day4.networks", status: "active" },

  { id: "day4.thinking", status: "active" },

  { id: "day4.who", status: "active" },

  { id: "day4.problem", status: "active" },

  { id: "day4.changes", status: "active" },

  { id: "day4.enough_and_more_1", status: "active" },
  { id: "day4.enough_and_more_1.excess", status: "active" },
  { id: "day4.enough_and_more_1.lack", status: "active" },

  { id: "day4.enough_and_more_2", status: "active" },
  { id: "day4.enough_and_more_2.excess", status: "active" },
  { id: "day4.enough_and_more_2.lack", status: "active" },

  { id: "day4.harder_to", status: "active" },
  { id: "day4.harder_to.harder", status: "active" },

  { id: "day4.combination", status: "active" },
  { id: "day4.combination.first", status: "active" },
  { id: "day4.combination.second", status: "active" },
  { id: "day4.combination.third", status: "active" },

  { id: "day4.statements", status: "active" },
  { id: "day4.statements.statement", status: "active" },

  { id: "day4.eulogy", status: "active" },

  { id: "day4.chosen_draft", status: "active" },
  { id: "day4.chosen_draft.draft", status: "active" },
  { id: "day4.chosen_draft.reason", status: "active" },

  // ---- day-5-synthesis ----

  { id: "day5.ready", status: "active" },
  { id: "day5.ready.values", status: "active" },
  { id: "day5.ready.passions", status: "active" },
  { id: "day5.ready.purpose", status: "active" },
  { id: "day5.ready.non_negotiables", status: "active" },

  { id: "day5.career", status: "active" },
  { id: "day5.career.values_daily", status: "active" },
  { id: "day5.career.passions_used", status: "active" },
  { id: "day5.career.serves_purpose", status: "active" },
  { id: "day5.career.change", status: "active" },

  { id: "day5.money", status: "active" },
  { id: "day5.money.in_service", status: "active" },
  { id: "day5.money.overspending", status: "active" },
  { id: "day5.money.underspending", status: "active" },
  { id: "day5.money.change", status: "active" },

  { id: "day5.place", status: "active" },
  { id: "day5.place.supports", status: "active" },
  { id: "day5.place.full_yes", status: "active" },
  { id: "day5.place.change", status: "active" },

  { id: "day5.people", status: "active" },
  { id: "day5.people.amplify", status: "active" },
  { id: "day5.people.more_less", status: "active" },
  { id: "day5.people.change", status: "active" },

  { id: "day5.time", status: "active" },
  { id: "day5.time.percent", status: "active" },
  { id: "day5.time.recurring", status: "active" },
  { id: "day5.time.change", status: "active" },

  { id: "day5.realignment", status: "active" },
  { id: "day5.realignment.move", status: "active" },

  { id: "day5.review", status: "active" },
  { id: "day5.review.quarterly", status: "active" },
  { id: "day5.review.annual", status: "active" },
];
