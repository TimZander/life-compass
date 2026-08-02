# 0004 — Prose stays Markdown; question definitions become TypeScript

- **Status:** Accepted
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

**O3. Typed sidecar, joined at checked anchors.** *Chosen.* Prose in `days/*.md`,
question groups in `src/questions/*.ts`, joined at explicit anchors in the prose.

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

## Outcome

*Recorded 2026-08-02, when the migration finished. The record above is left as written;
this is what actually happened.*

**C3 is discharged.** Every blank on the site is generated: 447 of them across 14
worksheets, from 113 question definitions and 254 registered identifiers. The only
`class="fill"` left in any Markdown is in this record, which quotes the markup inside
backticks while discussing it.

Three checks were worth more than the rest, and all three passed: no line of prose was
deleted anywhere in the workbook, every page renders the heading count it had before
migration, and the blank total moved 443 → 447 for exactly two reasons — on both Day 3s,
themes 4 and 5 carried fewer example slots than themes 1–3, and a repeat cannot say that
about some instances and not others.

**C5. One shape was not enough.** This record anticipated "one repeatable group with an
add-another control". The worksheets have five: a bare answer (`single`), a repeated
group (`repeat`), several distinct prompts answered together (`group`), a list of ticks
(`checklist`), and a sentence the reader completes (`sentence`) — 16 of those, carrying 31
gaps between them, where splitting the sentence into labelled fields would have captured
the same words while asking a different thing.

**C6. Presentation is in the schema after all, three times.** A `repeat` declares whether
its instances are a `line`, a `row`, or a `section`. The line this record implied — prose
and layout in Markdown, data in TypeScript — sits instead at whether a form UI could
ignore the property without harming anyone. It cannot ignore `section`: those headings are
landmarks a screen reader navigates by, and rendering five of them as list rows removes
five landmarks from the page ([0001](0001-voice-first-input-is-a-primary-constraint.md)).
Emphasis, list markers and blockquote styling stayed out, and are derived at render time
from the label's own punctuation.

**C7. The bidirectional check earned its keep, and needed company.** Anchors checked both
ways caught what it was written for. It did not catch a sentence gap with no field, a
field with no gap, a repeated gap name, a duplicate field id, an empty question, or a
straight apostrophe in generated text — each invisible in the built page, each now its own
build failure in `checkSchema`.
