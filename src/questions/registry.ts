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
];
