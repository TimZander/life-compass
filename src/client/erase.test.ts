/**
 * Removing every answer from this device (#63), exercised against a DOM (0014).
 *
 * The one irreversible act with nothing to fall back on. A restore at least replaces the
 * store with a file the reader chose; this replaces it with nothing, so every test here is
 * really the same question asked from a different side: did the reader get to weigh an
 * accurate number, was the destructive path genuinely unreachable until they said so, and —
 * if anything failed — were they told the truth about what is still on the device.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";
import { wireErase } from "./erase.ts";
import type { Store } from "./store.ts";
import { layout } from "../../build/layout.ts";
import { orderKey, writeOrder } from "./keys.ts";

/** A store that records what it was asked to keep, and can be made to fail. */
function recorder(initial: ReadonlyMap<string, string> = new Map(), fail = false) {
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
      if (fail) {
        throw new Error("the store would not open");
      }
      replacements.push(entries.size);
      kept.clear();
      for (const [key, value] of entries) {
        kept.set(key, value);
      }
    },
  };
  return store;
}

let window: Window;

before(() => {
  window = new Window();
});

after(() => {
  void window.close();
});

/**
 * The erase control, lifted from the real build rather than hand-copied.
 *
 * import.test.ts records why: its hand-written fixture claimed to be "exactly as layout()
 * emits it" and was not, so nothing pinned the module's element contract to the markup and
 * renaming an id shipped a control that only logged to the console, past a green suite.
 */
function realControl(): string {
  const html = layout("<p>prose</p>", "Backup", "backup");
  const match = /<section class="tools" id="erase"[\s\S]*?<\/section>/.exec(html);
  assert.ok(match !== null, "the build no longer emits an erase control");
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
    locked: () => element("erase-go").getAttribute("aria-disabled") !== "false",
    async ask() {
      element("erase-start").dispatchEvent(
        new window.Event("click", { bubbles: true }) as unknown as Event,
      );
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    },
    tick() {
      const box = element("erase-ack");
      box.checked = true;
      box.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    },
    press(id: string) {
      element(id).dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    },
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
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
    onErased: (count: number) => log.push(`erased:${count}`),
    onFailure: () => log.push("failed"),
    onBackupFirst: () => log.push("backup-first"),
    reload: () => log.push("reloaded"),
  };
}

describe("asking what an erase would cost", () => {
  it("wireErase_AStoreWithAnswers_StatesHowManyWillGo", async () => {
    // Arrange — the number a reader weighs before an irreversible choice, taken at the
    // moment of asking rather than at page load, because they may have written more since.
    const HERE = new Map([
      ["day1.patterns", "one"],
      ["day1.threads", "two"],
    ]);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), recorder(HERE), options(log));
    await page.ask();

    // Assert
    assert.match(page.text("erase-summary"), /\b2 answers\b/);
    assert.equal(page.hidden("erase-confirm"), false, "the confirmation never appeared");
  });

  it("wireErase_OneAnswer_SaysAnswerNotAnswers", async () => {
    // Arrange — the sentence somebody weighs before an irreversible act should not read
    // "1 answers". Shares `tally` with the restore path so the two cannot drift.
    const HERE = new Map([["day1.patterns", "only this"]]);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), recorder(HERE), options(log));
    await page.ask();

    // Assert
    assert.match(page.text("erase-summary"), /\b1 answer\b/);
    assert.doesNotMatch(page.text("erase-summary"), /\b1 answers\b/);
  });

  it("wireErase_AnInstanceOrder_IsNotCountedAsAnAnswer", async () => {
    // Arrange — the regression #57 shipped, from the other end. An instance order is stored
    // under a bare group identifier alongside the answers it addresses; counting it would
    // tell a reader they are giving up more than they wrote, and would disagree with the
    // number the very same page shows when they export. Both come from `countStored`.
    const HERE = new Map([
      ["day1.patterns", "one"],
      [orderKey("day1.chapters"), writeOrder(["a", "b"])],
    ]);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), recorder(HERE), options(log));
    await page.ask();

    // Assert
    assert.match(page.text("erase-summary"), /\b1 answer\b/);
  });

  it("wireErase_AnEmptyStore_SaysSoRatherThanOfferingToRemoveNothing", async () => {
    // Arrange — negative case. A control that appears broken, or that offers to erase "0
    // answers", is worse than one that says plainly there is nothing here.
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), recorder(new Map()), options(log));
    await page.ask();

    // Assert
    assert.match(page.text("erase-summary"), /no answers/i);
    assert.doesNotMatch(page.text("erase-summary"), /\b0 answers\b/);
  });
});

describe("the acknowledgement gate", () => {
  it("wireErase_PressedWithoutAcknowledging_ErasesNothing", async () => {
    // Arrange — negative case, and the whole of the guard. `aria-disabled` does not stop a
    // click the way `disabled` would; it is used deliberately so the button keeps focus, so
    // the real gate is the check inside the handler rather than anything the browser does.
    const HERE = new Map([["day1.patterns", "one"]]);
    const store = recorder(HERE);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.equal(store.kept.size, 1, "the store was emptied without an acknowledgement");
    assert.deepEqual(log, []);
    assert.equal(page.locked(), true, "the button was armed before it was acknowledged");
  });

  it("wireErase_Acknowledged_ArmsTheButton", async () => {
    // Arrange
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), recorder(new Map([["a", "b"]])), options(log));
    await page.ask();
    page.tick();

    // Assert
    assert.equal(page.locked(), false, "acknowledging did not arm the button");
  });

  it("wireErase_Cancelled_PutsTheConfirmationAwayAndCannotBeActedOn", async () => {
    // Arrange — negative case. Cancelling has to disarm as well as hide: a confirmation
    // left pending behind a hidden panel is a click away from doing the thing.
    const HERE = new Map([["day1.patterns", "one"]]);
    const store = recorder(HERE);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.tick();
    page.press("erase-cancel");
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.equal(page.hidden("erase-confirm"), true, "the confirmation stayed on screen");
    assert.equal(store.kept.size, 1, "a cancelled erase still emptied the store");
    assert.deepEqual(log, []);
  });
});

describe("erasing", () => {
  it("wireErase_Confirmed_EmptiesTheStoreAndReloads", async () => {
    // Arrange — the whole point of the feature.
    const HERE = new Map([
      ["day1.patterns", "one"],
      ["day1.threads", "two"],
    ]);
    const store = recorder(HERE);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.tick();
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.equal(store.kept.size, 0, "answers were left on the device");
    assert.deepEqual(store.replacements, [0], "the store was not replaced with an empty map");
    assert.deepEqual(log, ["erased:2", "reloaded"]);
  });

  it("wireErase_Confirmed_DrainsAndStopsAutosaveBeforeTheStoreIsCleared", async () => {
    // Arrange — the defect the restore path had to be rewritten for, and it is worse here.
    // Autosave debounces, and `reload()` fires `pagehide`, which app.ts flushes on — so a
    // phrase dictated moments before pressing Erase would be written back on TOP of the
    // emptied store, leaving one answer on a device the reader has just been told is empty.
    const order: string[] = [];
    const store = recorder(new Map([["day1.patterns", "one"]]));
    const page = control();

    // Act
    wireErase(page.document, answersSpy(order), store, {
      onErased: () => order.push("announced"),
      onFailure: () => order.push("failed"),
      onBackupFirst: () => order.push("backup-first"),
      reload: () => order.push("reloaded"),
    });
    await page.ask();
    page.tick();
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.deepEqual(order, ["flushed", "stopped", "announced", "reloaded"]);
  });

  it("wireErase_PressedTwice_ErasesOnce", async () => {
    // Arrange — negative case. A second press while the first is in flight would run the
    // whole chain again and announce twice.
    const store = recorder(new Map([["day1.patterns", "one"]]));
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.tick();
    page.press("erase-go");
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.deepEqual(store.replacements, [0], "the store was replaced more than once");
    assert.deepEqual(log, ["erased:1", "reloaded"]);
  });

  it("wireErase_AskedAgainWhileTheFirstIsInFlight_StillErasesOnce", async () => {
    // Arrange — negative case, and the one the `running` flag actually exists for. Clearing
    // `pending` blocks a second press of the SAME confirmation; it does not block a reader
    // who re-opens the control and confirms again before the reload has taken the page away.
    // Without the flag that second confirmation runs the whole chain a second time and
    // announces an erase that already happened.
    const store = recorder(new Map([["day1.patterns", "one"]]));
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.tick();
    page.press("erase-go");
    await page.ask();
    page.tick();
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.deepEqual(store.replacements, [0], "the store was emptied twice");
    assert.deepEqual(log, ["erased:1", "reloaded"]);
  });

  it("wireErase_TheBackupOffer_IsOfferedBeforeAnythingIsRemoved", async () => {
    // Arrange — 0009 · C8 asks for the export at the moment of asking, and the argument is
    // stronger here than for restore: afterwards there is no file to fall back on at all,
    // only the one the reader took.
    const store = recorder(new Map([["day1.patterns", "one"]]));
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.press("erase-backup-first");

    // Assert
    assert.deepEqual(log, ["backup-first"]);
    assert.equal(store.kept.size, 1, "offering a backup removed something");
  });
});

describe("when it cannot be done", () => {
  it("wireErase_TheStoreRefuses_SaysNothingChangedAndLeavesItThere", async () => {
    // Arrange — negative case. The sentence "nothing on this device has changed" must never
    // be false, and import.ts records shipping it exactly when it was: the announcement lived
    // inside the chain that reported failure, so a throw told the reader nothing had happened
    // after everything had.
    const HERE = new Map([["day1.patterns", "one"]]);
    const store = recorder(HERE, true);
    const page = control();
    const log: string[] = [];

    // Act
    wireErase(page.document, answersSpy(), store, options(log));
    await page.ask();
    page.tick();
    page.press("erase-go");
    await page.settle();

    // Assert
    assert.deepEqual(log, ["failed"], "a failed erase was announced as an erase");
    assert.equal(store.kept.size, 1, "the answer was removed despite the failure");
    assert.equal(page.hidden("erase-confirm"), true, "the confirmation was left standing");
  });

  it("wireErase_MarkupThatDoesNotCarryTheControl_SaysSoAndBindsNothing", async () => {
    // Arrange — negative case. The build emits every element together, so a missing one
    // means the markup and this module have drifted; the symptom otherwise is a control
    // that quietly is not there, on the page whose job is being straight about the device.
    window.document.body.innerHTML = "<p>no control here</p>";
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    // Act
    try {
      wireErase(window.document as unknown as Document, answersSpy(), recorder(), options([]));
    } finally {
      console.error = original;
    }

    // Assert
    assert.equal(logged.length, 1, "a missing control was not reported");
  });
});
