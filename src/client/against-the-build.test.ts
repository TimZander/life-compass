/**
 * The binding, run against what the build actually emits.
 *
 * Every other test on either side of this seam uses its own fixture: the build asserts it
 * writes `data-field`, `data-instance`, `data-question` and `data-label`, and the client
 * asserts it reads them, and both pass hand-written HTML. So the two could drift — the
 * build could stop emitting a shape `collect()` needs, or emit a slot marker the `/^\d+$/`
 * test rejects — with both suites green and every blank on the site silently unbound.
 *
 * This is the only test that closes that gap, and it is deliberately end-to-end over the
 * whole schema rather than one page: the collision it guards against (0013) is a property
 * of all 447 blanks at once, not of any single question.
 *
 * What it cannot do is look. `happy-dom` has no layout (0014 · C3), so this proves the
 * addresses resolve and the answers land, and says nothing about whether a reader can see
 * the result.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";
import { renderQuestion } from "../../build/questions.ts";
import { answerKey, orderKey, writeOrder } from "./keys.ts";
import { WORKSHEETS } from "../questions/index.ts";
import { createAnswers } from "./answers.ts";
import { bindAnswers } from "./fields.ts";
import type { Store } from "./store.ts";

let window: Window;

before(() => {
  window = new Window();
  const scope = globalThis as unknown as Record<string, unknown>;
  scope["document"] = window.document;
});

after(() => {
  void window.close();
});

function store(): Store & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
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
      if (kept.has(guard)) {
        return false;
      }
      for (const [key, value] of entries) {
        kept.set(key, value);
      }
      return true;
    },
    async merge(entries) {
      for (const [key, value] of entries) {
        // Empty is absent, not blank — the real store deletes here, and a fake that
        // stored "" would be more forgiving than the thing it stands in for.
        if (value === "") {
          kept.delete(key);
        } else {
          kept.set(key, value);
        }
      }
    },
    async replaceAll(entries) {
      kept.clear();
      for (const [key, value] of entries) {
        kept.set(key, value);
      }
    },
  };
}

describe("binding the real schema", () => {
  it("bindAnswers_EveryQuestionTheBuildEmits_BindsEveryBlankItRenders", async () => {
    // Arrange — every question on the site, rendered by the build and handed to the client
    // exactly as a browser would receive it.
    let rendered = 0;
    let bound = 0;
    const unbound: string[] = [];

    // Act
    for (const worksheet of WORKSHEETS) {
      for (const question of worksheet.questions) {
        const html = renderQuestion(question);
        rendered += html.match(/class="fill(-sm)?"/g)?.length ?? 0;
        window.document.body.innerHTML = html;
        const kept = store();
        const answers = createAnswers(kept, { quietMs: 1 });
        await bindAnswers(window.document as unknown as Document, answers, kept);
        for (const control of window.document.querySelectorAll("textarea")) {
          const name = control.getAttribute("aria-label");
          // The name comes across the seam too: the build writes `data-label` and `upgrade`
          // reads it. Asserted here as well as on each side, because each side's own
          // fixture would keep passing if the other stopped.
          assert.ok(name !== null && name.trim() !== "", `${question.id} bound an unnamed field`);
          assert.ok(!name.includes("___"), `${question.id} named a field after its underscores`);
          // Never the fallback. `upgrade` degrades to "Answer" when `data-label` is missing,
          // which is right in a browser and useless here: it let the build stop emitting the
          // attribute altogether while this test stayed green. No schema label is "Answer".
          assert.notEqual(name, "Answer", `${question.id} fell back instead of reading data-label`);
          bound += 1;
        }
        if (window.document.querySelectorAll("span.fill, span.fill-sm").length > 0) {
          unbound.push(question.id);
        }
        answers.stop();
      }
    }

    // Assert — a blank left as a span is one the reader cannot type into at all.
    assert.deepEqual(unbound, [], "the build emits blanks the binding cannot address");
    assert.equal(bound, rendered, "not every rendered blank became a field");
    assert.ok(rendered > 400, `only ${rendered} blanks rendered; the schema should have ~447`);
  });

  it("bindAnswers_AStoredOrderLongerThanTheSheetPrints_ShowsEveryInstanceItNames", async () => {
    // Arrange — 0013 · Q2's silent half, and the reason #74 calls it worse than absence:
    // "an order LONGER than the slot count is accepted without comment, and the answers
    // under its extra instances simply never appear". A reader who got eight chapters into
    // the store — by restoring a backup, or by importing an assistant's reply — lost three
    // with nothing said, which 0008 calls the worst failure available to this application.
    //
    // Against the real schema rather than a fixture, because the whole question is whether
    // what the build prints and what the client reveals agree.
    const CHAPTERS = WORKSHEETS.flatMap((w) => w.questions).find((q) => q.id === "day1.chapters");
    assert.ok(CHAPTERS?.kind === "repeat", "day1.chapters is not a repeat any more");
    const PRINTED = CHAPTERS.min;
    const HELD = CHAPTERS.max;
    assert.ok(HELD > PRINTED, "day1.chapters no longer has a range to test");

    window.document.body.innerHTML = renderQuestion(CHAPTERS);
    const visible = (): number =>
      [...window.document.querySelectorAll("[data-instance]")].filter(
        (one) => !(one as unknown as HTMLElement).hidden,
      ).length;
    assert.equal(visible(), PRINTED, "the sheet does not print the floor of the range");

    // A store that already holds the ceiling, the way a restore would leave it.
    const ids = Array.from({ length: HELD }, (_, index) => `5f1c8e2a-0000-4000-8000-00000000000${index}`);
    const kept = store();
    kept.kept.set(orderKey(CHAPTERS.id), writeOrder(ids));
    const last = answerKey(CHAPTERS.id, ids[HELD - 1] ?? "", CHAPTERS.fields[0]?.id ?? "");
    kept.kept.set(last, "the eighth chapter");

    // Act
    const answers = createAnswers(kept, { quietMs: 1 });
    await bindAnswers(window.document as unknown as Document, answers, kept);
    answers.stop();

    // Assert
    assert.equal(visible(), HELD, "the instances the order names are still hidden");
    const shown = [...window.document.querySelectorAll("textarea")].map(
      (one) => (one as unknown as HTMLTextAreaElement).value,
    );
    assert.ok(
      shown.includes("the eighth chapter"),
      "an answer the order names never reached the page",
    );
  });

  it("bindAnswers_AnOrderThatFitsTheFloor_LeavesTheSparesHidden", async () => {
    // Arrange — negative case, and a survivor: `reveal(group, Number.MAX_SAFE_INTEGER)` left
    // the suite green. A reader with the ordinary five chapters would then have seen eight
    // slots AND been warned their group was unwritable, because three of them have no
    // identifier. The other two tests cover a full order and no order, so nothing held the
    // ordinary case in between.
    const CHAPTERS = WORKSHEETS.flatMap((w) => w.questions).find((q) => q.id === "day1.chapters");
    assert.ok(CHAPTERS?.kind === "repeat");
    window.document.body.innerHTML = renderQuestion(CHAPTERS);
    const ids = Array.from({ length: CHAPTERS.min }, (_, i) => `5f1c8e2a-0000-4000-8000-00000000000${i}`);
    const kept = store();
    kept.kept.set(orderKey(CHAPTERS.id), writeOrder(ids));
    const warned: string[] = [];

    // Act
    const answers = createAnswers(kept, { quietMs: 1 });
    await bindAnswers(window.document as unknown as Document, answers, kept, {
      onUnwritable: (group) => warned.push(group),
    });
    answers.stop();

    // Assert
    const visible = [...window.document.querySelectorAll("[data-instance]")].filter(
      (one) => !(one as unknown as HTMLElement).hidden,
    ).length;
    assert.equal(visible, CHAPTERS.min, "an order that fits the floor revealed the spares");
    assert.deepEqual(warned, [], "a group whose order fits its slots was called unwritable");
  });

  it("bindAnswers_ARevealedInstance_SavesLikeAnyOther", async () => {
    // Arrange — the other tests assert a revealed instance DISPLAYS. Displaying an answer
    // that then cannot be saved is the worse half: the reader dictates into a slot that
    // looks like every other one and the words go nowhere (0008).
    const CHAPTERS = WORKSHEETS.flatMap((w) => w.questions).find((q) => q.id === "day1.chapters");
    assert.ok(CHAPTERS?.kind === "repeat");
    const ids = Array.from({ length: CHAPTERS.max }, (_, i) => `5f1c8e2a-0000-4000-8000-00000000000${i}`);
    window.document.body.innerHTML = renderQuestion(CHAPTERS);
    const kept = store();
    kept.kept.set(orderKey(CHAPTERS.id), writeOrder(ids));
    const answers = createAnswers(kept, { quietMs: 1 });
    await bindAnswers(window.document as unknown as Document, answers, kept);

    // Act — dictate into the LAST instance, which only exists because it was revealed.
    const controls = [...window.document.querySelectorAll("textarea")];
    const last = controls[controls.length - CHAPTERS.fields.length] as unknown as HTMLTextAreaElement;
    last.value = "the eighth chapter, written after it appeared";
    (last as unknown as HTMLElement).dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await answers.flush();
    answers.stop();

    // Assert
    const written = [...kept.kept].filter(([, v]) => v.startsWith("the eighth chapter"));
    assert.equal(written.length, 1, "a revealed slot did not save");
    assert.ok(
      written[0]?.[0].includes(ids[CHAPTERS.max - 1] ?? ""),
      `it saved under the wrong instance: ${written[0]?.[0]}`,
    );
  });

  it("bindAnswers_AGroupWithNothingStored_StillPrintsOnlyTheFloor", async () => {
    // Arrange — negative case, and #74's sixth acceptance criterion. A blank worksheet must
    // be unchanged: the spare instances exist in the markup but a reader who has written
    // nothing should see the same sheet as before.
    const CHAPTERS = WORKSHEETS.flatMap((w) => w.questions).find((q) => q.id === "day1.chapters");
    assert.ok(CHAPTERS?.kind === "repeat");
    window.document.body.innerHTML = renderQuestion(CHAPTERS);
    const kept = store();

    // Act
    const answers = createAnswers(kept, { quietMs: 1 });
    await bindAnswers(window.document as unknown as Document, answers, kept);
    answers.stop();

    // Assert
    const visible = [...window.document.querySelectorAll("[data-instance]")].filter(
      (one) => !(one as unknown as HTMLElement).hidden,
    ).length;
    assert.equal(visible, CHAPTERS.min, "an empty group shows more than the sheet prints");
  });

  it("bindAnswers_EveryBlankOnAPage_ResolvesToADistinctStorageKey", async () => {
    // Arrange — the collision 0013 exists to prevent, checked against the real schema
    // rather than a fixture. Before instances, 264 of the 334 blanks inside repeats shared
    // a key with another blank, so chapter five's title saved over chapter one's.
    const keys = new Set<string>();
    let written = 0;

    // Act — one distinct answer into every blank of every question, then read the store.
    for (const worksheet of WORKSHEETS) {
      for (const question of worksheet.questions) {
        window.document.body.innerHTML = renderQuestion(question);
        const kept = store();
        const answers = createAnswers(kept, { quietMs: 1 });
        await bindAnswers(window.document as unknown as Document, answers, kept);
        const controls = [...window.document.querySelectorAll("textarea")];
        for (const [index, control] of controls.entries()) {
          (control as unknown as HTMLTextAreaElement).value = `answer ${index}`;
          control.dispatchEvent(new window.Event("input", { bubbles: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        await answers.flush();
        for (const [key, value] of kept.kept) {
          if (value.startsWith("answer ")) {
            keys.add(`${question.id}|${key}`);
            written += 1;
          }
        }
        answers.stop();
      }
    }

    // Assert
    assert.equal(keys.size, written, "two blanks resolved to one storage key");
    assert.ok(written > 400, `only ${written} answers stored; every blank should save`);
  });
});
