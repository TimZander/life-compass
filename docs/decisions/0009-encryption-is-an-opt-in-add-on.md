# 0009 — Encryption is an opt-in add-on; the export envelope is designed for it now

- **Status:** Accepted
- **Date:** 2026-07-29 *(envelope frozen and shipped 2026-08-04)*

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

An envelope from the first release, in full. Five fields, and this list is authoritative
now that files exist:

- `format` and `version` identify the file without inspecting its contents. `version` is
  the ENVELOPE's and moves only when this shape changes; a schema edit, a new worksheet or
  a retired question are ordinary payload contents and do not touch it.
- `encryption: "none"` today; `"passphrase-aes-gcm"` later, with the payload replaced by
  ciphertext and its key-derivation parameters alongside.
- `exportedAt`, an ISO timestamp, so a reader holding several files can tell which is
  newest without opening them.
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

**C6.** *Added 2026-08-04.* A `schema` field — a digest of the identifier set the file was
written against — was built, reviewed and removed again before it shipped. It was justified
as the only way an importer could tell an orphan (a question since retired) from a key for a
question that did not exist yet. That justification was wrong twice over. A digest of a
*set* cannot answer a question about an individual key; it can only say the sets match or
differ. And the [0011](0011-question-identifiers-are-frozen-and-registered.md) registry
already answers it per key and permanently, because 0011 · C2 keeps every identifier ever
used with its status: registered-and-retired is an orphan, absent was never ours.

Removing it also corrects the argument used to add it. "Add it now, because adding it later
costs a shim" is exactly backwards for an OPTIONAL field: an envelope carrying `version` is
what makes a later addition cheap, since an old importer ignores what it does not know and
a new one treats absence as "not recorded". The shim this record warns about is the cost of
having no envelope, or of changing what an existing field means — not of growing one.
[0013](0013-instance-identity-for-rendered-slots.md) had already recorded the general form
of this mistake, and a decoder was deleted one pull request earlier for the same reason:
format machinery with no consumer gets frozen before anything has tested what it is for.

**C7.** *Added 2026-08-04.* Import REPLACES the store rather than merging into it. The
first version of this consequence argued that merging is "undefined" because a per-key merge
could leave a group referencing instances whose answers are absent — which is wrong, since
that is exactly what materialising a fresh group produces and the page renders it as empty
blanks. The real hazard is the mirror image: answers under instance identifiers that the
winning order does not list, which are unreachable from the page while still occupying their
keys. Merge would manufacture those silently and per-key, with no moment at which anybody
decided to accept them. Replace is chosen because it has one obvious meaning the reader can
be told in a sentence, not because merge is impossible.

**C8.** *Added 2026-08-04.* Because replace is destructive and this feature exists to
prevent exactly that, an import must not begin until a backup of what it will discard is
known to exist, and must say how much it is discarding.

An earlier version of this consequence said the import could simply call the export first
and that this "costs a function call". It cannot, and the same pull request said so
elsewhere: handing a file over is a synthetic click on an object URL, which reports no
outcome at all — the export cannot tell whether a byte was written, which is why the app
says "Downloading" rather than "Saved". An import built on that would destroy the store
believing a backup had landed.

So the gate is the reader's, not the code's: offer the export, and require them to confirm
they have the file before the replace runs. If a mechanism that can confirm a write ever
becomes available everywhere this ships — the File System Access API resolves only once
bytes are on disk — the confirmation can become automatic. Until then a person looking at
their own downloads folder is the only thing that actually knows.
