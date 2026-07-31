# 0010 — Printing stays a supported output, not an accident

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

The worksheets print well today, and printing a blank day to fill in with a pen is a
legitimate way to use this — arguably the original way. Adding form controls threatens
that quietly: a page full of text inputs prints as a page full of empty boxes.

## Decision

Printing is a supported output with its own stylesheet and its own tests. Question fields
render as interactive controls on screen and as ruled blank lines on paper, from one
definition.

This resolves something left hanging in
[0004 · C3](0004-prose-in-markdown-questions-in-typescript.md). The `fill` spans were
described there as scaffolding awaiting removal — in fact the print renderer is their
successor. The visual idea survives; it stops being hand-written markup and becomes an
output mode of the question schema.

Two print modes, and the second is nearly free once the first exists: a blank worksheet,
and a completed one. Printing a finished compass is the natural way to keep it somewhere
that outlives a browser profile.

## Consequences

**C1.** Question definitions need a size hint — roughly how much room an answer wants —
because print has to allocate ruled lines and cannot infer it. That hint does double duty:
[0001](0001-voice-first-input-is-a-primary-constraint.md) wants generous fields for
dictation, and this is where that gets expressed once rather than guessed at per page.

**C2.** `break-inside: avoid` on question groups, so a five-part chapter block does not
split across a page boundary. Print is a real layout, not a filter over the screen one.

**C3.** Print CSS rots silently — nobody notices until they print, by which point they are
standing at a printer. Testable, though: render a page to PDF in a headless browser and
assert the expected count of ruled blanks and the absence of form controls. Cheap, and
aimed squarely at the regression class print bugs belong to.

**C4.** Multi-page static rendering
([0003](0003-multi-page-static-rendering-no-framework.md)) makes this straightforward
where a single-page app would have made it awkward. Worth recording as a benefit that
decision earns twice.

**C5.** Two rendering paths for every question type, permanently. Accepted: printing is a
use case, not a legacy artifact to be tolerated.
