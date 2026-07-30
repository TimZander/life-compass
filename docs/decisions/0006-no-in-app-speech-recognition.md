# 0006 — No in-app speech recognition; scope the privacy claim honestly

- **Status:** Proposed
- **Date:** 2026-07-29

## Context

[0001](0001-voice-first-input-is-a-primary-constraint.md) makes dictation a primary input
path, which suggests the obvious feature: a microphone button. Separately, the project
wants to tell people their writing stays on their device. These two intentions collide.

## Decision

No in-app speech recognition. Dictation happens through the operating system's own input
method, into ordinary text fields. And the privacy claim is scoped precisely to what the
application actually controls.

The obvious implementation, `webkitSpeechRecognition`, streams audio to a vendor's
servers on Chromium. Shipping that inside an app whose central claim is on-device privacy
would be self-defeating — and it would need exactly the network access the policy in
[0005](0005-cloudflare-pages-for-header-control.md) forbids.

The scoping matters just as much. On recent iOS and macOS, system dictation runs
on-device for supported languages. On Android that is not a safe assumption: whether
voice typing stays local depends on the keyboard app, the device, and whether offline
speech packs are installed — and a web page cannot detect which it is getting. So *"your
words never leave your device"* is not a claim this project can honestly make.

What it can claim, in three layers:

1. **The application transmits nothing.** No network requests after load, enforced by
   CSP, asserted by a test that fails CI if it weakens. This is a hard guarantee and it
   is ours to make.
2. **Your keyboard sits outside that boundary.** If you dictate, your input method may
   send audio to its vendor. Documented, with a pointer to enabling offline voice typing,
   and not overpromised.
3. **The agent bridge is a deliberate export**, made by you, each time. See
   [0007](0007-clipboard-is-the-airgap.md).

## Consequences

**C1.** There is no microphone in the interface. That will read as an omission, which is
precisely why the reasoning is recorded here rather than left implicit.

**C2.** Documentation has to explain a boundary rather than market the strong version of
the claim. Drawing the trust boundary at the application instead of at the device is less
impressive and more accurate.

**C3.** Dictation quality is whatever the user's keyboard provides, and it varies a lot.
The agent bridge is partly a response to this: it turns disfluent dictated speech into
structured answers.

**C4.** Clipboard history features — the keyboard's, the operating system's, cloud
clipboard sync — are a further egress worth naming in the threat model. In the
documentation, not in the interface.
