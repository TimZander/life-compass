# 0012 — Client code becomes TypeScript, stripped at build time

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

[0002](0002-typescript-not-jsdoc-typed-javascript.md) chose real TypeScript for the build
and JSDoc for the client, and was explicit that the split rested on one condition: the
browser loads `assets/js/*.js` exactly as written, so annotating those files bought type
safety for no toolchain at all. It named the moment the condition would expire — "when
there is enough client code to justify emitting, expected at the storage work" — and
asked for that to be recorded rather than drifted into. This is the record.

The storage work (#24) is where the client stops being three small modules. It adds a
persistence layer, form binding for 447 fields, and an autosave path that
[0001](0001-voice-first-input-is-a-primary-constraint.md) makes safety-critical: a save
that re-renders the focused field destroys an in-progress dictation. That is code where
a wrong type is a lost paragraph of someone's speech, and it is about to be written.

JSDoc has held up well at 347 lines. The trade it makes — comment syntax in exchange for
no build step — gets worse in both directions as the tier grows: the annotations get
longer than the code they describe, and the "no build step" saving shrinks against a
build that already exists and already runs TypeScript.

## Options

**O1. Keep JSDoc.** *Rejected.* Not wrong, just increasingly expensive. Discriminated
unions over five question kinds, which the form binding needs, are where JSDoc's syntax
stops being a mild tax.

**O2. Add a bundler.** *Rejected.* [0003](0003-multi-page-static-rendering-no-framework.md)
weighs every dependency against a project meant to sit untouched for years, and nothing
here needs bundling: the pages load ES modules directly and the module graph is four
files deep. A bundler would buy minification and cost a toolchain.

**O3. Strip types at build time, emit nothing else.** *Chosen.* `ts.transpileModule` on
each file, from `src/client/*.ts` to `assets/js/*.js` in the output. TypeScript is
already a dependency, so this adds none.

## Decision

The client gets the same treatment the build already gets. Node 22.18+ erases types at
load, which is why `node build/build.ts` needs no compile step (0003 · C1a). Browsers
have no such feature, so the erasure has to happen somewhere else — at build time, for
the browser, by the same compiler.

That is the whole change. `transpileModule` strips types from one file at a time: no
bundling, no downlevelling, no module rewriting. The `./banner.js` specifier a browser
resolves is the specifier the source imports.

Type **checking** does not move. It stays in `tsc -p tsconfig.client.json --noEmit`,
which is the only thing standing between a type error and production, because the emit
never looks at types — it only removes them.

`erasableSyntaxOnly` is set on that config, and it is what makes the split safe rather
than merely convenient. It rejects enums, parameter properties and namespaces —
everything whose emit would be more than erasure. So what ships is always the source
minus its types, and the emit cannot be asked to do something it does not do.

## Consequences

**C1.** 0003 · C1a stands, slightly reworded: there is still no compilation, only
erasure. The dependency count is unchanged at two, and neither is new.

**C2.** Client modules are now the one thing on the site not served exactly as
committed. They join the service worker's precache as emitted output, so the cache
version covers the code that shipped rather than the TypeScript it came from.

**C3.** The tests that assert on client code read the **emitted** modules, not the
source. Asserting against source would keep passing if the transpile step stopped
running, and a silent failure on this tier removes offline support and storage
durability with no signal at all — which is the failure those tests exist to catch.

**C4.** `buildClient` returns nothing for a root without `src/client`, so fixture builds
work unchanged. That silence is made safe by a test asserting the real root emits
exactly the modules it should; without it, a directory that moved would ship a site
whose every page loads zero modules and whose build reports success.

**C5.** This replaces the arrangement in 0002 · C4 for client code only. The reasoning
there was sound and its condition was stated precisely enough to know when it expired,
which is the argument for writing conditions down rather than conclusions.
