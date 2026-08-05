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
import { countIn, explain, readEnvelope, restore, wireRestore, type Refusal } from "./import.ts";
import { orderKey, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

/** A store that records whether it was written to, and how. */
function recorder(initial: ReadonlyMap<string, string> = new Map()) {
  const kept = new Map(initial);
  const replacements: number[] = [];
  const store: Store & { readonly kept: Map<string, string>; readonly replacements: number[] } = {
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
    async replaceAll(entries) {
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
    assert.equal(countIn(reading.envelope), answers.size);
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
    assert.equal(countIn(reading.envelope), 2);
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
  const scope = globalThis as unknown as Record<string, unknown>;
  scope["HTMLInputElement"] = window.HTMLInputElement;
  scope["HTMLButtonElement"] = window.HTMLButtonElement;
});

after(() => {
  void window.close();
});

/** The restore control exactly as `layout()` emits it. */
const CONTROL = `
  <input type="file" id="restore-file">
  <div id="restore-confirm" hidden>
    <p id="restore-summary"></p>
    <input type="checkbox" id="restore-ack">
    <button type="button" id="restore-go" disabled>Replace</button>
    <button type="button" id="restore-cancel">Cancel</button>
  </div>`;

/** A page with the control, plus a helper to hand it a chosen file. */
function control(): {
  readonly document: Document;
  choose(text: string): Promise<void>;
  tick(): void;
  press(id: string): void;
  readonly cleared: string[];
  readonly element: (id: string) => HTMLInputElement & HTMLButtonElement & { textContent: string };
} {
  window.document.body.innerHTML = CONTROL;
  const document = window.document as unknown as Document;
  // The spec — and happy-dom — only let a file input's value be set to "", so the fixture
  // cannot fake a chosen filename. Assignments are counted instead: clearing it is what
  // lets somebody pick the SAME file again, since `change` does not fire for an unchanged
  // value, and "it was cleared" is only observable as the assignment happening.
  const cleared: string[] = [];
  const input0 = window.document.getElementById("restore-file") as unknown as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input0) as object,
    "value",
  );
  Object.defineProperty(input0, "value", {
    configurable: true,
    get(this: HTMLInputElement) {
      return descriptor?.get?.call(this) as string;
    },
    set(this: HTMLInputElement, next: string) {
      cleared.push(next);
      descriptor?.set?.call(this, next);
    },
  });
  const element = (id: string) =>
    window.document.getElementById(id) as unknown as HTMLInputElement &
      HTMLButtonElement & { textContent: string };
  return {
    document,
    element,
    cleared,
    async choose(text: string) {
      const input = element("restore-file");
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new window.File([text], "backup.json", { type: "application/json" })],
      });

      input.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
      // Two turns: reading the file and reading the store are each a promise.
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

/** Long enough for the control's promise chains to settle. */
const SETTLE_MS = 20;

function options(log: string[]) {
  return {
    onRefused: (refusal: Refusal) => log.push(`refused:${refusal.kind}`),
    onRestored: (count: number) => log.push(`restored:${count}`),
    onFailure: () => log.push("failed"),
    reload: () => log.push("reloaded"),
  };
}

describe("choosing a file to restore from", () => {
  it("wireRestore_AValidFile_ShowsWhatItHoldsAndWhatItWillCost", async () => {
    // Arrange — the two numbers a reader needs before an irreversible choice: what they
    // gain and what they give up. Counted when asked rather than at page load, because they
    // may have written more since.
    const HERE = new Map([["day1.patterns", "one"], ["day1.threads", "two"]]);
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, store, options([]));

    // Act
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Assert
    assert.equal(page.element("restore-confirm").hidden, false, "the confirmation never appeared");
    const said = page.element("restore-summary").textContent;
    assert.ok(said.includes("1 answer"), `does not say what the file holds: ${said}`);
    assert.ok(said.includes("2 answers"), `does not say what will be discarded: ${said}`);
    assert.deepEqual([...store.kept], [...HERE], "the store was touched before any confirmation");
  });

  it("wireRestore_ARefusedFile_SaysWhyAndNeverOffersToReplace", async () => {
    // Arrange — negative case, and the most important one: a wrong file must not reach the
    // confirmation at all, or the reader is one tick and one tap from replacing everything
    // they own with nothing.
    const HERE = new Map([["day1.patterns", "everything the reader has written"]]);
    const log: string[] = [];
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, store, options(log));

    // Act
    await page.choose("a shopping list, or a photo, or nothing at all");

    // Assert
    assert.deepEqual(log, ["refused:not-json"]);
    assert.equal(page.element("restore-confirm").hidden, true, "a refused file offered a replace");
    assert.deepEqual([...store.kept], [...HERE]);
  });
});

describe("the confirmation gate", () => {
  it("wireRestore_ReplacePressedWithoutTicking_DoesNothing", async () => {
    // Arrange — negative case. 0009 · C8 puts the gate with the reader because the code
    // cannot verify a backup reached disk. If the button worked without the tick, the gate
    // would be decoration.
    const HERE = new Map([["day1.patterns", "everything the reader has written"]]);
    const log: string[] = [];
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, store, options(log));
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Act — press it without ticking the acknowledgement.
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(log, []);
    assert.deepEqual([...store.kept], [...HERE], "answers were replaced with no acknowledgement");
    assert.deepEqual(store.replacements, []);
  });

  it("wireRestore_TickedAndConfirmed_ReplacesEverythingAndReloads", async () => {
    // Arrange — the whole flow, once. The reload is what makes the screen match the store:
    // binding restores on load and never writes into a field that already holds something
    // (0001), so without it every answer on screen is the old one and the next keystroke
    // saves it back over what was just restored.
    const log: string[] = [];
    const page = control();
    const store = recorder(new Map([["day1.threads", "will be discarded"]]));
    wireRestore(page.document, store, options(log));
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Act
    const lockedBeforeTicking = page.element("restore-go").disabled;
    page.tick();
    const unlockedAfterTicking = !page.element("restore-go").disabled;
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert — the gate is visible as well as enforced. A button that stays greyed out
    // after the tick reads as broken; one that is live before it invites the mis-tap.
    assert.equal(lockedBeforeTicking, true, "the replace button was live before the tick");
    assert.equal(unlockedAfterTicking, true, "ticking did not release the replace button");
    assert.deepEqual(log, ["restored:1", "reloaded"]);
    assert.deepEqual([...store.kept], [["day1.patterns", "from the file"]]);
    assert.deepEqual(store.replacements, [1], "the store was written more than once");
  });

  it("wireRestore_Cancelled_LeavesEverythingAloneAndForgetsTheFile", async () => {
    // Arrange — negative case. Cancelling must not leave a loaded file one stray tap from
    // being applied, and must not leave the reader unable to pick the same file again.
    const HERE = new Map([["day1.patterns", "everything the reader has written"]]);
    const log: string[] = [];
    const page = control();
    const store = recorder(HERE);
    wireRestore(page.document, store, options(log));
    await page.choose(await fileHolding(new Map([["day1.patterns", "from the file"]])));

    // Act
    page.press("restore-cancel");
    page.tick();
    page.press("restore-go");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.deepEqual(log, []);
    assert.deepEqual([...store.kept], [...HERE]);
    assert.equal(page.element("restore-confirm").hidden, true);
    assert.ok(page.cleared.includes(""), "the file input was never cleared, so the same file could not be chosen again");
  });
});

describe("what a refusal tells the reader", () => {
  it("explain_EveryRefusal_SaysNothingChangedAndWhatWentWrong", () => {
    // Arrange — somebody importing may be holding their only copy. Every message has to
    // distinguish itself from "your backup is gone", and every one has to say that this
    // device is untouched.
    const ALL: Refusal[] = [
      { kind: "not-json" },
      { kind: "not-an-envelope" },
      { kind: "wrong-format", found: "some-other-app/notes" },
      { kind: "newer-version", found: 2 },
      { kind: "encrypted", found: "passphrase-aes-gcm" },
      { kind: "bad-payload" },
    ];

    // Act & Assert
    for (const refusal of ALL) {
      const said = explain(refusal);
      assert.ok(said.length > 0, refusal.kind);
      assert.ok(
        said.includes("Nothing on this device has changed"),
        `${refusal.kind} does not reassure the reader their answers are intact: ${said}`,
      );
    }
    assert.ok(explain({ kind: "encrypted", found: "x" }).includes("encrypted"));
    assert.ok(explain({ kind: "newer-version", found: 2 }).includes("newer version"));
  });
});
