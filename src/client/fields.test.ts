/**
 * Binding blanks to storage, exercised against a DOM (docs/decisions/0014).
 *
 * The first test in this file is the one docs/decisions/0001 and #24 exist for: a save
 * must never disturb the field a reader is dictating into. Everything else here is about
 * not losing what they said — during load, during materialisation, or when two tabs race.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";
import { createAnswers } from "./answers.ts";
import { bindAnswers } from "./fields.ts";
import { orderKey, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

/** A store that records what it was asked to keep, and can be pre-loaded or made to fail. */
function recorder(initial: ReadonlyMap<string, string> = new Map(), failClaim = false) {
  const kept = new Map(initial);
  const claims: string[] = [];
  const store: Store & { readonly kept: Map<string, string>; readonly claims: string[] } = {
    kept,
    claims,
    async readAll() {
      return new Map(kept);
    },
    async write(field, value) {
      if (value === "") {
        kept.delete(field);
      } else {
        kept.set(field, value);
      }
    },
    async claim(guard, entries) {
      claims.push(guard);
      if (failClaim) {
        throw new Error("QuotaExceededError");
      }
      if (kept.has(guard)) {
        return false;
      }
      for (const [key, value] of entries) {
        // Empty is absent, not blank — the real store deletes here, and a fake that stored
        // "" would be more forgiving than the thing it stands in for.
        if (value === "") {
          kept.delete(key);
        } else {
          kept.set(key, value);
        }
      }
      return true;
    },
  };
  return store;
}

/** One `<p>` holding a single-valued blank, and a two-slot repeat, as the build emits them. */
const PAGE = `
  <p class="q-single" data-question="day1.patterns"><span class="fill" data-field="day1.patterns" data-label="Patterns">______</span></p>
  <p class="q-sentence" data-question="day4.enough">The world has enough <span class="fill-sm" data-field="day4.enough.excess" data-label="Enough of">______</span>.</p>
  <ol class="q-repeat" data-question="day1.chapters" data-min="2" data-max="2">
    <li data-instance="0"><p><em><span class="fill" data-field="day1.chapters.title" data-label="Chapter 1 — Title">______</span></em></p></li>
    <li data-instance="1"><p><em><span class="fill" data-field="day1.chapters.title" data-label="Chapter 2 — Title">______</span></em></p></li>
  </ol>`;

let window: Window;

before(() => {
  window = new Window();
  // fields.ts reaches for these as globals, exactly as it does in a browser.
  const scope = globalThis as unknown as Record<string, unknown>;
  scope["document"] = window.document;
  scope["HTMLInputElement"] = window.HTMLInputElement;
  scope["HTMLTextAreaElement"] = window.HTMLTextAreaElement;
});

after(() => {
  void window.close();
});

function render(html: string = PAGE): Document {
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

function fieldFor(identifier: string, slot?: number): HTMLTextAreaElement {
  const selector =
    slot === undefined
      ? `[data-field="${identifier}"]`
      : `[data-instance="${slot}"] [data-field="${identifier}"]`;
  const found = window.document.querySelector(selector);
  assert.ok(found !== null, `no field for ${identifier}`);
  return found as unknown as HTMLTextAreaElement;
}

/**
 * Compare two DOM nodes.
 *
 * `assert.equal` cannot be used on a node. It passes quietly and, on failure, tries to
 * render a diff of the two — which walks a DOM node's parent, children and document until
 * the heap is gone. The test then reports as an out-of-memory kill with no message at all,
 * which is a bad way to find out that focus moved.
 */
function assertSame(actual: unknown, expected: unknown, message: string): void {
  assert.ok(actual === expected, message);
}

/** Quiet window for every test here: long enough to be a debounce, short enough to wait on. */
const QUIET_MS = 5;

/** Let a debounce, a materialisation and the write it triggers all settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS * 4));
}

/** Type into a field the way dictation arrives: appended, in bursts, without focus moving. */
function dictate(field: HTMLTextAreaElement, phrase: string): void {
  field.value += phrase;
  field.setSelectionRange(field.value.length, field.value.length);
  field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
}

/**
 * Count assignments to a field's `value`, so "nothing wrote back into it" is observable.
 *
 * Watching the caret is not enough and this file learned it the hard way. In a browser any
 * `.value` assignment — even an identical one — moves the caret to the end; happy-dom
 * leaves it where it was. So a write-back is invisible in this DOM, and the first version
 * of the test below passed against an input handler that assigned to the field on every
 * save. Counting the assignments themselves does not depend on either behaviour.
 */
function countValueWrites(field: HTMLTextAreaElement): () => number {
  const prototype = Object.getPrototypeOf(field) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  assert.ok(descriptor?.get !== undefined && descriptor.set !== undefined, "no value accessor");
  let writes = 0;
  Object.defineProperty(field, "value", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return descriptor.get?.call(this) as string;
    },
    set(this: HTMLTextAreaElement, next: string) {
      writes += 1;
      descriptor.set?.call(this, next);
    },
  });
  return () => writes;
}

describe("dictating into a field", () => {
  it("bindAnswers_SavingWhileDictating_LeavesTheFieldItsCaretAndItsTextAlone", async () => {
    // Arrange — the promise 0001 makes and #24 names. A save that re-renders the field,
    // moves focus, or writes back into it destroys an in-progress dictation: minutes of
    // speech, gone, in a way that is hard to reproduce and maddening to hit.
    const BURSTS = 3;
    const CARET = "The garage-band years, ".length;
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS, maxWaitMs: QUIET_MS * 10 });
    await bindAnswers(document, answers, store);
    const field = fieldFor("day1.patterns");
    field.focus();
    const writes = countValueWrites(field);

    // Act — three bursts with a save allowed to land between them, and the caret then put
    // back into the middle, which is what a reader does to correct a mis-transcribed word.
    dictate(field, "The garage-band years, ");
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS * 4));
    dictate(field, "and the summer after. ");
    await answers.flush();
    dictate(field, "That is when it started.");
    field.setSelectionRange(CARET, CARET);
    await answers.flush();

    // Assert — same element, still focused, caret exactly where the reader left it, text
    // untouched, and the only writes to `value` were the reader's own three bursts.
    assertSame(window.document.activeElement, field, "focus left the field");
    assert.equal(writes(), BURSTS, "a save wrote back into the field");
    assert.equal(field.selectionStart, CARET, "the caret moved");
    assert.equal(field.selectionEnd, CARET, "the selection moved");
    assert.equal(
      field.value,
      "The garage-band years, and the summer after. That is when it started.",
    );
    assert.equal(store.kept.get("day1.patterns"), field.value);
    answers.stop();
  });

  it("bindAnswers_FieldTypedIntoBeforeLoadResolves_DoesNotOverwriteIt", async () => {
    // Arrange — a real race: `load` is async, so a fast reader can have said a sentence
    // and moved on before stored answers arrive.
    const STORED = "written last week";
    const TYPED = "what I am saying now";
    const document = render();
    const store = recorder(new Map([["day1.patterns", STORED]]));
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act — start binding, then type before it resolves.
    const binding = bindAnswers(document, answers, store);
    const field = fieldFor("day1.patterns");
    field.value = TYPED;
    await binding;

    // Assert
    assertSame(
      window.document.activeElement,
      window.document.body,
      "the field must not be focused here — this test is about the empty check",
    );
    assert.equal(field.value, TYPED);
    answers.stop();
  });

  it("bindAnswers_FieldFocusedButStillEmptyWhenLoadResolves_StillRestoresIt", async () => {
    // Arrange — the other half of the same window, and the reason focus is not part of
    // the guard. A reader taps a blank and pauses before speaking; if the pause outlasts
    // `load`, skipping the restore means their stored answer never appears and their next
    // phrase saves over it.
    const STORED = "written last week";
    const document = render();
    const store = recorder(new Map([["day1.patterns", STORED]]));
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    const binding = bindAnswers(document, answers, store);
    const field = fieldFor("day1.patterns");
    field.focus();
    await binding;

    // Assert
    assert.equal(field.value, STORED, "a stored answer was dropped because the field had focus");
    answers.stop();
  });
});

describe("repeat instances", () => {
  it("bindAnswers_TwoSlotsOfOneField_GetDistinctStorageKeys", async () => {
    // Arrange — the collision this whole issue exists to prevent: both chapter titles
    // render the same data-field, and before instances they shared one key.
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });
    await bindAnswers(document, answers, store);

    // Act
    dictate(fieldFor("day1.chapters.title", 0), "The garage-band years");
    await answers.flush();
    dictate(fieldFor("day1.chapters.title", 1), "First job that mattered");
    await answers.flush();

    // Assert — two answers, two keys, and an order naming both instances.
    const answersKept = [...store.kept].filter(([key]) => key !== orderKey("day1.chapters"));
    assert.equal(answersKept.length, 2, "the two slots shared a key");
    assert.deepEqual(
      answersKept.map(([, value]) => value).sort(),
      ["First job that mattered", "The garage-band years"],
    );
    answers.stop();
  });

  it("bindAnswers_GroupAlreadyMaterialised_ReusesItsStoredInstances", async () => {
    // Arrange — a second visit. The stored order decides which slot shows which answer
    // (0013 · C3), so nothing may be re-minted.
    const FIRST = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const SECOND = "9a34cd77-1e2f-4b8d-8a01-3c9f7e5d2b66";
    const document = render();
    const store = recorder(
      new Map([
        [orderKey("day1.chapters"), writeOrder([FIRST, SECOND])],
        [`day1.chapters.${FIRST}.title`, "The garage-band years"],
      ]),
    );
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await bindAnswers(document, answers, store);
    dictate(fieldFor("day1.chapters.title", 1), "First job that mattered");
    await answers.flush();

    // Assert — slot 0 restored, slot 1 stored under the existing second instance, and no
    // claim was attempted because the group was already materialised.
    assert.equal(fieldFor("day1.chapters.title", 0).value, "The garage-band years");
    assert.equal(store.kept.get(`day1.chapters.${SECOND}.title`), "First job that mattered");
    assert.deepEqual(store.claims, []);
    answers.stop();
  });

  it("bindAnswers_UnreadableStoredOrder_LeavesItAloneAndSaysSo", async () => {
    // Arrange — negative case, and the one that would destroy data if it went the other
    // way: minting over an order that merely failed to parse orphans every answer under
    // it (0013 · Q3).
    const CORRUPT = "a chapter title, written here by an older version";
    const document = render();
    const store = recorder(new Map([[orderKey("day1.chapters"), CORRUPT]]));
    const answers = createAnswers(store, { quietMs: QUIET_MS });
    const warned: string[] = [];

    // Act
    await bindAnswers(document, answers, store, { onUnwritable: (group, reason) => warned.push(`${group}:${reason}`) });
    dictate(fieldFor("day1.chapters.title", 0), "typed into a broken group");
    await answers.flush();

    // Assert — the stored bytes are untouched, nothing was minted, and the reader is told.
    assert.equal(store.kept.get(orderKey("day1.chapters")), CORRUPT);
    assert.deepEqual(store.claims, []);
    assert.deepEqual(warned, ["day1.chapters:unreadable"]);
    answers.stop();
  });

  it("bindAnswers_AnotherTabMaterialisedFirst_AdoptsTheWinnersInstances", async () => {
    // Arrange — two tabs both first-writing one group. Whichever order lands second must
    // not overwrite the first, or the loser's answers sit under identifiers nothing
    // references. `claim` refuses, and this tab re-reads instead of assuming it won.
    const THEIRS = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const OTHER = "9a34cd77-1e2f-4b8d-8a01-3c9f7e5d2b66";
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });
    await bindAnswers(document, answers, store);

    // Act — the other tab wins the guard between binding and the first keystroke.
    store.kept.set(orderKey("day1.chapters"), writeOrder([THEIRS, OTHER]));
    dictate(fieldFor("day1.chapters.title", 0), "typed after they won");
    await answers.flush();
    await answers.flush();

    // Assert — stored under THEIR first instance, and their order survived.
    assert.equal(store.kept.get(orderKey("day1.chapters")), writeOrder([THEIRS, OTHER]));
    assert.equal(store.kept.get(`day1.chapters.${THEIRS}.title`), "typed after they won");
    answers.stop();
  });
});

describe("turning a blank into a control", () => {
  it("upgrade_EveryBlankLongOrShort_BecomesATextareaThatCanWrap", async () => {
    // Arrange — short blanks were `<input>` first, to keep a sentence from breaking across
    // a block element. It kept the sentence and lost the answer: an input cannot wrap, so
    // anything longer than the 6rem gap scrolled out of sight mid-dictation. Both sizes are
    // textareas now and differ only in how style.css lays them out.
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await bindAnswers(document, answers, store);

    // Assert
    assert.equal(fieldFor("day1.patterns").tagName, "TEXTAREA");
    assert.equal(fieldFor("day4.enough.excess").tagName, "TEXTAREA");
    answers.stop();
  });

  it("upgrade_EveryControl_KeepsTheRuledLineClassAndIsNamedFromTheSchema", async () => {
    // Arrange — both halves shipped broken once. The class is what style.css hangs the
    // control rules off, and without it the field has no blank to sit on; the name is what
    // a screen reader announces, and deriving it from the surrounding prose produced the
    // literal "______" for every single-valued question.
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await bindAnswers(document, answers, store);

    // Assert
    assert.equal(fieldFor("day1.patterns").className, "fill");
    assert.equal(fieldFor("day4.enough.excess").className, "fill-sm");
    assert.equal(fieldFor("day1.patterns").getAttribute("aria-label"), "Patterns");
    assert.equal(fieldFor("day1.chapters.title", 0).getAttribute("aria-label"), "Chapter 1 — Title");
    assert.equal(fieldFor("day1.chapters.title", 1).getAttribute("aria-label"), "Chapter 2 — Title");
    answers.stop();
  });

  it("upgrade_BlankWithNoResolvableAddress_IsLeftAsPrintedRatherThanMadeTypeable", async () => {
    // Arrange — negative case. An upgraded but unbound control looks exactly like a working
    // one and silently swallows everything dictated into it. Each of these is a build
    // regression away, and `Number("")` is 0, so a blank marker would collide with slot 0.
    const NO_QUESTION = '<li data-instance="0"><span class="fill" data-field="a.b">_</span></li>';
    const BAD_SLOT = '<ol data-question="x.y"><li data-instance="one"><span class="fill" data-field="x.y.z">_</span></li></ol>';
    const EMPTY_SLOT = '<ol data-question="x.y"><li data-instance=""><span class="fill" data-field="x.y.z">_</span></li></ol>';
    const WRONG_PREFIX = '<ol data-question="x.y"><li data-instance="0"><span class="fill" data-field="other.z">_</span></li></ol>';
    const document = render(NO_QUESTION + BAD_SLOT + EMPTY_SLOT + WRONG_PREFIX);
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await bindAnswers(document, answers, store);

    // Assert — all four are still spans, so nothing can be typed into them and lost.
    assert.equal(window.document.querySelectorAll("span.fill").length, 4);
    assert.equal(window.document.querySelectorAll("textarea").length, 0);
    answers.stop();
  });
});

describe("when a group cannot be written to", () => {
  it("bindAnswers_ClaimRejects_TellsTheReaderInsteadOfDyingSilently", async () => {
    // Arrange — negative case, and the worst one available. A quota abort rejects the
    // claim; an unhandled rejection here left the group permanently dead, so every later
    // phrase was discarded with nothing on screen and nothing in the console.
    const document = render();
    const store = recorder(new Map(), true);
    const failures: unknown[] = [];
    const answers = createAnswers(store, { quietMs: QUIET_MS });
    await bindAnswers(document, answers, store, { onFailure: (error) => failures.push(error) });

    // Act — two phrases, the second after the first has already failed.
    dictate(fieldFor("day1.chapters.title", 0), "The garage-band years");
    await settle();
    dictate(fieldFor("day1.chapters.title", 0), " and after");
    await settle();

    // Assert — reported, and reported once rather than on every keystroke.
    assert.equal(failures.length, 1, "the reader was not told the group stopped saving");
    assert.deepEqual([...store.kept.keys()], []);
    answers.stop();
  });

  it("bindAnswers_StoredOrderShorterThanTheSlotsOnThePage_RefusesLoudly", async () => {
    // Arrange — negative case. Raising a repeat's `min` after somebody has answered leaves
    // slot 2 with no instance (0013 · Q2). Using the short order anyway made every word
    // dictated into that slot vanish on every keystroke with nothing said.
    const FIRST = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const document = render();
    const store = recorder(new Map([[orderKey("day1.chapters"), writeOrder([FIRST])]]));
    const warned: string[] = [];
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await bindAnswers(document, answers, store, {
      onUnwritable: (group, reason) => warned.push(`${group}:${reason}`),
    });
    dictate(fieldFor("day1.chapters.title", 1), "into the slot with no instance");
    await settle();

    // Assert — the reader is told, the stored order is untouched, and nothing was minted
    // over the answers already under it.
    assert.deepEqual(warned, ["day1.chapters:short"]);
    assert.equal(store.kept.get(orderKey("day1.chapters")), writeOrder([FIRST]));
    assert.deepEqual(store.claims, []);
    answers.stop();
  });
});

describe("dictating while the page is still loading", () => {
  it("bindAnswers_PhraseDictatedBeforeLoadResolves_IsSaved", async () => {
    // Arrange — `load` reads the whole store, and on a cold cache a reader can get a
    // sentence out before it returns. Attaching the listeners after the await meant that
    // sentence was displayed and never stored: it survived on screen, so nothing looked
    // wrong, and it was gone at the next visit.
    const SPOKEN = "a paragraph said while the page was still opening";
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act — dictate into the control before binding resolves.
    const binding = bindAnswers(document, answers, store);
    dictate(fieldFor("day1.patterns"), SPOKEN);
    await binding;
    await answers.flush();

    // Assert
    assert.equal(store.kept.get("day1.patterns"), SPOKEN);
    answers.stop();
  });

  it("bindAnswers_PhraseDictatedIntoARepeatBeforeLoadResolves_IsSaved", async () => {
    // Arrange — the same window, but into a group with no instances yet, so the value has
    // to survive materialisation as well as the load.
    const SPOKEN = "the first chapter, said early";
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    const binding = bindAnswers(document, answers, store);
    dictate(fieldFor("day1.chapters.title", 0), SPOKEN);
    await binding;
    await settle();

    // Assert
    assert.deepEqual(
      [...store.kept.values()].filter((value) => value === SPOKEN),
      [SPOKEN],
    );
    answers.stop();
  });
});

describe("a short blank whose answer outgrows its line", () => {
  /**
   * Stand in for a layout engine, which happy-dom does not have (0014 · C3).
   *
   * Every element reports a width of ten pixels per character and every container is 300
   * wide, so "fits on one line" becomes a question about string length. That is a fake, and
   * it can only test the decision — whether the control is asked to take its own line —
   * never how the result looks. The looking is a device's job, and this behaviour exists
   * because a device found it.
   */
  function withFakeLayout(run: () => Promise<void>): Promise<void> {
    const element = window.HTMLElement.prototype;
    const width = Object.getOwnPropertyDescriptor(element, "offsetWidth");
    const client = Object.getOwnPropertyDescriptor(element, "clientWidth");
    const CHARACTER = 10;
    const CONTAINER = 300;
    Object.defineProperty(element, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return (this.textContent?.length ?? 0) * CHARACTER;
      },
    });
    Object.defineProperty(element, "clientWidth", { configurable: true, get: () => CONTAINER });
    return run().finally(() => {
      if (width !== undefined) {
        Object.defineProperty(element, "offsetWidth", width);
      }
      if (client !== undefined) {
        Object.defineProperty(element, "clientWidth", client);
      }
    });
  }

  it("fit_ShortAnswerThatStillFitsItsLine_StaysInTheSentence", async () => {
    // Arrange — the ordinary case. "The world has enough ___" reads as one sentence, and a
    // blank that jumped to its own line for every answer would take the sentence apart.
    const SHORT = "noise";
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await withFakeLayout(async () => {
      await bindAnswers(document, answers, store);
      dictate(fieldFor("day4.enough.excess"), SHORT);
    });

    // Assert
    const field = fieldFor("day4.enough.excess");
    assert.equal(field.classList.contains("fill-grown"), false, "a short answer left the line");
    assert.equal(field.style.width, "50px", "the blank did not grow to its answer");
    answers.stop();
  });

  it("fit_AnswerLongerThanTheLine_TakesItsOwnLineInsteadOfWrappingMidSentence", async () => {
    // Arrange — reported from a device, and the screenshot is the argument: an inline-block
    // that wraps starts its later lines at the blank's own left edge, mid-paragraph, and
    // leaves the rest of the sentence stranded up on the first line.
    const LONG = "test hw to make this long, and longer still";
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await withFakeLayout(async () => {
      await bindAnswers(document, answers, store);
      dictate(fieldFor("day4.enough.excess"), LONG);
    });

    // Assert — the stylesheet owns the width once it is grown, so no inline width is pinned.
    const field = fieldFor("day4.enough.excess");
    assert.equal(field.classList.contains("fill-grown"), true, "a long answer stayed inline");
    assert.equal(field.style.width, "", "an inline width was pinned to the measured text");
    answers.stop();
  });

  it("fit_AnswerCutBackDownToSize_ReturnsToTheSentence", async () => {
    // Arrange — negative case, and the one that would flicker if the width were read back
    // from the control's own layout rather than measured from its text.
    const LONG = "test hw to make this long, and longer still";
    const SHORT = "noise";
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET_MS });

    // Act
    await withFakeLayout(async () => {
      await bindAnswers(document, answers, store);
      const field = fieldFor("day4.enough.excess");
      dictate(field, LONG);
      field.value = SHORT;
      field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    });

    // Assert
    assert.equal(fieldFor("day4.enough.excess").classList.contains("fill-grown"), false);
    answers.stop();
  });
});
