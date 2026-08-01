# 0001 — Voice-first input is a primary design constraint

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

The workbook asks for extended free-text reflection — 443 discrete blanks across the
five-day and rigorous tracks, most of them wanting sentences rather than words. That
volume of writing is a barrier to anyone who cannot type comfortably for long
stretches, and every design decision so far has quietly assumed a keyboard and an
uninterrupted hour.

This is stated as a general requirement. It describes a real class of users and does
not depend on any individual's circumstances.

## Decision

Treat completion without extended typing as a first-class requirement rather than an
accommodation retrofitted later. Every surface that accepts input must be usable by
dictation. Feature work whose primary justification is this constraint — notably the
agent bridge in [0007](0007-clipboard-is-the-airgap.md) — is in scope, and should say
so plainly rather than dressing itself up as something else.

## Consequences

**C1.** Autosave must never re-render or re-focus the field being edited. A debounced
save that replaces the DOM node or resets the caret destroys an in-progress dictation
session — minutes of speech, gone, in a way that is hard to reproduce and maddening to
hit. This is a hard constraint on the storage work, not a polish item.

**C2.** Fields should be large and few per screen. Dictating into a dense grid of short
inputs is considerably worse than dictating into one generous textarea.

**C3.** Progress must be durable at field granularity. A dictated session gets
interrupted, and resuming should never cost re-speaking an answer.

**C4.** Some conventional interactions get re-examined rather than inherited. Anything
that assumes rapid keyboard correction — inline validation that fights you mid-sentence,
aggressive autocomplete — needs justifying against this constraint.
