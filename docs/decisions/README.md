# Architecture decisions

Short records of the decisions that shape this project, written before the code they
govern exists. Each states what was decided, what else was considered, and what the
decision costs.

Records are numbered and immutable in intent: when a decision changes, a new record
supersedes the old one rather than editing history. Status starts at **Proposed** and
becomes **Accepted** in the pull request that implements it. Implementation is sometimes
staged: when a record's substance lands across more than one pull request, it stays
**Proposed** until the last of them, and the record itself says what remains unbuilt.
This clause was written down after the fact and regularises exactly two records that had
already shipped code while **Proposed** — [0006](0006-no-in-app-speech-recognition.md)
and [0011](0011-question-identifiers-are-frozen-and-registered.md) — plus
[0013](0013-instance-identity-for-rendered-slots.md), which documents its own split.

Options and consequences are labelled (`O1`, `C1`, …) so they can be cited precisely
from issues, pull requests, and other records — `0004 · C3` is the third consequence
of record 0004. A consequence added after a record is published gets a suffixed label
(`C1a`) rather than renumbering the ones after it, since renumbering would invalidate
every citation already written down.

| # | Decision | Status |
|---|---|---|
| [0001](0001-voice-first-input-is-a-primary-constraint.md) | Voice-first input is a primary design constraint | Proposed |
| [0002](0002-typescript-not-jsdoc-typed-javascript.md) | TypeScript, not JSDoc-typed JavaScript | Accepted |
| [0003](0003-multi-page-static-rendering-no-framework.md) | Multi-page static rendering, no framework, no bundler | Accepted |
| [0004](0004-prose-in-markdown-questions-in-typescript.md) | Prose stays Markdown; question definitions become TypeScript | Accepted |
| [0005](0005-cloudflare-pages-for-header-control.md) | Cloudflare Pages, for control over response headers | Accepted |
| [0006](0006-no-in-app-speech-recognition.md) | No in-app speech recognition; scope the privacy claim honestly | Proposed |
| [0007](0007-clipboard-is-the-airgap.md) | The clipboard is the airgap | Proposed |
| [0008](0008-installation-makes-storage-durable.md) | Installation is what makes storage durable, and the app must say so | Proposed |
| [0009](0009-encryption-is-an-opt-in-add-on.md) | Encryption is an opt-in add-on; the export envelope is designed for it now | Proposed |
| [0010](0010-printing-is-a-supported-output.md) | Printing stays a supported output, not an accident | Proposed |
| [0011](0011-question-identifiers-are-frozen-and-registered.md) | Question identifiers are frozen, registered, and never derived | Proposed |
| [0012](0012-client-typescript-stripped-at-build-time.md) | Client code becomes TypeScript, stripped at build time | Accepted |
| [0013](0013-instance-identity-for-rendered-slots.md) | Instance identity for slots the build renders | Accepted |
| [0014](0014-a-dom-for-tests-only.md) | A DOM for tests, and only for tests | Accepted |
| [0015](0015-assistant-output-is-self-describing-blocks.md) | Assistant output is self-describing blocks, one per question group | Proposed |

## Still open

[0013](0013-instance-identity-for-rendered-slots.md) raised six questions before repeat
answers could be stored. The binding answered two — write atomicity, settled by a
check-and-set operation on the store, and telling a corrupt instance order from an absent
one — and left four: `min` changing in either direction after a reader has materialised
instances, whether `0011`'s rename-on-read can reach a key with an instance spliced into
the middle, how an orphaned instance is surfaced — and with it a retired group's stored
order, which is JSON the orphan surface would otherwise present to the reader as their
own prose — and what the registry must record for a stored key to be readable back.

`0004 · C4` raised question-identifier versioning as the one decision deliberately left
unmade; [0011](0011-question-identifiers-are-frozen-and-registered.md) settles it.
