# 0008 — Installation is what makes storage durable, and the app must say so

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

Browser storage is reclaimable. This workbook holds writing that exists nowhere else,
which makes silent eviction the worst failure available to the project — worse than a
crash or a bad deploy, because it is unrecoverable and the user finds out weeks later.

Durability is not something the app can simply assert. `navigator.storage.persist()`
requests exemption from eviction, and browsers grant it on their own criteria —
installation being the main lever a user actually controls. Safari additionally purges
storage for origins left unused for seven days. Chrome does not do that, but will evict
under pressure.

## Decision

Treat installation as the mechanism that makes storage durable. Prompt for it assertively
once the user starts writing, and state plainly what installing does and does not do.

Rather than warning everyone unconditionally, query the real state —
`navigator.storage.persisted()` reports whether this origin is already exempt. Prompt
when the answer is no *and* the user has begun entering answers; stay quiet when it is
yes. An app that warns about a risk the browser has already removed teaches people to
ignore its warnings, which is an expensive habit to instil in an app whose entire
proposition is trustworthiness.

The prompt carries three things, and all three are obligations rather than suggestions:

1. If this is not installed, the browser may discard your answers.
2. Installing is what makes them durable.
3. Installing grants no permissions, needs no account, and can be undone.

## Consequences

**C1.** The prompt must never interrupt an input session. Inline banner, not modal — a
dialog appearing mid-dictation is precisely the failure
[0001](0001-voice-first-input-is-a-primary-constraint.md) forbids. Trigger it on first
focus or first save, and let it persist until acted on rather than firing repeatedly.

**C2.** Someone who arrives only to read is never nagged. The prompt is earned by
starting to write.

**C3.** Uninstalling can delete the stored answers. On Android, removing an installed web
app may clear its site data — so installation protects against eviction while making
uninstall a destructive act. This is what makes export non-optional: it is the only
backup that survives both eviction and uninstall, and the app should push it rather than
bury it in a settings menu.

**C4.** Two install paths. Chromium exposes `beforeinstallprompt` and can offer a real
button; Safari has no such API and needs written instructions. The wording differs, the
message does not.

**C5.** The app shows storage state honestly somewhere durable: installed or not,
persisted or not, when you last exported. One quiet line, not a dashboard.

**C6.** "No security implications" is a claim about permissions, and in that form it is
true — installation grants nothing the page did not already have. It should be stated
that precisely rather than as general reassurance, because the *data* implication in C3
is real and the two must not be conflated.
