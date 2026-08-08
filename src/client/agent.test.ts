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
import { renderQuestion } from "../../build/questions.ts";
import { WORKSHEETS } from "../questions/index.ts";
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

/** `Node.DOCUMENT_POSITION_FOLLOWING` — the bit set when the other node comes after this one. */
const DOCUMENT_POSITION_FOLLOWING = 4;

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

describe("the controls against what the build actually renders", () => {
  /**
   * Every fixture above is a hand-written `<p class="q-single">`. That is the seam this suite
   * could not see: narrowing the selector to `p[data-question]` passed every one of them while
   * silently leaving every repeat, group and sentence on the real site without a control —
   * they render as `<ul>`, `<ol>` and `<div>`. src/client/against-the-build.test.ts established
   * this pattern for the field binding after the same class of drift; this is it for the
   * controls.
   */
  function realPage(...ids: readonly string[]): Document {
    const questions = WORKSHEETS.flatMap((worksheet) => worksheet.questions);
    const markup = ids.map((id) => {
      const question = questions.find((one) => one.id === id);
      assert.ok(question !== undefined, `${id} is not in the schema`);
      return renderQuestion(question);
    });
    window.document.body.innerHTML = REGION + markup.join("\n");
    return window.document as unknown as Document;
  }

  it("wireQuestionControls_EveryQuestionKind_GetsAControlAgainstRealMarkup", () => {
    // Arrange — one of each answerable kind, rendered by the build rather than by hand.
    const OF_EACH = ["day4.eulogy", "day1.chapters", "day5.career", "day4.enough_and_more_1"];
    const document = realPage(...OF_EACH);

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, OF_EACH.length);
  });

  it("wireQuestionControls_AControl_IsNeverPlacedInsideAListItsQuestionRenders", () => {
    // Arrange — a repeat renders as `<ol>`/`<ul>`, whose only permitted children are list
    // items, so a button inside one is markup no parser has to keep where it was put. Caught
    // on a device as a placement problem; this is the validity half of the same finding.
    const document = realPage("day1.chapters");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const control = document.querySelector("button.agent-open");
    const question = document.querySelector("[data-question]");

    // Assert
    assert.ok(control !== null && question !== null);
    assert.ok(!question.contains(control), "the control is inside the question's own element");
  });

  it("wireQuestionControls_EachPanel_CarriesItsOwnQuestionsPayload", async () => {
    // Arrange — counting buttons proves a button exists, not that it belongs to the question
    // it sits above. Every panel could have carried the same group's payload and the count
    // would have been right.
    const document = realPage("day4.eulogy", "day1.chapters");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const controls = [...document.querySelectorAll("button.agent-open")];
    assert.equal(controls.length, 2);

    // Act
    for (const control of controls) {
      (control as HTMLElement).click();
    }
    await settle();
    const previews = [...document.querySelectorAll(".agent-preview")].map((one) => one.textContent ?? "");

    // Assert
    assert.ok(previews[0]?.includes('"group": "day4.eulogy"'), "the first panel has the wrong question");
    assert.ok(previews[1]?.includes('"group": "day1.chapters"'), "the second panel has the wrong question");
  });
});

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

  it("bridgeIsOn_TurnedOff_IsOff", () => {
    // Arrange — negative case, and the one that made the feature one-way. Reading the key as
    // "present" rather than "equal to on" passed everything, because no test ever turned it
    // off and read it back.
    // Act & Assert
    assert.equal(bridgeIsOn(memoryStorage("off")), false);
  });

  it("wireAgentPage_UntickingTheBox_RecordsThatItIsOff", async () => {
    // Arrange — the write side had no test for the "off" value at all, so a `setBridge` that
    // always wrote "on" survived: unticking did nothing and the setting came back next load.
    const storage = memoryStorage("on");
    const document = agentPage();
    wireAgentPage(document, storage);
    const toggle = document.getElementById("agent-on") as HTMLInputElement;
    assert.equal(toggle.checked, true, "the switch does not reflect the stored setting");

    // Act
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event("change") as unknown as Event);

    // Assert
    assert.equal(bridgeIsOn(storage), false);
    assert.match(
      document.getElementById("banner-region")?.textContent ?? "",
      /off/i,
      "it did not say what just happened",
    );
  });

  it("wireAgentPage_StorageThatRefusesTheWrite_SaysSoAndDoesNotClaimOtherwise", () => {
    // Arrange — the failure banner was raised and then immediately destroyed by a success
    // banner with the same id, so the reader was told the opposite of the truth. The region
    // holds one message; whichever is written last is the one that is read.
    const document = agentPage();
    wireAgentPage(document, hostileStorage());

    // Act
    const toggle = document.getElementById("agent-on") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change") as unknown as Event);

    // Assert
    const said = document.getElementById("banner-region")?.textContent ?? "";
    assert.match(said, /would not let the setting be saved/i);
    assert.ok(!/Copy buttons are on/.test(said), "it claimed the setting was saved");
    assert.equal(toggle.checked, false, "the switch shows a setting that was not recorded");
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
    const EXPECTED = 2;
    assert.equal(document.querySelectorAll("button.agent-open").length, EXPECTED);
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
      control.compareDocumentPosition(question) & DOCUMENT_POSITION_FOLLOWING,
      DOCUMENT_POSITION_FOLLOWING,
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

  it("wireQuestionControls_APriorAnswerContainingMarkup_IsShownAndNotParsed", async () => {
    // Arrange — the preview shows the reader's own words, and a restored backup is words from
    // a file. Swapping `textContent` for `innerHTML` passed the whole suite, which would make
    // the one surface whose job is showing the literal payload a surface that executes it.
    const MARKUP = "<b>not bold</b>";
    const document = worksheet("day4.eulogy");
    wireQuestionControls(
      document,
      memoryStorage("on"),
      entriesFrom(new Map([["day4.eulogy", MARKUP]])),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    await settle();

    // Act
    const preview = document.querySelector(".agent-preview");

    // Assert
    assert.ok(preview?.textContent?.includes(MARKUP), "the markup is not shown literally");
    assert.equal(preview?.querySelectorAll("b").length, 0, "the payload was parsed as HTML");
  });

  it("wireQuestionControls_WithPriorAnswersIncluded_TheClipboardStillMatchesThePreview", async () => {
    // Arrange — the existing agreement test uses a question with nothing written, where both
    // code paths produce the same string by coincidence. This is the case where they differ:
    // rebuilding the payload at copy time instead of copying what is shown passed before.
    const WRITTEN = "That I showed up for the people who needed it.";
    const document = worksheet("day4.eulogy");
    let written = "";
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: (text: string) => { written = text; return Promise.resolve(); } } },
    });
    wireQuestionControls(
      document,
      memoryStorage("on"),
      entriesFrom(new Map([["day4.eulogy", WRITTEN]])),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    await settle();

    // Act
    const buttons = [...document.querySelectorAll("button")];
    (buttons.find((one) => one.textContent?.includes("Copy")) as HTMLElement).click();
    await settle();

    // Assert
    assert.ok(written.includes(WRITTEN), "the opted-in answer never reached the clipboard");
    assert.equal(written, document.querySelector(".agent-preview")?.textContent);
  });

  it("wireQuestionControls_TheControl_IsShapedAndLabelledForSomebodyUsingIt", async () => {
    // Arrange — a table, because each of these was separately deletable with the suite green
    // and each is the kind of thing that reads as decoration until somebody is relying on it.
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const open = document.querySelector("button.agent-open") as HTMLElement;

    // Act
    open.click();
    await settle();
    const panel = document.querySelector(".agent-panel") as HTMLElement;
    const preview = document.querySelector(".agent-preview") as HTMLElement;
    const copy = [...document.querySelectorAll("button")].find((one) =>
      one.textContent?.includes("Copy"),
    ) as HTMLButtonElement;

    // Assert
    assert.ok((open.textContent ?? "").trim().length > 0, "the button has no visible label");
    assert.match(open.getAttribute("aria-label") ?? "", /Eulogy/, "it is not named for its question");
    assert.equal(open.getAttribute("aria-controls"), panel.id, "the panel is not associated");
    assert.equal(open.getAttribute("aria-expanded"), "true", "opening is not announced");
    assert.equal(preview.tagName, "PRE", "the payload loses its line breaks");
    assert.equal(preview.tabIndex, 0, "a scrollable payload keyboard users cannot reach");
    assert.equal(copy.type, "button", "a submit button inside a form navigates the page away");
    const label = document.querySelector("label");
    assert.ok(label?.querySelector('input[type="checkbox"]') !== null, "the checkbox is unlabelled");
    assert.ok((label?.textContent ?? "").trim().length > 0, "the label says nothing");

    // And it closes again.
    open.click();
    assert.equal(panel.hidden, true, "the panel cannot be closed");
    assert.equal(open.getAttribute("aria-expanded"), "false");
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
    const ONCE = 1;
    assert.equal(document.querySelectorAll(".agent-note").length, ONCE, "it is said more than once");
  });
});
