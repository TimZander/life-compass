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
