# 0003 — Multi-page static rendering, no client-side framework

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

The site is content first: seven worksheet pages plus supporting essays. It will grow
interactive form controls, but prose remains the bulk of it and probably always will.

## Options

**O1. Single-page app with a router.** *Rejected.* Vue, React or Preact,
client-rendered, one shell.

**O2. Astro.** *Rejected, narrowly.* Purpose-built for exactly this shape of site.
Content collections with schema validation would solve much of
[0004](0004-prose-in-markdown-questions-in-typescript.md) outright, and it has a
first-party Cloudflare story.

**O3. Vite plus a hand-written static build.** *Chosen.* One HTML file per worksheet, no
UI framework, interactivity added as progressive enhancement.

## Decision

Multi-page wins on four counts that all matter here: the pages stay printable; the
content is present in the HTML for indexing and for readers without JavaScript; the
service worker can cache each page independently; and interactivity arrives on top of
pages that already work rather than as a precondition for anything rendering at all.

Astro was the close call, and it would have been faster to build. It was rejected on
maintenance surface. This is a personal project touched intermittently across years, and
a framework with roughly annual majors is a recurring migration tax paid for velocity
this project does not need. A build script I own has no breaking changes.

Vite is adopted now rather than at the PWA stage, despite there being no client-side
JavaScript to bundle in the first phase, so that the later work does not require a
second migration.

## Consequences

**C1.** Dependencies stay near three: TypeScript, Vite, a Markdown renderer.

**C2.** Some hand-written build code — page rendering, question-block injection — that a
framework would have supplied. Estimated small. If it turns out not to be, that is a
signal worth revisiting this decision over rather than absorbing quietly.

**C3.** Interactive controls are hand-rolled. With no shared state across pages and a
form model that amounts to text going into a field, this is a far smaller cost than it
would be for a typical application.

**C4.** Every page works with JavaScript disabled — a stronger accessibility floor than
a single-page app can offer, and one that compounds with
[0001](0001-voice-first-input-is-a-primary-constraint.md).
