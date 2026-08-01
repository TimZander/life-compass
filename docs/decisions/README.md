# Architecture decisions

Short records of the decisions that shape this project, written before the code they
govern exists. Each states what was decided, what else was considered, and what the
decision costs.

Records are numbered and immutable in intent: when a decision changes, a new record
supersedes the old one rather than editing history. Status starts at **Proposed** and
becomes **Accepted** in the pull request that implements it.

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
| [0004](0004-prose-in-markdown-questions-in-typescript.md) | Prose stays Markdown; question definitions become TypeScript | Proposed |
| [0005](0005-cloudflare-pages-for-header-control.md) | Cloudflare Pages, for control over response headers | Proposed |
| [0006](0006-no-in-app-speech-recognition.md) | No in-app speech recognition; scope the privacy claim honestly | Proposed |
| [0007](0007-clipboard-is-the-airgap.md) | The clipboard is the airgap | Proposed |
| [0008](0008-installation-makes-storage-durable.md) | Installation is what makes storage durable, and the app must say so | Proposed |
| [0009](0009-encryption-is-an-opt-in-add-on.md) | Encryption is an opt-in add-on; the export envelope is designed for it now | Proposed |
| [0010](0010-printing-is-a-supported-output.md) | Printing stays a supported output, not an accident | Proposed |

## Still open

**How question identifiers are versioned and migrated.** Raised as `0004 · C4`.
Stored answers key off question identifiers, so renaming one is a data migration
rather than a rename, and `0009`'s export envelope has to carry whatever scheme is
chosen. This needs settling before the first real answer is written, because
afterwards there is nothing to fix it with. Tracked as a record still to be written.
