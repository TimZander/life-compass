# 0009 — Encryption is an opt-in add-on; the export envelope is designed for it now

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

Exports are the backup path that
[0008 · C3](0008-installation-makes-storage-durable.md) makes mandatory, and this content
is unusually personal. A plaintext file sitting in a cloud drive is worth thinking about.

But passphrase encryption in an application with no server has an unforgiving failure
mode: a forgotten passphrase is unrecoverable by construction, because there is nobody to
reset it. For most people the likelihood of losing a passphrase exceeds the likelihood of
the threat it defends against.

## Decision

Encryption is out of scope for the initial build and ships later as an opt-in feature. The
export format is designed now so that adding it does not create two incompatible
generations of export file.

An envelope from the first release, in full — five fields, and this list is the
authoritative one now that files exist:

- `format` and `version` identify the file without inspecting its contents. `version` is
  the ENVELOPE's and moves only when this shape changes; a schema edit, a new worksheet or
  a retired question are ordinary payload contents and do not touch it.
- `encryption: "none"` today; `"passphrase-aes-gcm"` later, with the payload replaced by
  ciphertext and its key-derivation parameters alongside.
- `exportedAt`, an ISO timestamp, so a reader holding several files can tell which is
  newest without opening them.
- `schema`, a short digest of the identifier set the file was written against. See C6 for
  why a file is close to uninterpretable without it.
- `payload` holds the answers, keyed by the question identifiers from
  [0004](0004-prose-in-markdown-questions-in-typescript.md) — every key in the store
  verbatim, including instance orders (whose values are JSON) and orphans, which
  [0011 · C3](0011-question-identifiers-are-frozen-and-registered.md) requires.

The importer then branches on a single field. This costs nothing today. Retrofitting an
envelope after files exist in the wild costs a compatibility shim that never goes away.

## Consequences

**C1.** Until encryption ships, the documentation says plainly that exports are plaintext
and that where you keep the file matters. Accurate, not alarming.

**C2.** Encryption stays entirely local. WebCrypto needs no network, so it never disturbs
`connect-src 'none'` or the claims in
[0005](0005-cloudflare-pages-for-header-control.md) through
[0007](0007-clipboard-is-the-airgap.md).

**C3.** When it ships it is opt-in per export, never a global default, and the passphrase
prompt states that loss is unrecoverable *before* the file is written rather than after.

**C4.** The importer must reject a file it cannot decrypt with a clear message, and must
never partially import.

**C5.** Deferring this means the most sensitive artifact the app produces is unprotected
at rest for the early releases. A conscious trade: the alternative was holding the
workbook itself back for a feature most people would decline. Note that shipping an export
control makes that exposure much easier to reach than it was when this was written — the
wording C1 asks for carries more weight now, not less.

**C6.** `schema` exists because `version` deliberately does not move for a schema edit, so
without it nothing in the file records which questions existed when it was written. An
importer reading a file some years later could not then tell an orphan — a question since
retired, which 0011 · C3 says the envelope carries precisely so the distinction survives —
from a key for a question that did not exist yet. It is a digest rather than the
identifiers themselves because the client has no copy of the schema: `connect-src 'none'`
stops it fetching `questions.json`, and 0013 has the binding read everything from the
markup, so the build stamps the digest into every page and an export reads it from there.
It is derived from the sorted identifiers and nothing else — not the date, not the commit —
because the build's bytes feed the service worker's cache version, and anything varying
per build would ask every reader to accept an update on every deploy for nothing.

**C7.** Import REPLACES the store rather than merging into it. Merging is not merely less
convenient, it is undefined for this data: instance orders and the answers they address
are coupled (0013), so a per-key merge can take an order from one file and answers from
another and produce a group referencing instances whose answers are absent — a corrupt
state neither file contained. Replace cannot do that.

**C8.** Because replace is destructive and this feature exists to prevent exactly that,
an import writes a backup of what is about to be discarded BEFORE it replaces anything,
and says how much it is discarding. A warning alone still leaves the reader one tap from
an irreversible mistake with no server copy to fall back on; the export machinery already
exists, so making the operation recoverable costs a function call.
