/**
 * The backup file, which is the only copy that survives eviction or uninstall.
 *
 * The tests that matter here are about what must NOT be dropped. An export that quietly
 * omits a key produces a file that looks complete, restores wrong, and is discovered to
 * have been wrong only once the original is gone — which is the whole scenario this
 * feature exists for.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { envelopeOf, filenameFor, serialise, FORMAT, VERSION } from "./export.ts";
import { orderKey, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

/** A store holding exactly what it is given. */
function stored(entries: ReadonlyMap<string, string>): Store {
  return {
    async readAll() {
      return entries;
    },
    async write() {
      throw new Error("an export must not write");
    },
    async claim() {
      throw new Error("an export must not write");
    },
  };
}

const WHEN = new Date("2026-08-04T14:12:37.000Z");
/** Whatever the build stamped into the page; export only carries it through. */
const SCHEMA = "6bfcb1e41632";

describe("what the envelope carries", () => {
  it("envelopeOf_EveryKindOfStoredKey_IsCarriedVerbatim", async () => {
    // Arrange — the three kinds that exist, one of which is not prose. An instance order
    // (0013) holds JSON and is an answer's address, so a backup without it restores text
    // that nothing can place; an orphan belongs in the envelope by 0011 · C3, because a
    // retired question is not a deleted answer and this file is the only place that
    // distinction survives.
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const ANSWER = "what recurs when I am not performing";
    const ORDER = writeOrder([INSTANCE]);
    const ORPHAN = "written under a question that has since been retired";
    const store = stored(
      new Map([
        ["day1.patterns", ANSWER],
        [orderKey("day1.chapters"), ORDER],
        [`day1.chapters.${INSTANCE}.title`, "The garage-band years"],
        ["day9.retired", ORPHAN],
      ]),
    );

    // Act
    const envelope = await envelopeOf(store, WHEN, SCHEMA);

    // Assert
    assert.deepEqual(envelope.payload, {
      "day1.patterns": ANSWER,
      "day1.chapters": ORDER,
      [`day1.chapters.${INSTANCE}.title`]: "The garage-band years",
      "day9.retired": ORPHAN,
    });
  });

  it("envelopeOf_TheEnvelopeItself_IsTheShape0009Froze", async () => {
    // Arrange — the fields an importer branches on before reading a byte of the payload.
    // This shape is permanent once a file exists in the wild.
    const store = stored(new Map([["day1.patterns", "an answer"]]));

    // Act
    const envelope = await envelopeOf(store, WHEN, SCHEMA);

    // Assert
    assert.equal(envelope.format, FORMAT);
    assert.equal(envelope.version, VERSION);
    assert.equal(envelope.encryption, "none");
    assert.equal(envelope.exportedAt, "2026-08-04T14:12:37.000Z");
    assert.equal(envelope.schema, SCHEMA);
    assert.deepEqual(Object.keys(envelope).sort(), [
      "encryption",
      "exportedAt",
      "format",
      "payload",
      "schema",
      "version",
    ]);
  });

  it("envelopeOf_AnEmptyStore_IsStillAValidEnvelope", async () => {
    // Arrange & Act — negative case. Someone who has written nothing and exports anyway
    // gets a file that imports cleanly, rather than one an importer rejects as malformed.
    const envelope = await envelopeOf(stored(new Map()), WHEN, SCHEMA);

    // Assert
    assert.deepEqual(envelope.payload, {});
    assert.equal(envelope.format, FORMAT);
  });

  it("envelopeOf_TheSameAnswersTwice_ProducesTheSameBytes", async () => {
    // Arrange — key order carries no meaning, which is the reason to fix it: successive
    // backups of unchanged answers then differ only where the answers differ, so a reader
    // can diff two files and see their own edits rather than a reshuffle.
    const entries: [string, string][] = [
      ["day2.values", "second"],
      ["anchor.theme", "first"],
      ["day1.patterns", "third"],
    ];
    const forwards = stored(new Map(entries));
    const backwards = stored(new Map([...entries].reverse()));

    // Act
    const one = serialise(await envelopeOf(forwards, WHEN, SCHEMA));
    const two = serialise(await envelopeOf(backwards, WHEN, SCHEMA));

    // Assert
    assert.equal(one, two);
    assert.deepEqual(Object.keys(JSON.parse(one).payload), [
      "anchor.theme",
      "day1.patterns",
      "day2.values",
    ]);
  });
});

describe("the file itself", () => {
  it("serialise_AnEnvelope_IsIndentedJsonEndingInANewline", async () => {
    // Arrange — a file the reader is told to look after themselves (0009 · C1), so it is
    // written to be opened and read rather than treated as opaque machine output.
    const envelope = await envelopeOf(stored(new Map([["day1.patterns", "an answer"]])), WHEN, SCHEMA);

    // Act
    const text = serialise(envelope);

    // Assert
    assert.ok(text.includes('\n  "format"'), "the file is not indented");
    assert.ok(text.endsWith("}\n"), "the file does not end in a newline");
    assert.deepEqual(JSON.parse(text), envelope);
  });

  it("serialise_AnAnswerContainingJsonPunctuation_SurvivesTheRoundTrip", async () => {
    // Arrange — negative case. These are dictated paragraphs: quotation marks, backslashes
    // and newlines are ordinary content, not edge cases, and a file that mangles them
    // loses the reader's words silently.
    const AWKWARD = 'She said "no" — then\\nwrote:\n\t{"not": "json"} and an emoji 🌱';
    const store = stored(new Map([["day1.patterns", AWKWARD]]));

    // Act
    const text = serialise(await envelopeOf(store, WHEN, SCHEMA));

    // Assert
    assert.equal(JSON.parse(text).payload["day1.patterns"], AWKWARD);
  });

  it("filenameFor_ADate_SortsChronologicallyAndSaysWhatItIs", async () => {
    // Arrange & Act & Assert
    assert.equal(filenameFor(WHEN), "life-compass-2026-08-04-14-12.json");
    assert.equal(
      filenameFor(new Date("2026-01-09T03:07:59.000Z")),
      "life-compass-2026-01-09-03-07.json",
    );
  });

  it("filenameFor_TwoExportsInOneDay_DoNotShareAName", async () => {
    // Arrange — negative case, and a correction. An earlier version used the date alone,
    // reasoning that a same-day overwrite was safe because "the newer file is a superset
    // of unchanged answers". It is not: a reader who cleared an answer between the two
    // has a newer file that is strictly lossier, and the overwrite would destroy the only
    // copy of what they removed — in the feature whose whole job is to prevent that.
    const MORNING = new Date("2026-08-04T09:15:00.000Z");
    const EVENING = new Date("2026-08-04T21:40:00.000Z");

    // Act & Assert
    assert.notEqual(filenameFor(MORNING), filenameFor(EVENING));
  });

  it("filenameFor_AnyMoment_IsLegalOnEveryPlatform", async () => {
    // Arrange & Act & Assert — negative case. A colon is not a legal filename character
    // everywhere, and an ISO timestamp is full of them.
    const name = filenameFor(WHEN);
    assert.ok(!/[:*?"<>|\\/]/.test(name), `${name} contains a character some platforms refuse`);
    assert.ok(name.endsWith(".json"));
  });
});
