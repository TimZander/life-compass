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
ancestors, restores stored answers into the ones still empty, and listens for `input`.
Node has no DOM, so none of that can be exercised by the suite as it stands.

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
supports the things the tests turn on — element creation and replacement, ancestor
traversal, `focus()` and `document.activeElement`, `selectionStart`/`selectionEnd`, and
event dispatch — which were verified before it was adopted rather than assumed. C4 records
where that verification was not enough.

## Decision

The build-time dependency count goes from two to three. Nothing in `dist/` gains a byte and
a reader's browser never sees it, but that is a smaller claim than "the count is unchanged"
and the honest one: 0003 · C1 was already counting build-time dependencies.

What makes it worth paying is that 0003 · C1's actual objection — how much of this
project's own code gets welded to a dependency — barely applies here. `happy-dom` appears
in one `import` in one test file. The trade is between a dependency that can be removed in
an afternoon and a fake that would have to be trusted with no way to check it, and this
project has spent four review rounds learning what an unverifiable check costs.

## Consequences

**C1.** 0003 · C1 counts two dependencies, TypeScript and a Markdown renderer, and says
plainly that both are build-time only. This makes it three. Calling the first two "runtime"
dependencies to keep the headline number flat would be bookkeeping rather than a fact: the
site ships zero dependencies before this and zero after, and the build-time count is what
actually grows. What separates `happy-dom` from the `@types/*` packages 0003 · C1 discounts
is that it is a real implementation rather than declarations — which is the cost worth
noticing, and the reason it earns a record.

**C2.** The DOM-touching client modules become testable. `answers.ts` and `store.ts` were
already unit-tested — the `Store` interface exists so their decisions could be tested in
Node without a DOM — but `banner.ts` and `sw-update.ts` were only ever verified by reading
their emitted output for expected substrings, which is why three device-testing rounds
found bugs the suite could not. Those two can now be exercised rather than pattern-matched;
neither is in this change.

**C3.** A DOM in tests is not a browser. It does not lay out, does not paint, and its
event loop is not a real one, so it cannot answer whether a textarea grows correctly or
whether a banner is legible. Device testing stays the check for anything visual — this
replaces none of it.

**C4.** The suite gains a way to be wrong that it did not have: a test can now pass
because `happy-dom` behaves differently from a browser rather than because the code is
right. This is not hypothetical and it did not take long. Assigning to a control's `value`
moves the caret to the end in every browser; `happy-dom` leaves it where it was. The first
version of the caret test — the one 0001 and #24 exist for — therefore passed against an
input handler that wrote back into the field on every save, which is the exact defect it
was written to forbid. The test now counts assignments to `value` instead of watching the
caret, because that does not depend on either behaviour. The lesson generalises: a DOM
test should assert on something the code did, not on a side effect the DOM is supposed to
produce.

**C5.** Client modules now import each other as `./keys.ts`, and the emit rewrites the
extension to `.js`. [0012](0012-client-typescript-stripped-at-build-time.md) had the
sources say `.js` so the specifier a browser resolves is the one the source contains. That
held while nothing under test imported a sibling — app.ts has always imported four of them,
but app.ts has no test, so Node was never asked to resolve one. `fields.ts` imports
`keys.ts` and is tested, and Node cannot resolve `./keys.js` from source, so the tier would
have been untestable exactly where it matters most. `rewriteRelativeImportExtensions` is the only rewrite: no
resolution, no bundling, nothing that knows how the site is served. Only
`build/client.ts` drives the emit — `tsconfig.client.json` is `noEmit`, so its copy of the
setting governs the typecheck and nothing else — and the guard is therefore on the emit:
`buildClient_RealRoot_EmitsEveryModuleAsBrowserReadyJavaScript` rejects any emitted
relative specifier not ending in `.js`, and now proves the rewrite ran rather than proving
somebody typed the extension correctly.

**C6.** `assert.equal` may not be used on a DOM node. It passes quietly, and on failure
tries to render a diff of two nodes — walking parents, children and the document until
the heap is gone, so the test reports as an out-of-memory kill with no message. That was
found here by writing an assertion that was simply wrong (`activeElement` with nothing
focused is `<body>`, not `null`), and the cost of learning it that way is a
twenty-five-second crash with no output at all. `src/client/fields.test.ts` compares
nodes through an `assertSame` helper built on `assert.ok` instead.
