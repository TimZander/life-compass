# 0002 — TypeScript, not JSDoc-typed JavaScript

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

The repository currently contains no JavaScript whatsoever: eighteen Markdown files,
one Jekyll layout, forty-six lines of CSS. Everything from here is new code, so the
language choice is unconstrained by legacy — which makes it worth deciding deliberately
instead of by habit.

Typed JavaScript — plain `.js` with JSDoc annotations, a `// @ts-check` pragma, and
`tsc --noEmit` in CI — is a pattern I have used successfully before and had assumed I
would reach for again.

## Options

**O1. JSDoc-typed JavaScript.** *Rejected.* Types in comments, no compile step, the
browser loads exactly the files you edit.

**O2. TypeScript, strict from the first commit.** *Chosen.* Real `.ts`, `strict: true`,
compiled as part of the build that has to exist anyway.

## Decision

JSDoc typing earns its awkward syntax in exchange for exactly one property: no build
step. That property is genuinely valuable — it removes a whole class of tooling rot
from a project you touch twice a year.

This project cannot keep it. The content has to be prerendered to static HTML
([0003](0003-multi-page-static-rendering-no-framework.md)), so a build exists
regardless of the language choice. Once you are paying for a build, JSDoc is cost with
nothing left to buy.

Strict everywhere from the first commit, with no incremental `checkJs` adoption and no
per-file pragmas. That migration pattern exists to bring an existing untyped codebase
under types gradually, and there is no such codebase here.

## Consequences

**C1.** Types are available to the question schema from day one — which matters more
than it sounds, because those same types become the storage keys and the agent output
contract ([0004](0004-prose-in-markdown-questions-in-typescript.md),
[0007](0007-clipboard-is-the-airgap.md)).

**C2.** A build step becomes load-bearing. Contributors need Node, and the
edit-and-refresh loop that a plain Jekyll site gave away for free is gone.

**C3.** Nothing about this reaches the reader. The published site remains static HTML
and CSS.
