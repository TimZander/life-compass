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

An envelope from the first release:

- `format` and `version` identify the file without inspecting its contents.
- `encryption: "none"` today; `"passphrase-aes-gcm"` later, with the payload replaced by
  ciphertext and its key-derivation parameters alongside.
- `payload` holds the answers, keyed by the question identifiers from
  [0004](0004-prose-in-markdown-questions-in-typescript.md).

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
workbook itself back for a feature most people would decline.
