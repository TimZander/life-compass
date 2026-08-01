# 0004 — Prose stays Markdown; question definitions become TypeScript

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

Every blank in the worksheets is currently marked `<span class="fill">______</span>` —
443 of them, in two widths: 369 wide (`fill`, 15rem) and 74 narrow (`fill-sm`, 6rem).
These are drawn underlines, not form fields: the stylesheet hides the underscores and
draws a border. They carry no identity of any kind.

Once answers are stored, every blank needs an identifier stable enough to survive edits
to the prose around it, because that identifier is the storage key. Positional identity
— the seventh span in day one — breaks the first time a blank is inserted above it.

There is also structure the current markup cannot express. Day one's "five chapters,
three fields each" is fifteen anonymous spans. The interface wants one repeatable group
with an add-another control; the agent contract wants an array.

## Options

**O1. Schema blocks embedded in the Markdown.** *Rejected.* Fenced YAML inside each
worksheet file. One source of truth, no drift — but the raw file stops reading as a
worksheet on GitHub, and a public repository of worksheets being browsable is much of
what it is for.

**O2. Plain YAML sidecar per page.** *Rejected in this form.* Right shape, wrong
material. Untyped, and drift between the two files is caught by nothing.

**O3. Typed sidecar, joined at checked anchors.** *Chosen.* Prose in
`content/days/*.md`, question groups in `src/questions/*.ts`, joined at explicit anchors
in the prose.

## Decision

The standing objection to sidecar files is drift: two files, one gets edited, nothing
notices. That objection dissolves once the build can fail. Anchors in the prose —
`<!-- questions: chapters -->` — are checked in both directions: every anchor must
resolve to a group and every group must have an anchor, or the build stops.

Combined with strict typing, question identifiers become compile-time checked, and they
are the same identifiers used by the storage layer and by the agent output schema. One
rename, three call sites, all verified.

## Consequences

**C1.** The Markdown stays readable and printable on GitHub, unchanged in character from
today.

**C2.** Editing one section of a worksheet means touching two files. Accepted as the
price of the above.

**C3.** The `fill` spans become scaffolding with a scheduled removal. They stay
untouched through the initial rewrite, so its output can be diffed against the live site,
and come out page by page as each page's questions are defined. Their visual idea does
not die with them — [0010](0010-printing-is-a-supported-output.md) makes the print
renderer their successor.

**C4.** Renaming a question identifier is a migration, not a rename — stored answers key
off it. This needs a versioning and mapping plan *before* the first real answers exist,
because there is no fixing it afterwards. Flagged here rather than discovered later, and
settled in [0011](0011-question-identifiers-are-frozen-and-registered.md).
