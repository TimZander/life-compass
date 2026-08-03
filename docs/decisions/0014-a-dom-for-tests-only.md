# 0014 — A DOM for tests, and only for tests

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

[0001](0001-voice-first-input-is-a-primary-constraint.md) makes one promise the rest of
the workbook is built around: a save must never disturb the field a reader is dictating
into. [#24](https://github.com/TimZander/life-compass/issues/24) names the test that
proves it — dictation-shaped input, arriving in bursts, must survive a save cycle with the
caret intact — and until the fields existed there was nothing to point it at.

The fields exist now, and they are DOM code: `src/client/fields.ts` upgrades every blank
to a control, reads a blank's address from `data-instance` and `data-field` on its
ancestors, guards restore against `document.activeElement`, and listens for `input`. Node
has no DOM, so none of that can be exercised by the suite as it stands.

[0003](0003-multi-page-static-rendering-no-framework.md) weighs every dependency against a
project meant to sit untouched for years, and the count has been two since it was written.
This is the first thing that has asked to make it three.

## Options

**O1. A hand-rolled fake covering the ten DOM APIs `fields.ts` uses.** *Rejected*, and
rejected on evidence rather than taste. [0013](0013-instance-identity-for-rendered-slots.md)
shipped exactly that shape one slice earlier: a hand-rolled tag walker, written alongside
the tests that used it, which passed everything until an adversarial pass found
`class = "fill"` — valid HTML, resolved by every browser — sailing through both the walker
and the count that was supposed to catch the walker under-seeing. A fake `closest()` or
`activeElement` that differs from a browser's in some corner gives tests that pass on
broken binding code, and the binding is where a defect costs somebody the paragraph they
just spoke.

**O2. Test in a real browser.** *Rejected for now.* Correct, and eventually right for the
end-to-end path, but it needs a driver, a browser download and a place to run them — far
more machinery than one dev dependency, for the same question.

**O3. A DOM implementation, dev-only.** *Chosen.* `happy-dom`, in `devDependencies`. It
supports the three things this actually turns on — `focus()` and `document.activeElement`,
`selectionStart`/`selectionEnd`, and ancestor traversal — which were verified before it
was adopted rather than assumed.

## Decision

The dependency count 0003 guards is a count of things **the shipped site depends on**, and
by that measure it is unchanged: nothing in `dist/` gains a byte, no client module imports
this, and a reader's browser never sees it. What grows is the toolchain, and 0003 · C1's
actual objection — "how much of this project's own code is welded to it" — does not apply
to a package that only ever appears inside a test file's `import`.

The trade is between a dependency that can be removed in an afternoon and a fake that
would have to be trusted without any way to check it. This project has just spent four
review rounds learning what an unverifiable check costs.

## Consequences

**C1.** 0003's "two dependencies" figure now means two *runtime* dependencies and three
dev ones. The distinction was always implicit — `typescript` was never shipped either —
and is worth stating rather than leaving to be re-derived.

**C2.** The client tier becomes testable at all. Before this, `banner.ts`, `sw-update.ts`
and `fields.ts` were verified by reading their emitted output for expected substrings,
which is why three device-testing rounds found bugs the suite could not. Those modules can
now be exercised rather than pattern-matched.

**C3.** A DOM in tests is not a browser. It does not lay out, does not paint, and its
event loop is not a real one, so it cannot answer whether a textarea grows correctly or
whether a banner is legible. Device testing stays the check for anything visual — this
replaces none of it.

**C4.** The suite gains a way to be wrong that it did not have: a test can now pass
because `happy-dom` behaves differently from a browser rather than because the code is
right. That is a smaller and better-understood risk than a fake written here, but it is
not zero, and anything surprising is worth checking against a device before trusting.

**C5.** Client modules now import each other as `./keys.ts`, and the emit rewrites the
extension to `.js`. [0012](0012-client-typescript-stripped-at-build-time.md) had the
sources say `.js` so the specifier a browser resolves is the one the source contains, and
that held while no client module imported another at runtime — `fields.ts` is the first
that does, and Node cannot resolve `./keys.js` from source, so the tier would have been
untestable exactly where it matters most. `rewriteRelativeImportExtensions` is set in
`tsconfig.client.json` and in `build/client.ts`'s transpile options, and it is the only
rewrite: no resolution, no bundling, nothing that knows how the site is served. The two
settings have to agree or the emit ships `.ts` specifiers that 404, so the guard checks
the output rather than the source —
`buildClient_RealRoot_EmitsEveryModuleAsBrowserReadyJavaScript` rejects any emitted
relative specifier not ending in `.js`, and now proves the rewrite ran rather than
proving somebody typed the extension correctly.

**C6.** `assert.equal` may not be used on a DOM node. It passes quietly, and on failure
tries to render a diff of two nodes — walking parents, children and the document until
the heap is gone, so the test reports as an out-of-memory kill with no message. That was
found here by writing an assertion that was simply wrong (`activeElement` with nothing
focused is `<body>`, not `null`), and the cost of learning it that way is a
twenty-five-second crash with no output at all. `src/client/fields.test.ts` compares
nodes through an `assertSame` helper built on `assert.ok` instead.
