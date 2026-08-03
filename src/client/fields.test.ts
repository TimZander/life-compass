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

/** A store that records what it was asked to keep, and can be pre-loaded. */
function recorder(initial: ReadonlyMap<string, string> = new Map()) {
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
      if (kept.has(guard)) {
        return false;
      }
      for (const [key, value] of entries) {
        kept.set(key, value);
      }
      return true;
    },
  };
  return store;
}

/** One `<p>` holding a single-valued blank, and a two-slot repeat, as the build emits them. */
const PAGE = `
  <p><span class="fill" data-field="day1.patterns">______</span></p>
  <ol class="q-repeat" data-question="day1.chapters" data-min="2" data-max="2">
    <li data-instance="0"><span class="fill" data-field="day1.chapters.title">______</span></li>
    <li data-instance="1"><span class="fill" data-field="day1.chapters.title">______</span></li>
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

/** Type into a field the way dictation arrives: appended, in bursts, without focus moving. */
function dictate(field: HTMLTextAreaElement, phrase: string): void {
  field.value += phrase;
  field.setSelectionRange(field.value.length, field.value.length);
  field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
}

describe("dictating into a field", () => {
  it("bindAnswers_SavingWhileDictating_LeavesTheFieldAndItsCaretAlone", async () => {
    // Arrange — the promise 0001 makes and #24 names. A save that re-renders the field,
    // moves focus, or writes back into it destroys an in-progress dictation: minutes of
    // speech, gone, in a way that is hard to reproduce and maddening to hit.
    const QUIET = 5;
    const document = render();
    const store = recorder();
    const answers = createAnswers(store, { quietMs: QUIET, maxWaitMs: QUIET * 10 });
    await bindAnswers(document, answers, store);
    const field = fieldFor("day1.patterns");
    field.focus();

    // Act — three bursts with a save allowed to land between them.
    dictate(field, "The garage-band years, ");
    await new Promise((resolve) => setTimeout(resolve, QUIET * 4));
    const caretAfterSave = field.selectionStart;
    dictate(field, "and the summer after. ");
    await answers.flush();
    dictate(field, "That is when it started.");
    await answers.flush();

    // Assert — the field is the same element, still focused, caret still at the end, and
    // nothing rewrote what was said.
    assertSame(window.document.activeElement, field, "focus left the field");
    assert.equal(field.selectionStart, field.value.length, "the caret moved");
    assert.equal(caretAfterSave, "The garage-band years, ".length, "a save moved the caret");
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
    const answers = createAnswers(store, { quietMs: 5 });

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
    const answers = createAnswers(store, { quietMs: 5 });

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
    const answers = createAnswers(store, { quietMs: 5 });
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
    const answers = createAnswers(store, { quietMs: 5 });

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
    const answers = createAnswers(store, { quietMs: 5 });
    const warned: string[] = [];

    // Act
    await bindAnswers(document, answers, store, { onUnreadable: (group) => warned.push(group) });
    dictate(fieldFor("day1.chapters.title", 0), "typed into a broken group");
    await answers.flush();

    // Assert — the stored bytes are untouched, nothing was minted, and the reader is told.
    assert.equal(store.kept.get(orderKey("day1.chapters")), CORRUPT);
    assert.deepEqual(store.claims, []);
    assert.deepEqual(warned, ["day1.chapters"]);
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
    const answers = createAnswers(store, { quietMs: 5 });
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
