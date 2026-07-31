# 0003 — Multi-page static rendering, no framework, no bundler

- **Status:** Proposed
- **Date:** 2026-07-29
- **Revised:** 2026-07-30, before acceptance. O3 was originally the chosen option; the
  reasoning that rejected O2 was found to apply to it as well. See *Revision note* below.

## Context

The site is content first: seven worksheet pages plus supporting essays. It will grow
interactive form controls, but prose remains the bulk of it and probably always will.

This project has an unusual operating assumption: it is expected to be deployed and then
left alone for years at a time. That is not a hedge, it is the intended lifecycle. Any
tooling decision has to be judged on what it costs to return to cold, not on what it
costs to work with daily.

## Options

**O1. Single-page app with a router.** *Rejected.* Vue, React or Preact,
client-rendered, one shell.

**O2. Astro.** *Rejected.* Purpose-built for exactly this shape of site. Content
collections with schema validation would solve much of
[0004](0004-prose-in-markdown-questions-in-typescript.md) outright, and it has a
first-party Cloudflare story.

**O3. Vite plus a hand-written static build.** *Rejected.* One HTML file per worksheet,
no UI framework, Vite handling bundling and the dev server.

**O4. TypeScript compiler plus a Markdown renderer, no bundler.** *Chosen.* `tsc` emits
JavaScript, browsers load ES modules natively, and a small owned script renders Markdown
to one HTML file per page.

## Decision

Multi-page wins on four counts that all matter here: the pages stay printable; the
content is present in the HTML for indexing and for readers without JavaScript; the
service worker can cache each page independently; and interactivity arrives on top of
pages that already work rather than as a precondition for anything rendering at all.
That much was never in doubt. The rest of this decision is about what builds it.

The axis that matters is not how often a dependency releases — everything releases.
It is **how much of this project's own code is welded to it**, because that is what
determines the cost of returning after a long gap.

- Astro couples every page, every content collection, and every component to its API.
  Returning cold means reading migration guides for versions that were skipped.
- Vite couples the build configuration and the import semantics. Smaller, still real,
  and it majors at roughly the same annual cadence as the framework it was preferred
  over.
- `tsc` and a Markdown renderer couple almost nothing. Both are build-time only, neither
  appears in the shipped output, and replacing the Markdown library is an afternoon.

So the stack is two dependencies. `tsc` emits JavaScript and browsers load ES modules
directly; no bundler is involved. The client-side code this project will ever have — a
storage wrapper, form autosave, install prompting, clipboard handling, import validation
— is on the order of two thousand lines. That is not bundler territory.

Note that this does not eliminate the build. Prerendering Markdown to static HTML still
requires one, which is why
[0002](0002-typescript-not-jsdoc-typed-javascript.md) chose real TypeScript over JSDoc
annotations. "No bundler" and "no build" are different claims, and only the first is
being made.

### One argument deliberately not used

Accumulated vulnerabilities in a dormant dependency tree. These are build-time
dependencies; nothing reaches the browser, and a Markdown parser rendering this
repository's own prose on the author's own machine is close to zero risk. It is the
reflexive reason to fear dependencies and it does not apply here. The real hazard is
`npm install` simply failing years later, which fewer dependencies genuinely help with.

## Consequences

**C1.** Two dependencies: TypeScript and a Markdown renderer. Both build-time only.

**C2.** No hot reload while developing. A static file server and a browser refresh.

**C3.** No minification or bundling — roughly 60 KB of ES modules where a bundler would
have produced 25 KB, fetched once and then cached by the service worker. Irrelevant at
this size. It would not be at ten times this size, and that is the signal to revisit
rather than absorb.

**C4.** Cache versioning is hand-rolled. The service worker needs a versioning scheme
regardless ([0005](0005-cloudflare-pages-for-header-control.md)), so this is work already
owed rather than newly created.

**C5.** Some hand-written build code — page rendering, question-block injection — that a
framework would have supplied. Estimated small. If it turns out not to be, that is a
signal worth revisiting this decision over rather than absorbing quietly.

**C6.** Interactive controls are hand-rolled. With no shared state across pages and a
form model that amounts to text going into a field, this is a far smaller cost than it
would be for a typical application.

**C7.** Every page works with JavaScript disabled — a stronger accessibility floor than a
single-page app can offer, and one that compounds with
[0001](0001-voice-first-input-is-a-primary-constraint.md).

**C8.** Archive the built output. For a project deliberately left dormant, a tagged
`dist/` is the difference between "I cannot rebuild this" and "I cannot rebuild this
*yet*" — the deployed site remains editable by hand even if the toolchain stops running.
Costs nothing.

## Revision note

O3 was the original decision, and it rejected Astro on maintenance surface while quietly
exempting Vite from the same test. The claim recorded here as C1 previously read "a build
script I own has no breaking changes," which was not true of a script sitting on a
dependency that majors annually.

Reframing the question from release cadence to coupling surface rejects both. Recorded
rather than silently edited, because the original error — applying a standard to one
option and not to the next one down the list — is a more useful thing to have written
down than a clean record would have been.
