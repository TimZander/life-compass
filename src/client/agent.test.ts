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

  it("wireQuestionControls_ACopyThatSucceeds_SaysSo", async () => {
    // Arrange — the feature's primary action gave no assertion at all, so replacing the
    // success handler with an empty function passed: the reader taps the one button this
    // whole feature exists for and gets silence, indistinguishable from a failure.
    const document = worksheet("day4.eulogy");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: () => Promise.resolve() } },
    });
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Act
    const buttons = [...document.querySelectorAll("button")];
    (buttons.find((one) => one.textContent?.includes("Copy")) as HTMLElement).click();
    await settle();

    // Assert
    const region = document.getElementById("banner-region");
    assert.match(region?.textContent ?? "", /Copied/, "a successful copy says nothing");
    assert.match(region?.textContent ?? "", /Dismiss/, "the message cannot be got rid of");
  });

  it("wireQuestionControls_ARebuildInFlight_DoesNotLeaveTheWithdrawnAnswerOnScreen", async () => {
    // Arrange — the defect `generation` was added for, left standing on the other half of the
    // promise. `shown` was cleared before the await so the CLIPBOARD could not send a stale
    // payload; the preview was not, and 0007 · 1 makes the preview the consent surface. A
    // reader who UNTICKS the box watches their own answers sit there for the length of a store
    // read — and for good if it never resolves.
    const WRITTEN = "That I showed up for the people who needed it.";
    const entries = new Map([["day4.eulogy", WRITTEN]]);
    let hold = false;
    // A no-op rather than `null`: assigned only inside the executor below, TypeScript narrows
    // a nullable to `never` at the call site and rejects it.
    let release = (): void => {};
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), () => {
      if (!hold) {
        return Promise.resolve(entries as ReadonlyMap<string, string>);
      }
      return new Promise<ReadonlyMap<string, string>>((resolve) => {
        release = () => resolve(entries);
      });
    });
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    await settle();
    const preview = document.querySelector(".agent-preview") as HTMLElement;
    assert.ok((preview.textContent ?? "").includes(WRITTEN), "the answer never got there");

    // Act — untick, and hold the store read open so the rebuild cannot finish.
    hold = true;
    include.checked = false;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    await settle();

    // Assert
    assert.ok(
      !(preview.textContent ?? "").includes(WRITTEN),
      "the withdrawn answer stayed on the consent surface while the rebuild ran",
    );
    const copy = [...document.querySelectorAll("button")].find((one) =>
      one.textContent?.includes("Copy"),
    );
    assert.equal(copy?.getAttribute("aria-disabled"), "true", "it could still be copied");
    release();
  });

  it("wireQuestionControls_TheStoreRefusingToBeRead_SaysSoRatherThanShowingAThinnerPrompt", async () => {
    // Arrange — negative case. This resolved to an empty Map inside app.ts, which the panel
    // cannot tell apart from "nothing written yet": the reader ticked the box, watched the
    // preview not change, and was told nothing. For a repeat it also drops every instance
    // identifier, which 0015 · C3 forbids and which produces a reply the importer refuses.
    const noisy = console.error;
    console.error = (): void => {};
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), () =>
      Promise.reject(new Error("the store would not open")),
    );

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    console.error = noisy;

    // Assert
    const preview = document.querySelector(".agent-preview");
    assert.match(preview?.textContent ?? "", /could not be read/, "the failure is silent");
    const copy = [...document.querySelectorAll("button")].find((one) =>
      one.textContent?.includes("Copy"),
    );
    assert.equal(copy?.getAttribute("aria-disabled"), "true", "a prompt nobody built is copyable");
  });

  it("wireQuestionControls_ThePanel_PutsThePayloadAheadOfTheConsentAndTheControl", async () => {
    // Arrange — 0007 · 1 is an order as much as a list: nothing may ask the reader to agree to
    // something they have not been shown. Reversing the append left the copy button above the
    // text it copies with the suite green, and the scroll note pointed "below" from underneath
    // the box it described.
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const panel = document.querySelector(".agent-panel") as HTMLElement;
    const order = [...panel.children].map((child) =>
      child.tagName === "BUTTON" ? "button" : (child.className || child.tagName.toLowerCase()),
    );

    // Assert
    assert.deepEqual(order, ["label", "agent-scroll", "agent-preview", "agent-note", "button"]);
  });

  it("wireQuestionControls_APayloadThatFits_DoesNotClaimThereIsMoreBelow", async () => {
    // Arrange — happy-dom has no layout (0014 · C3), so every box measures zero and the note
    // stays hidden. That is the honest outcome to assert here: whether a payload overflows is
    // the one property of this panel only a real device can decide, and the note used to be
    // emitted unconditionally — telling a reader to scroll a box with nothing out of sight.
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Assert
    const note = document.querySelector(".agent-scroll") as HTMLElement;
    assert.equal(note.hidden, true, "it claims there is more to scroll when nothing overflows");
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
    assert.match(
      open.getAttribute("aria-label") ?? "",
      /The eulogy test/,
      "it is not named for its question",
    );
    assert.equal(open.getAttribute("aria-controls"), panel.id, "the panel is not associated");
    assert.equal(open.getAttribute("aria-expanded"), "true", "opening is not announced");
    assert.equal(preview.tagName, "PRE", "the payload loses its line breaks");
    assert.equal(preview.getAttribute("role"), "region", "the payload is not a landmark");
    // The name, not merely A name: `length > 0` accepted "x", and accepted the raw group id
    // this region actually carried — "…copied for day4.eulogy" — inside the panel whose own
    // button goes to lengths to avoid saying that.
    assert.equal(
      preview.getAttribute("aria-label"),
      "The exact text that will be copied for 5. The eulogy test (10 min)",
      "the payload region is unnamed, or named by its identifier",
    );
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

  /** The accessible names on a page, with the fixed prefix stripped. */
  function namesOn(document: Document): string[] {
    return [...document.querySelectorAll("button.agent-open")].map((one) =>
      (one.getAttribute("aria-label") ?? "").replace("Ask an assistant about ", ""),
    );
  }

  it("wireQuestionControls_AQuestionWithoutItsOwnLabel_IsNamedByTheHeadingAboveIt", async () => {
    // Arrange — the ask's FIRST line, which is the heading printed directly above the control.
    // This took the LAST line, the one nearest the anchor, which on day 5 is the tail of a
    // paragraph the five questions share: all five announced "Ask an assistant about gap?".
    // The check that was here — non-empty, and not the literal id — is satisfied by five
    // identical fragments, so it certified the fix while the defect it named got worse.
    const EXPECTED = ["Career", "Money", "Place"];
    const document = worksheet("day5.career", "day5.money", "day5.place");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Assert
    assert.deepEqual(namesOn(document), EXPECTED);
  });

  it("wireQuestionControls_ARepeatQuestion_IsNotNamedByItsSlotLabel", async () => {
    // Arrange — a repeat's `label` names one SLOT: day 2 renders "Value 1", "Value 2"… under
    // four separate groups whose label is all four times "Value". Preferring the label gave
    // that page four identical buttons standing for four different questions, and rigorous
    // day 2 five. The heading is the thing that tells them apart.
    const document = worksheet("day2.shortlist_ten", "day2.shortlist_five", "day2.ranked");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const named = namesOn(document);

    // Assert
    assert.ok(!named.includes("Value"), `named by its slot label: ${named.join(" | ")}`);
    assert.equal(named[0], "2. Narrow to 10 (10 min)");
    assert.equal(new Set(named).size, named.length, `not distinct: ${named.join(" | ")}`);
  });

  it("wireQuestionControls_EveryQuestionOnOnePage_IsNamedDistinctly", async () => {
    // Arrange — the whole purpose of the attribute (0001): a screen reader listing this page's
    // buttons finds five "Ask an assistant" with nothing saying which is which. Distinctness
    // was never asserted, which is how five identical names shipped.
    const GROUPS = ["day5.career", "day5.money", "day5.place", "day5.people", "day5.time"];
    const document = worksheet(...GROUPS);

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const named = namesOn(document);

    // Assert
    assert.equal(named.length, GROUPS.length, "a question lost its control");
    assert.equal(new Set(named).size, GROUPS.length, `not distinct: ${named.join(" | ")}`);
  });

  it("wireQuestionControls_TheSameSentenceAskedTwice_SaysWhichOfThemItIs", async () => {
    // Arrange — day 4 asks one sentence twice on purpose, so the rule above ties honestly and
    // the tie still has to be broken. A `sentence` is named by its own text, with the `{gap}`
    // spelled out: dropping the braces alone inverts it — "the world has enough excess".
    const SENTENCE = "The world has enough blank. It needs more blank.";
    const SECOND = 2;
    const document = worksheet("day4.enough_and_more_1", "day4.enough_and_more_2");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const named = namesOn(document);

    // Assert
    assert.equal(named[0], SENTENCE);
    assert.equal(named[1], `${SENTENCE} (${SECOND})`);
  });

  it("wireQuestionControls_AMarkdownOrOverlongHeading_IsStillReadableAloud", async () => {
    // Arrange — negative case. The ask is Markdown source, so unstripped a screen reader reads
    // "asterisk asterisk Patterns", and uncut the button's name is a 79-character heading.
    // Both mutations survived: nothing asserted either.
    const LONGEST = 60;
    const ELLIPSIS = "…";
    const document = worksheet("day1.drainers", "day1.patterns");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const named = namesOn(document);

    // Assert
    assert.equal(named[0], "5 that drained you:", "the emphasis marks are read out");
    assert.ok(!named.some((one) => /[*_`>#]/.test(one)), `markdown survived: ${named.join(" | ")}`);
    assert.ok((named[1] ?? "").length <= LONGEST, `an unreadable name: ${named[1]}`);
    assert.ok((named[1] ?? "").endsWith(ELLIPSIS), "the name is cut with nothing to signal it");
  });

  it("wireQuestionControls_APanelRebuilding_HoldsTheCopyUntilItHasSomethingToCopy", async () => {
    // Arrange — the store read is asynchronous, so between opening the panel and the payload
    // arriving there is a window where the previous payload was still copyable. With the
    // checkbox just ticked the reader believes their answers travelled when they did not;
    // just unticked, the answers they removed are still on the clipboard. 0007 · 1 makes the
    // preview and the clipboard one value, and this is that promise across time.
    const document = worksheet("day4.eulogy");
    let release: (value: ReadonlyMap<string, string>) => void = () => {};
    const slow = (): Promise<ReadonlyMap<string, string>> =>
      new Promise<ReadonlyMap<string, string>>((resolve) => {
        release = resolve;
      });
    wireQuestionControls(document, memoryStorage("on"), slow);

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    const copy = [...document.querySelectorAll("button")].find((one) =>
      one.textContent?.includes("Copy"),
    ) as HTMLElement;

    // Assert — held while in flight, released once the payload is on screen.
    assert.equal(copy.getAttribute("aria-disabled"), "true", "the copy was live before the text");
    release(new Map());
    await settle();
    assert.equal(copy.getAttribute("aria-disabled"), null, "the copy stayed held after arriving");
  });

  /** Point `navigator` at a clipboard of our choosing, or at none. */
  function withClipboard(clipboard: unknown): void {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
  }

  /** Open a question's panel and hand back the copy button. */
  async function opened(document: Document): Promise<HTMLElement> {
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    return [...document.querySelectorAll("button")].find((one) =>
      one.textContent?.includes("Copy"),
    ) as HTMLElement;
  }

  it("wireQuestionControls_NoClipboardApiAtAll_SaysSoRatherThanFailingSilently", async () => {
    // Arrange — `navigator.clipboard` is undefined outside a secure context, which includes
    // http:// on a LAN address: this project's own device-test path. Reading `.writeText` off
    // it throws before any promise exists, so the reader taps the one button the feature is
    // for and gets nothing at all. The guard existed and had no test.
    const document = worksheet("day4.eulogy");
    withClipboard(undefined);
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Act
    (await opened(document)).click();
    await settle();

    // Assert
    assert.match(
      document.getElementById("banner-region")?.textContent ?? "",
      // The wording specific to "there is no clipboard API here", not the shared tail. Both
      // failure messages end "select it and copy it", so asserting that could not tell the
      // guard being deleted from the guard working.
      /will not copy for us/i,
      "a reader on an insecure origin was told nothing",
    );
  });

  it("wireQuestionControls_AClipboardThatRefuses_SaysSoToo", async () => {
    // Arrange — negative case by the other route: the API exists and the write is denied.
    const document = worksheet("day4.eulogy");
    withClipboard({ writeText: () => Promise.reject(new Error("denied")) });
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Act
    (await opened(document)).click();
    await settle();

    // Assert
    assert.match(document.getElementById("banner-region")?.textContent ?? "", /did not happen/i);
  });

  it("wireQuestionControls_AClipboardThatThrows_IsCaughtRatherThanEscaping", async () => {
    // Arrange — a synchronous throw from `writeText` itself, which is neither of the promise
    // arms and would otherwise escape the click handler entirely.
    const document = worksheet("day4.eulogy");
    withClipboard({
      writeText: () => {
        throw new Error("NotAllowedError");
      },
    });
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Act & Assert
    const copy = await opened(document);
    assert.doesNotThrow(() => copy.click());
    await settle();
    assert.match(document.getElementById("banner-region")?.textContent ?? "", /did not happen/i);
  });

  it("wireQuestionControls_TwoOverlappingRebuilds_ShowTheOneAskedForLast", async () => {
    // Arrange — without a generation token the rebuild that RESOLVES last wins rather than the
    // one that STARTED last. The direction that matters: the reader ticks "include", changes
    // their mind and unticks, and the older read lands afterwards — putting the answers they
    // just withdrew back into the payload they are about to hand over.
    const WITHDRAWN = "An answer I decided not to share";
    const document = worksheet("day4.eulogy");
    const pending: ((value: ReadonlyMap<string, string>) => void)[] = [];
    wireQuestionControls(document, memoryStorage("on"), () =>
      new Promise<ReadonlyMap<string, string>>((resolve) => pending.push(resolve)),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;

    // Act — tick (rebuild with answers), untick (rebuild without), then resolve them in the
    // order that breaks it: the newer first, the older last.
    include.checked = true;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    include.checked = false;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    await settle();
    pending[2]?.(new Map([["day4.eulogy", WITHDRAWN]]));
    await settle();
    pending[1]?.(new Map([["day4.eulogy", WITHDRAWN]]));
    await settle();

    // Assert
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";
    assert.ok(!preview.includes(WITHDRAWN), "a withdrawn answer was painted back by a stale read");
  });

  it("wireQuestionControls_TheCheckboxChangingMidRebuild_IsReadWhenTheRebuildBegan", async () => {
    // Arrange — the state has to be read BEFORE the await, or a rebuild reflects whatever the
    // checkbox happens to say when the store returns rather than what it said when the reader
    // asked. It is correct today only because argument evaluation runs left to right, which is
    // exactly the sort of accident a readability edit undoes.
    const WRITTEN = "Something private";
    const document = worksheet("day4.eulogy");
    const pending: ((value: ReadonlyMap<string, string>) => void)[] = [];
    wireQuestionControls(document, memoryStorage("on"), () =>
      new Promise<ReadonlyMap<string, string>>((resolve) => pending.push(resolve)),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Act — the panel opened with the box unticked; tick it only while that read is in flight.
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    include.checked = true;
    pending[0]?.(new Map([["day4.eulogy", WRITTEN]]));
    await settle();

    // Assert — the rebuild that began unticked must not include the answer.
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";
    assert.ok(!preview.includes(WRITTEN), "an answer travelled that was not asked for when asked");
  });

  it("wireQuestionControls_BeforeItIsOpened_AnnouncesItselfAsCollapsed", () => {
    // Arrange — the shape test checks `aria-expanded` after opening, so the INITIAL value was
    // deletable: a screen reader met a disclosure with no state at all until it had been
    // pressed once, which is the press a reader makes to find out what it is.
    const document = worksheet("day4.eulogy");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Assert
    assert.equal(
      document.querySelector("button.agent-open")?.getAttribute("aria-expanded"),
      "false",
    );
  });

  it("wireQuestionControls_AQuestionThisBuildDoesNotKnow_IsSkippedWithTheRestIntact", () => {
    // Arrange — reachable across a service worker activation, where a page can outlive the
    // schema it was rendered against. Without the skip the lookup throws mid-loop, so every
    // question AFTER the unknown one silently loses its control too.
    const document = worksheet("day9.not_a_question", "day4.eulogy");

    // Act & Assert
    assert.doesNotThrow(() =>
      wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map())),
    );
    assert.equal(
      document.querySelectorAll("button.agent-open").length,
      1,
      "a question after an unknown one lost its control",
    );
  });

  it("wireQuestionControls_RunTwice_DoesNotGiveOneQuestionTwoControls", () => {
    // Arrange — nothing calls this twice today, but it is exported, every test here calls it
    // directly, and #68's paste path will want to re-run it. A second pass gave each question
    // two buttons whose panels shared an id, so `aria-controls` resolved to the wrong one.
    const document = worksheet("day4.eulogy");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, 1);
    assert.equal(document.querySelectorAll(".agent-panel").length, 1);
  });

  it("wireQuestionControls_EveryPanel_HasAnIdentifierOfItsOwn", async () => {
    // Arrange — one shared id makes every button's `aria-controls` resolve to the first panel,
    // so a screen reader following the relationship lands on another question's payload.
    const document = worksheet("day4.eulogy", "day1.patterns");

    // Act
    wireQuestionControls(document, memoryStorage("on"), entriesFrom(new Map()));
    const ids = [...document.querySelectorAll(".agent-panel")].map((one) => one.id);
    const controls = [...document.querySelectorAll("button.agent-open")].map(
      (one) => one.getAttribute("aria-controls") ?? "",
    );

    // Assert
    assert.equal(new Set(ids).size, ids.length, "two panels share one id");
    assert.deepEqual(controls, ids, "a button points at a panel that is not its own");
  });

  it("wireQuestionControls_ACopyTakenMidRebuild_SendsNothingRatherThanTheOldPayload", async () => {
    // Arrange — the correctness half of the race guard. The affordance was pinned; this is the
    // behaviour. With the checkbox just ticked, copying before the rebuild lands would send the
    // payload WITHOUT the answers while the reader believes they travelled — and just unticked,
    // it would send the answers they removed. 0007 · 1 makes the preview and the clipboard one
    // value, and this is that promise while a rebuild is in flight.
    const WRITTEN = "Something I did not mean to share";
    const document = worksheet("day4.eulogy");
    let written = "";
    withClipboard({ writeText: (text: string) => { written = text; return Promise.resolve(); } });
    let release: (value: ReadonlyMap<string, string>) => void = () => {};
    const answers = new Map([["day4.eulogy", WRITTEN]]);
    let first = true;
    wireQuestionControls(document, memoryStorage("on"), () => {
      if (first) {
        first = false;
        return Promise.resolve(answers);
      }
      return new Promise<ReadonlyMap<string, string>>((resolve) => {
        release = resolve;
      });
    });
    const copy = await opened(document);

    // Act — start a second rebuild and try to copy before it resolves.
    const include = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change") as unknown as Event);
    copy.click();
    await settle();

    // Assert
    assert.equal(written, "", "a payload was copied while the panel was still rebuilding");
    release(answers);
    await settle();
    copy.click();
    await settle();
    assert.ok(written.includes(WRITTEN), "the settled payload was never copyable");
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
