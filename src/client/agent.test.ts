/**
 * The assistant bridge's controls.
 *
 * `happy-dom` has no layout (docs/decisions/0014 · C3), so these prove the controls exist,
 * carry the right text, and put the right value on the clipboard. Whether a reader can see or
 * reach them is a device question, and this file cannot answer it.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";
import { wireAgentPage, wireQuestionControls } from "./agent.ts";
import { bridgeIsOn } from "./bridge.ts";
import { ASKS } from "./schema.ts";

let window: Window;

before(() => {
  window = new Window();
  const scope = globalThis as unknown as Record<string, unknown>;
  scope["document"] = window.document;
  scope["HTMLElement"] = window.HTMLElement;
  scope["HTMLInputElement"] = window.HTMLInputElement;
  scope["Event"] = window.Event;
});

after(() => {
  void window.close();
});

/** A storage that behaves, and one that refuses everything the way private browsing has. */
function memoryStorage(initial?: string): Storage {
  const held = new Map<string, string>(initial === undefined ? [] : [["life-compass:assistant", initial]]);
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
    clear: () => held.clear(),
    key: () => null,
    get length() {
      return held.size;
    },
  } as Storage;
}

function hostileStorage(): Storage {
  return {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  } as unknown as Storage;
}

/** Let the panel's asynchronous rebuild settle. It reads the store when it opens. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
  }
}

/** Panels read the store when they open, so a test hands over a reader rather than a map. */
function entriesFrom(entries: ReadonlyMap<string, string>): () => Promise<ReadonlyMap<string, string>> {
  return () => Promise.resolve(entries);
}

/** The live region the layout emits, so banner messages have somewhere to go. */
const REGION = '<div id="banner-region" role="status" aria-live="polite"></div>';

function agentPage(): Document {
  window.document.body.innerHTML = `${REGION}
<section class="tools" id="agent" hidden>
  <label><input type="checkbox" id="agent-on"> Show the copy buttons</label>
</section>`;
  return window.document as unknown as Document;
}

function worksheet(...groups: string[]): Document {
  window.document.body.innerHTML =
    REGION + groups.map((id) => `<p class="q-single" data-question="${id}">x</p>`).join("\n");
  return window.document as unknown as Document;
}

describe("the opt-in", () => {
  it("bridgeIsOn_NothingStored_IsOff", () => {
    // Arrange — the default, and the whole argument. A reader who never asks for this sees an
    // unchanged worksheet, which is what makes 0007's "the user's choice becomes real" true
    // of the interface rather than only of the network.
    // Act & Assert
    assert.equal(bridgeIsOn(memoryStorage()), false);
  });

  it("bridgeIsOn_StorageThrows_IsOff", () => {
    // Arrange — negative case. Storage can throw outright; Safari in private browsing has.
    // A bridge that cannot remember its setting must fail to OFF, which is the direction that
    // cannot surprise anybody.
    // Act & Assert
    assert.equal(bridgeIsOn(hostileStorage()), false);
  });

  it("wireAgentPage_TheToggle_ReflectsAndRecordsTheSetting", () => {
    // Arrange
    const storage = memoryStorage();
    const document = agentPage();

    // Act
    wireAgentPage(document, storage);
    const toggle = document.getElementById("agent-on") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change") as unknown as Event);

    // Assert
    assert.equal(bridgeIsOn(storage), true);
    assert.equal(document.getElementById("agent")?.hidden, false, "the section stayed hidden");
  });

  it("wireAgentPage_AnyOtherPage_DoesNothing", () => {
    // Arrange — negative case. Every page loads this module; only one carries the control,
    // and its absence is ordinary rather than a fault to report.
    window.document.body.innerHTML = REGION;

    // Act & Assert
    assert.doesNotThrow(() =>
      wireAgentPage(window.document as unknown as Document, memoryStorage()),
    );
  });
});

describe("the copy control on a question", () => {
  it("wireQuestionControls_BridgeOff_AddsNothingAtAll", () => {
    // Arrange — the point of the opt-in. Not hidden, not disabled: absent.
    const document = worksheet("day4.eulogy");

    // Act
    wireQuestionControls(document, memoryStorage(), entriesFrom(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button").length, 0);
  });

  it("wireQuestionControls_BridgeOn_GivesEveryQuestionAControl", () => {
    // Arrange
    const document = worksheet("day4.eulogy", "day1.patterns");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, 2);
  });

  it("wireQuestionControls_TheControl_SitsAboveTheQuestionRatherThanAfterIt", () => {
    // Arrange — found on a device. Appended, the control landed after every field, so on
    // Day 1's five chapters a reader met it having already written by hand the thing it
    // offered to help with. It is also the only valid placement: `q-group`, `q-checklist`
    // and one shape of `q-repeat` are `<ul>`/`<ol>`, whose only permitted children are list
    // items, so a button inside them is markup no parser has to keep where it was put.
    const document = worksheet("day1.chapters");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const control = document.querySelector("button.agent-open");
    const question = document.querySelector("[data-question]");

    // Assert
    assert.ok(control !== null && question !== null);
    assert.equal(question.previousElementSibling?.className, "agent-panel", "the panel is misplaced");
    assert.ok(!question.contains(control), "the control is inside the question's own element");
    assert.equal(
      control.compareDocumentPosition(question) & 4,
      4,
      "the control does not come before the question",
    );
  });

  it("wireQuestionControls_AChecklist_GetsNoControl", () => {
    // Arrange — 0015 keeps checklists out of the contract, so a button there could only
    // produce a refusal. Skipped rather than offered and then refused.
    const checklist = Object.keys(ASKS).find((id) => id === "day5.ready") ?? "day5.ready";
    const document = worksheet(checklist);

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, 0);
  });

  it("wireQuestionControls_Opened_ShowsTheLiteralPayloadIncludingTheQuestion", async () => {
    // Arrange — 0007 · 1 wants the exact text previewed, not a description of it. The
    // question itself being in there is what #75 made possible and what the whole feature is
    // for; before it, this preview would have read "A single answer: **Eulogy**".
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert
    assert.ok(preview.includes(ASKS["day4.eulogy"] ?? " "), "the question is not previewed");
    assert.ok(preview.includes("one question per message"), "the interview brief is not previewed");
  });

  it("wireQuestionControls_Copied_PutsTheExactPreviewedTextOnTheClipboard", async () => {
    // Arrange — the agreement, not either side of it. 0007 · 1 means nothing if the preview
    // and the clipboard are built twice and happen to match.
    const document = worksheet("day4.eulogy");
    let written = "";
    // `navigator` is a getter on the Node global, so it is defined rather than assigned.
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: (text: string) => {
            written = text;
            return Promise.resolve();
          },
        },
      },
    });
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Act
    const buttons = [...document.querySelectorAll("button")];
    (buttons.find((one) => one.textContent?.includes("Copy")) as HTMLElement).click();
    await Promise.resolve();

    // Assert
    assert.equal(written, document.querySelector(".agent-preview")?.textContent);
    assert.ok(written.length > 0, "nothing was copied");
  });

  it("wireQuestionControls_PriorAnswers_AreOffUntilAskedFor", async () => {
    // Arrange — 0007 · 2. Generating a prompt for one question must never quietly bundle
    // what the reader wrote elsewhere, and the default has to be off rather than a setting
    // somebody has to find.
    const WRITTEN = "That I showed up for the people who needed it.";
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map([["day4.eulogy", WRITTEN]])));
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Act
    const before = document.querySelector(".agent-preview")?.textContent ?? "";
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    await settle();
    const after = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert
    assert.ok(!before.includes(WRITTEN), "an answer travelled without being asked for");
    assert.ok(after.includes(WRITTEN), "opting in did not include the answer");
  });

  it("wireQuestionControls_TheCopyControl_CarriesOnePlainSentenceAboutWhereItGoes", async () => {
    // Arrange — 0007 · 3 and · 4: one sentence at the control, said once, rather than a
    // confirmation on every copy that trains people to dismiss it.
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Act
    const note = document.querySelector(".agent-note")?.textContent ?? "";

    // Assert
    assert.match(note, /exactly what goes to your clipboard/i);
    assert.equal(document.querySelectorAll(".agent-note").length, 1, "it is said more than once");
  });
});
