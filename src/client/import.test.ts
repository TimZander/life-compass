/**
 * Reading a backup back in — the only operation that can take a reader's answers away.
 *
 * Two properties carry everything here, and both are about refusal rather than success.
 * A file that is wrong must be refused BEFORE anything is written, because a partial
 * import leaves somebody with half of each and no way back to either. And a file that is
 * merely unfamiliar — a newer envelope, an encrypted one — must be refused with a reason
 * they can act on, not absorbed and half-understood.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";
import { envelopeOf, serialise, FORMAT, VERSION } from "./export.ts";
import {
  countAnswers,
  countStored,
  explain,
  readEnvelope,
  restore,
  wireRestore,
  type Refusal,
} from "./import.ts";
import { layout } from "../../build/layout.ts";
import { orderKey, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

/** A store that records whether it was written to, and how. */
function recorder(initial: ReadonlyMap<string, string> = new Map()) {
  const kept = new Map(initial);
  const replacements: number[] = [];
  const store: Store & { kept: Map<string, string>; replacements: number[] } = {
    kept,
    replacements,
    async readAll() {
      return new Map(kept);
    },
    async write(field, value) {
      kept.set(field, value);
    },
    async claim() {
      return true;
    },
    merge: async (entries: ReadonlyMap<string, string>) => {
      for (const [key, value] of entries) {
        kept.set(key, value);
      }
    },
    replaceAll: async (entries: ReadonlyMap<string, string>) => {
      replacements.push(entries.size);
      kept.clear();
      for (const [key, value] of entries) {
        kept.set(key, value);
      }
    },
  };
  return store;
}

const WHEN = new Date("2026-08-05T00:34:00.000Z");

/** A file exactly as `export.ts` writes one. */
async function fileHolding(entries: ReadonlyMap<string, string>): Promise<string> {
  const source: Store = {
    async readAll() {
      return entries;
    },
    async write() {},
    async claim() {
      return true;
    },
    async merge() {},
    async replaceAll() {},
  };
  return serialise(await envelopeOf(source, WHEN));
}

describe("what a file must be before it is trusted", () => {
  it("readEnvelope_AFileThisAppWrote_IsAccepted", async () => {
    // Arrange — the round trip that matters: what export produces is what import takes.
    // Both halves are asserted against fixtures elsewhere; only this pairs them.
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const answers = new Map([
      ["day1.patterns", "what recurs when I am not performing"],
      [orderKey("day1.chapters"), writeOrder([INSTANCE])],
      [`day1.chapters.${INSTANCE}.title`, "The garage-band years"],
    ]);

    // Act
    const reading = readEnvelope(await fileHolding(answers));

    // Assert
    assert.equal(reading.ok, true);
    assert.ok(reading.ok);
    assert.deepEqual(reading.envelope.payload, Object.fromEntries(answers));
    // Three keys, two answers: the instance order is an address, not something the reader
    // wrote (0013), and counting it would inflate the number shown before an irreversible
    // choice for every file with a repeat group in it.
    assert.equal(countAnswers(reading.envelope), 2);
  });

  it("readEnvelope_TextThatIsNotJson_IsRefusedAsSuch", () => {
    // Arrange — negative case. The likeliest wrong file is not a corrupted export, it is
    // some other file entirely out of a downloads folder, and the reader needs to be told
    // which of those happened.
    // Act & Assert
    const reading = readEnvelope("a shopping list, or a photo, or nothing at all");
    assert.equal(reading.ok, false);
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "not-json");
  });

  it("readEnvelope_JsonThatIsNotAnEnvelope_IsRefusedByShape", () => {
    // Arrange — negative case. Valid JSON is not the same as this application's file.
    // Act & Assert
    for (const text of ["[1,2,3]", '"a string"', "42", "null"]) {
      const reading = readEnvelope(text);
      assert.equal(reading.ok, false, text);
    }
  });

  it("readEnvelope_AnotherApplicationsFile_IsRefusedByFormat", () => {
    // Arrange — negative case. `format` exists so a file can be identified without
    // inspecting its contents (0009); this is that check doing its job.
    const OTHER = JSON.stringify({ format: "some-other-app/notes", version: 1, payload: {} });

    // Act
    const reading = readEnvelope(OTHER);

    // Assert
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "wrong-format");
  });

  it("readEnvelope_AFileFromANewerBuild_IsRefusedRatherThanGuessedAt", () => {
    // Arrange — negative case, and the one that has to be right before a second version
    // ever exists. A file this build cannot understand must not be half-read: the reader
    // would be told their answers were restored while some of them silently were not.
    const FUTURE = JSON.stringify({
      format: FORMAT,
      version: VERSION + 1,
      encryption: "none",
      payload: { "day1.patterns": "written by a later version" },
    });

    // Act
    const reading = readEnvelope(FUTURE);

    // Assert
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "newer-version");
  });

  it("readEnvelope_AnEncryptedFile_SaysSoRatherThanCallingItDamaged", () => {
    // Arrange — negative case. 0009 · C4: an importer must reject a file it cannot decrypt
    // with a clear message. "This file is encrypted and this version cannot open it" is a
    // different thing to tell somebody than "this file is damaged" — the first is a version
    // they need, the second sounds like their backup is gone.
    const SEALED = JSON.stringify({
      format: FORMAT,
      version: VERSION,
      encryption: "passphrase-aes-gcm",
      payload: "ciphertext",
    });

    // Act
    const reading = readEnvelope(SEALED);

    // Assert
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "encrypted");
  });

  it("readEnvelope_APayloadWithANonStringValue_IsRefusedWhole", () => {
    // Arrange — negative case, and refused ENTIRELY rather than per key. Letting the good
    // keys through would put the file's own damage into permanent storage, where `readAll`
    // then declines to read it back and the next export drops it silently.
    const MIXED = JSON.stringify({
      format: FORMAT,
      version: VERSION,
      encryption: "none",
      payload: { "day1.patterns": "fine", "day1.threads": { not: "a string" } },
    });

    // Act
    const reading = readEnvelope(MIXED);

    // Assert
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "bad-payload");
  });

  it("readEnvelope_AnEmptyValue_IsRefusedBecauseItCannotSurviveTheRestore", () => {
    // Arrange — negative case. `write` deletes rather than storing blankness and
    // `replaceAll` skips it, so this application never produces one; a file carrying it
    // would be counted to the reader and then not land. Worse for an instance order: the
    // order vanishes while its answers survive, and the next keystroke mints a fresh set
    // over the top, permanently orphaning them (0013 · Q3).
    const WITH_EMPTY = `{"format":"${FORMAT}","version":${VERSION},"encryption":"none","payload":{"a.b":"real","a.c":""}}`;

    // Act
    const reading = readEnvelope(WITH_EMPTY);

    // Assert
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "bad-payload");
  });

  it("readEnvelope_AFileWithNoEncryptionField_IsDamagedNotEncrypted", () => {
    // Arrange — negative case. Treating absence as encryption told the reader to go and
    // find a version that could open a file which was simply damaged — the one refusal
    // 0009 · C4 singles out for needing a clear message, firing for the wrong reason.
    const NO_FIELD = `{"format":"${FORMAT}","version":${VERSION},"payload":{}}`;

    // Act
    const reading = readEnvelope(NO_FIELD);

    // Assert
    assert.ok(!reading.ok);
    assert.equal(reading.refusal.kind, "not-an-envelope");
    assert.ok(!explain(reading.refusal).includes("encrypted"), "a damaged file was called encrypted");
  });

  it("readEnvelope_AVersionNoBuildEverWrote_IsRefused", () => {
    // Arrange — negative case. Refusing the future without refusing the impossible let
    // `version: 0` and negatives through to be imported as version 1.
    // Act & Assert
    for (const version of [0, -1]) {
      const reading = readEnvelope(
        `{"format":"${FORMAT}","version":${version},"encryption":"none","payload":{}}`,
      );
      assert.ok(!reading.ok, `version ${version} was accepted`);
    }
  });

  it("readEnvelope_APayloadThatIsNotAnObject_IsRefused", () => {
    // Arrange — negative case, and NOT covered by the encrypted case above, which is caught
    // a step earlier by `encryption`. A string payload with `encryption: "none"` reaches the
    // payload check, and `Object.keys` on a string yields indices whose values are all
    // strings — so without the shape check it would import as a store full of single
    // characters keyed "0", "1", "2".
    // Act & Assert
    for (const payload of ['"a string"', "42", "null", "[]"]) {
      const reading = readEnvelope(
        `{"format":"${FORMAT}","version":${VERSION},"encryption":"none","payload":${payload}}`,
      );
      assert.ok(!reading.ok, payload);
      assert.equal(reading.refusal.kind, "bad-payload", payload);
    }
  });

  it("readEnvelope_AKeyNamedLikeObjectMachinery_IsCarriedThroughIntact", async () => {
    // Arrange — the export side of this was a real defect: a key named `__proto__` was
    // swallowed by object assignment. The read side has to be checked too, or a file can be
    // written faithfully and imported short by one.
    const PRIVATE = "the answer under a key nobody expected";
    const text = await fileHolding(new Map([["__proto__", PRIVATE], ["day1.patterns", "ordinary"]]));

    // Act
    const reading = readEnvelope(text);

    // Assert
    assert.ok(reading.ok);
    assert.ok(
      Object.prototype.hasOwnProperty.call(reading.envelope.payload, "__proto__"),
      "__proto__ was lost on the way back in",
    );
    assert.equal(countAnswers(reading.envelope), 2);
  });
});

describe("putting it back", () => {
  it("restore_AValidFile_ReplacesEverythingInOneGo", async () => {
    // Arrange — replace, not merge (0009 · C7): what was here and is not in the file must
    // be gone, or the reader is left with a mixture nobody chose.
    const HERE = "an answer written on this device";
    const store = recorder(new Map([["day1.threads", HERE], ["day1.patterns", "also here"]]));
    const reading = readEnvelope(await fileHolding(new Map([["day1.patterns", "from the file"]])));
    assert.ok(reading.ok);

    // Act
    await restore(store, reading.envelope);

    // Assert
    assert.deepEqual([...store.kept], [["day1.patterns", "from the file"]]);
    assert.deepEqual(store.replacements, [1], "the store was written more than once");
  });

  it("restore_ARefusedFile_NeverReachesTheStore", async () => {
    // Arrange — negative case, and the property the whole module is arranged around. The
    // refusal happens in a function that has no store to write to, so this cannot regress
    // by someone reordering statements.
    const HERE = "everything the reader has written";
    const store = recorder(new Map([["day1.patterns", HERE]]));

    // Act — every refusal shape, none of which may touch storage.
    for (const text of ["not json", "[]", '{"format":"other"}', '{"format":"life-compass/answers","version":99}']) {
      const reading = readEnvelope(text);
      assert.ok(!reading.ok, text);
    }

    // Assert
    assert.deepEqual([...store.kept], [["day1.patterns", HERE]]);
    assert.deepEqual(store.replacements, []);
  });

  it("restore_AnEmptyFile_IsAllowedAndEmptiesTheStore", async () => {
    // Arrange — someone who exported before writing anything, then restored onto a device
    // they had been writing on. Unusual, destructive, and exactly what they asked for; the
    // confirmation gate is where that gets questioned, not here.
    const store = recorder(new Map([["day1.patterns", "will be discarded"]]));
    const reading = readEnvelope(await fileHolding(new Map()));
    assert.ok(reading.ok);

    // Act
    await restore(store, reading.envelope);

    // Assert
    assert.equal(store.kept.size, 0);
  });
});


let window: Window;

before(() => {
  window = new Window();
});

after(() => {
  void window.close();
});

/**
 * The restore control, lifted from the real build rather than hand-copied.
 *
 * The previous fixture was hand-written and its comment claimed it was "exactly as
 * layout() emits it", which was false — it omitted the label, the `accept` attribute and
 * the checkbox's wrapper. Nothing pinned `wireRestore`'s element contract to the markup, so
 * renaming an id shipped a control that only logged to the console, past a green suite.
 */
function realControl(): string {
  const html = layout("<p>prose</p>", "Backup", "backup");
  const match = /<section class="tools" id="restore"[\s\S]*?<\/section>/.exec(html);
  assert.ok(match !== null, "the build no longer emits a restore control");
  return match[0];
}

/** Long enough for the control's promise chains to settle. */
const SETTLE_MS = 20;

/** A page carrying the real control, plus helpers to drive it. */
function control() {
  window.document.body.innerHTML = realControl();
  const document = window.document as unknown as Document;
  const element = (id: string) =>
    window.document.getElementById(id) as unknown as HTMLInputElement & HTMLElement;
  return {
    document,
    element,
    text: (id: string) => element(id).textContent ?? "",
    hidden: (id: string) => (element(id) as unknown as { hidden: boolean }).hidden,
    locked: () => element("restore-go").getAttribute("aria-disabled") !== "false",
    async choose(text: string, name = "backup.json") {
      const input = element("restore-file");
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new window.File([text], name, { type: "application/json" })],
      });
      input.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    },
    tick() {
      const box = element("restore-ack");
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    },
    press(id: string) {
      element(id).dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    },
  };
}

/** An `Answers` recording that it was drained and stopped before the store changed. */
function answersSpy(log: string[] = []) {
  return {
    async load() {
      return new Map<string, string>();
    },
    set() {},
    async flush() {
      log.push("flushed");
    },
    stop() {
      log.push("stopped");
    },
  };
}

function options(log: string[]) {
  return {
    onRefused: (refusal: Refusal) => log.push(`refused:${refusal.kind}`),
    onRestored: (count: number) => log.push(`restored:${count}`),
    onFailure: () => log.push("failed"),
    onBackupFirst: () => log.push("backup-first"),
    reload: () => log.push("reloaded"),
  };
}

describe("choosing a file to restore from", () => {
  it("wireRestore_AValidFile_NamesItAndStatesBothNumbersTheRightWayRound", async () => {
    // Arrange — the two numbers a reader weighs before an irreversible choice, plus which
    // file they are weighing. An earlier version asserted only that each number appeared
    // somewhere in the sentence, so swapping them — telling the reader the backup holds
    // what they are about to lose — passed.
    const HERE = new Map([["day1.patterns", "one"], ["day1.threads", "two"]]);
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, answersSpy(), store, options([]));

    // Act
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])), "my-backup.json");

    // Assert — exact sentences, not substrings.
    assert.equal(page.hidden("restore-confirm"), false, "the confirmation never appeared");
    assert.equal(page.text("restore-chosen"), "From my-backup.json");
    assert.equal(
      page.text("restore-summary"),
      `It holds 1 answer, saved ${WHEN.toLocaleDateString()}. Replacing will discard the 2 answers on this device.`,
    );
    assert.deepEqual([...store.kept], [...HERE], "the store was touched before confirmation");
  });

  it("wireRestore_AFileHoldingInstanceOrders_CountsOnlyTheAnswers", async () => {
    // Arrange — an instance order is an address, not an answer (0013), and 334 of the 447
    // blanks sit inside repeats. Counting every key inflated the number for every real file.
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const page = control();
    wireRestore(page.document, answersSpy(), recorder(), options([]));

    // Act
    await page.choose(
      await fileHolding(
        new Map([
          [orderKey("day1.chapters"), writeOrder([INSTANCE])],
          [`day1.chapters.${INSTANCE}.title`, "The garage-band years"],
        ]),
      ),
    );

    // Assert — two keys, one answer.
    assert.ok(
      page.text("restore-summary").startsWith("It holds 1 answer,"),
      `counted the order as an answer: ${page.text("restore-summary")}`,
    );
  });

  it("wireRestore_AFileJustExportedFromThisDevice_ShowsTheSameNumberTwice", async () => {
    // Arrange — reported from a device: download a backup, offer it straight back, and the
    // two numbers disagreed. They were counted differently — the file's excluded instance
    // orders and the device's was the raw key count — so an untouched round trip read "It
    // holds 1 answer. Replacing will discard the 2 answers on this device." Two counts of
    // one store, contradicting each other, in the sentence somebody weighs before an
    // irreversible choice.
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const HERE = new Map([
      ["day1.patterns", "what recurs"],
      [orderKey("day1.chapters"), writeOrder([INSTANCE])],
      [`day1.chapters.${INSTANCE}.title`, "The garage-band years"],
    ]);
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, answersSpy(), store, options([]));

    // Act — the file this very store would export, offered straight back to it.
    await page.choose(await fileHolding(HERE));

    // Assert — three keys, two answers, and the same figure on both sides.
    assert.equal(countStored(HERE), 2, "the device count is not counting answers");
    assert.ok(
      page.text("restore-summary").startsWith("It holds 2 answers,"),
      page.text("restore-summary"),
    );
    assert.ok(
      page.text("restore-summary").endsWith("Replacing will discard the 2 answers on this device."),
      page.text("restore-summary"),
    );
  });

  it("wireRestore_ARefusedFile_SaysWhyAndNeverOffersToReplace", async () => {
    // Arrange — negative case, and the most important one: a wrong file must not reach the
    // confirmation, or the reader is one tick and one tap from replacing everything with
    // nothing.
    const HERE = new Map([["day1.patterns", "everything the reader has written"]]);
    const log: string[] = [];
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, answersSpy(), store, options(log));

    // Act
    await page.choose("a shopping list, or a photo, or nothing at all");

    // Assert
    assert.deepEqual(log, ["refused:not-json"]);
    assert.equal(page.hidden("restore-confirm"), true, "a refused file offered a replace");
    assert.deepEqual([...store.kept], [...HERE]);
  });

  it("wireRestore_ASecondFileChosen_ForgetsTheFirstCompletely", async () => {
    // Arrange — negative case, verified as a real defect. Leaving the previous file's
    // confirmation standing while the next one is read let a reader press Replace and get
    // the file they had visibly rejected, with a tick made for a different file.
    const page = control();
    const store = recorder(new Map([["day1.threads", "here"]]));
    const log: string[] = [];
    wireRestore(page.document, answersSpy(), store, options(log));
    await page.choose(await fileHolding(new Map([["day1.patterns", "FIRST FILE"]])), "first.json");
    page.tick();

    // Act — change of mind.
    await page.choose(await fileHolding(new Map([["day1.patterns", "SECOND FILE"]])), "second.json");
    page.tick();
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert — the second file, and only because it was ticked again.
    assert.equal(page.text("restore-chosen"), "From second.json");
    assert.deepEqual([...store.kept], [["day1.patterns", "SECOND FILE"]]);
  });

  it("wireRestore_ASlowFirstReadLandingLate_CannotOverwriteTheSecondChoice", async () => {
    // Arrange — negative case, and the reason for a generation counter rather than just
    // resetting up front. Two reads can be in flight at once; without it the slower one
    // lands last and installs its envelope behind the confirmation the reader is looking
    // at, which describes the other file.
    const page = control();
    const store = recorder();
    wireRestore(page.document, answersSpy(), store, options([]));
    const input = page.element("restore-file");
    const slow = new window.File(
      [await fileHolding(new Map([["a.b", "THE SLOW FIRST FILE"]]))],
      "slow.json",
      { type: "application/json" },
    );
    const text = slow.text.bind(slow);
    slow.text = () => new Promise((resolve) => setTimeout(() => void text().then(resolve), SETTLE_MS * 3));
    Object.defineProperty(input, "files", { configurable: true, value: [slow] });
    input.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);

    // Act — a second choice while the first is still reading, then wait past both.
    await page.choose(await fileHolding(new Map([["a.b", "THE SECOND FILE"]])), "second.json");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 4));
    page.tick();
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert — the slow file never becomes what is applied, nor what is described.
    assert.equal(page.text("restore-chosen"), "From second.json");
    assert.deepEqual([...store.kept], [["a.b", "THE SECOND FILE"]]);
  });

  it("wireRestore_ANewFileChosen_ClearsTheTickMadeForTheLastOne", async () => {
    // Arrange — negative case. 0009 · C8 puts the gate with the reader; a tick that
    // survives the thing it was ticked about is not one.
    const page = control();
    wireRestore(page.document, answersSpy(), recorder(), options([]));
    await page.choose(await fileHolding(new Map([["a.b", "first"]])));
    page.tick();

    // Act
    await page.choose(await fileHolding(new Map([["a.b", "second"]])));

    // Assert
    assert.equal(page.element("restore-ack").checked, false, "consent carried to another file");
    assert.equal(page.locked(), true, "the replace button stayed live across a file change");
  });
});

describe("the confirmation gate", () => {
  it("wireRestore_ReplacePressedWithoutTicking_DoesNothing", async () => {
    // Arrange — negative case. If the button worked without the tick the gate would be
    // decoration, and `aria-disabled` does not block a click the way `disabled` would.
    const HERE = new Map([["day1.patterns", "everything the reader has written"]]);
    const log: string[] = [];
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, answersSpy(), store, options(log));
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Act
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(log, []);
    assert.deepEqual([...store.kept], [...HERE], "replaced with no acknowledgement");
  });

  it("wireRestore_TickedThenUnticked_LocksTheButtonAgain", async () => {
    // Arrange — negative case. A reader who reconsiders must not leave a live button.
    const page = control();
    wireRestore(page.document, answersSpy(), recorder(), options([]));
    await page.choose(await fileHolding(new Map([["a.b", "x"]])));

    // Act
    page.tick();
    const unlocked = !page.locked();
    const box = page.element("restore-ack");
    box.checked = false;
    box.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);

    // Assert
    assert.equal(unlocked, true, "ticking did not release the button");
    assert.equal(page.locked(), true, "unticking did not lock it again");
  });

  it("wireRestore_TickedAndConfirmed_DrainsAutosaveThenReplacesThenReloads", async () => {
    // Arrange — order matters and all three steps do. `reload()` fires `pagehide`, which
    // app.ts flushes on, so without draining first a phrase dictated moments before Replace
    // was written on TOP of the restored store — the merge 0009 · C7 forbids, produced by
    // the operation chosen because it cannot do that.
    const order: string[] = [];
    const page = control();
    const store = recorder(new Map([["day1.threads", "will be discarded"]]));
    wireRestore(page.document, answersSpy(order), store, options(order));
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Act
    page.tick();
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(order, ["flushed", "stopped", "restored:1", "reloaded"]);
    assert.deepEqual([...store.kept], [["day1.patterns", "from the file"]]);
    assert.deepEqual(store.replacements, [1], "the store was written more than once");
  });

  it("wireRestore_PressedTwice_ReplacesOnce", async () => {
    // Arrange — negative case. A second press must not re-apply the file.
    const order: string[] = [];
    const page = control();
    const store = recorder();
    wireRestore(page.document, answersSpy(order), store, options(order));
    await page.choose(await fileHolding(new Map([["a.b", "x"]])));
    page.tick();

    // Act
    page.press("restore-go");
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(store.replacements, [1]);
  });

  it("wireRestore_Cancelled_LeavesEverythingAloneAndForgetsTheFile", async () => {
    // Arrange — negative case. Cancelling must not leave a loaded file one stray tap from
    // being applied.
    const HERE = new Map([["day1.patterns", "everything the reader has written"]]);
    const log: string[] = [];
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, answersSpy(), store, options(log));
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Act
    page.press("restore-cancel");
    page.tick();
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(log, []);
    assert.deepEqual([...store.kept], [...HERE]);
    assert.equal(page.hidden("restore-confirm"), true);
  });

  it("wireRestore_TheOfferToBackUpFirst_IsPresentAndWorks", async () => {
    // Arrange — 0009 · C8 requires BOTH halves: offer the export and require the
    // confirmation. Only the second was built; a reader was left to notice a button
    // elsewhere on the page at the moment they most needed it.
    const log: string[] = [];
    const page = control();
    wireRestore(page.document, answersSpy(), recorder(), options(log));
    await page.choose(await fileHolding(new Map([["a.b", "x"]])));

    // Act
    page.press("restore-backup-first");

    // Assert
    assert.deepEqual(log, ["backup-first"]);
  });
});

describe("when things go wrong at the control", () => {
  it("wireRestore_TheStoreFailsToBeRead_ReportsItAndOffersNothing", async () => {
    // Arrange — negative case. `readAll` runs before the confirmation; a failure there must
    // not leave a half-built confirmation on screen.
    const log: string[] = [];
    const page = control();
    const broken: Store = {
      async readAll() {
        throw new Error("storage is unavailable");
      },
      async write() {},
      async claim() {
        return true;
      },
      async merge() {},
      async replaceAll() {},
    };
    wireRestore(page.document, answersSpy(), broken, options(log));

    // Act
    await page.choose(await fileHolding(new Map([["a.b", "x"]])));

    // Assert
    assert.deepEqual(log, ["failed"]);
    assert.equal(page.hidden("restore-confirm"), true);
  });

  it("wireRestore_TheReplaceFails_SaysSoAndDoesNotReload", async () => {
    // Arrange — negative case. Reloading after a failure would destroy the banner that
    // explains it, and the reader would be left with no idea what happened.
    const log: string[] = [];
    const page = control();
    const store = recorder();
    store.replaceAll = async () => {
      throw new Error("the transaction aborted");
    };
    wireRestore(page.document, answersSpy(log), store, options(log));
    await page.choose(await fileHolding(new Map([["a.b", "x"]])));

    // Act
    page.tick();
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(log, ["flushed", "stopped", "failed"]);
    assert.ok(!log.includes("reloaded"), "a failed restore reloaded the page");
  });

  it("wireRestore_AnnouncingThrows_StillReloadsRatherThanReportingFailure", async () => {
    // Arrange — negative case, and the worst false statement this code could make.
    // `onRestored` writes sessionStorage, which throws where site data is blocked. When it
    // sat inside the chain that reports failure, the reader was told "nothing on this
    // device has changed" AFTER everything had been replaced, and the page did not reload —
    // so the screen kept showing the old answers and corroborated the lie.
    const log: string[] = [];
    const page = control();
    const store = recorder();
    const failing = { ...options(log), onRestored: () => {
      throw new Error("SecurityError: site data is blocked");
    } };
    wireRestore(page.document, answersSpy(), store, failing);
    await page.choose(await fileHolding(new Map([["a.b", "x"]])));
    const noise: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => noise.push(args);

    // Act
    try {
      page.tick();
      page.press("restore-go");
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    } finally {
      console.error = original;
    }

    // Assert — the replace stands, the reload happens, and nothing claims failure.
    assert.ok(!log.includes("failed"), "a successful restore was reported as a failure");
    assert.ok(log.includes("reloaded"), "the page did not reload, so the screen would lie");
    assert.deepEqual([...store.kept], [["a.b", "x"]]);
    assert.equal(noise.length, 1, "the announcement failure was swallowed");
  });

  it("wireRestore_APageWithoutTheControl_SaysSoRatherThanReturningQuietly", () => {
    // Arrange — negative case. The build emits the control on the page that reaches this
    // code, so absent means markup and module have drifted.
    window.document.body.innerHTML = "<p>no control here</p>";
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    // Act
    try {
      wireRestore(
        window.document as unknown as Document,
        answersSpy(),
        recorder(),
        options([]),
      );
    } finally {
      console.error = original;
    }

    // Assert
    assert.equal(logged.length, 1, "a missing control was absorbed silently");
  });
});

describe("what a refusal tells the reader", () => {
  it("explain_EveryRefusalReadEnvelopeCanProduce_IsDistinctAndReassuring", async () => {
    // Arrange — built from what `readEnvelope` ACTUALLY returns, not from hand-written
    // literals. The old test invented its own refusals, so it could not notice a new kind
    // with no message, and could not notice two kinds sharing one.
    const good = await fileHolding(new Map([["a.b", "x"]]));
    const files = [
      "not json at all",
      "[1,2,3]",
      `{"format":"other/app","version":1,"encryption":"none","payload":{}}`,
      `{"format":"${FORMAT}","version":${VERSION + 1},"encryption":"none","payload":{}}`,
      `{"format":"${FORMAT}","version":${VERSION},"encryption":"passphrase-aes-gcm","payload":{}}`,
      `{"format":"${FORMAT}","version":${VERSION},"encryption":"none","payload":{"a":1}}`,
      `{"format":"${FORMAT}","version":${VERSION},"encryption":"none","payload":{"g":"[\\"aa\\",\\"aa\\"]"}}`,
    ];

    // Act
    const said = new Map<string, string>();
    for (const text of files) {
      const reading = readEnvelope(text);
      assert.ok(!reading.ok, text);
      said.set(reading.refusal.kind, explain(reading.refusal));
    }

    // Assert — every kind reachable from a file has its own message, and every message
    // tells a reader who may hold their only copy that this device is intact.
    assert.ok(said.size >= 6, `only ${said.size} distinct refusals were reachable`);
    assert.equal(new Set(said.values()).size, said.size, "two refusals share one message");
    for (const [kind, message] of said) {
      assert.ok(message.length > 0, kind);
      assert.ok(
        message.includes("Nothing on this device has changed"),
        `${kind} does not reassure the reader: ${message}`,
      );
    }
    assert.ok(readEnvelope(good).ok, "a good file was refused");
  });
});
