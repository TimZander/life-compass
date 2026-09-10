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
import { savedNote, wireAgentPage, wireQuestionControls, type BridgeOptions } from "./agent.ts";
import type { Store } from "./store.ts";
import { nameFor } from "./prompt.ts";
import { renderQuestion } from "../../build/questions.ts";
import { buildPages } from "../../build/build.ts";
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

/**
 * Everything the bridge needs, built around a store that holds `entries`.
 *
 * Panels read the store when they open, so a test hands over a reader rather than a map. The
 * three fields the paste half needs get harmless defaults: a test that never brings a reply
 * back should not have to say what happens after a save, and a store that rejects is the
 * honest stand-in for a fixture that has none.
 */
function bridgeReading(
  entries: ReadonlyMap<string, string>,
  overrides: Partial<BridgeOptions> = {},
): BridgeOptions {
  return {
    readEntries: overrides.readEntries ?? (() => Promise.resolve(entries)),
    openStore: overrides.openStore ?? (() => Promise.reject(new Error("this fixture has no store"))),
    onSaved: overrides.onSaved ?? (() => undefined),
    reload: overrides.reload ?? (() => undefined),
  };
}

/** A bridge whose reader is spelled out, for the tests about slow or failing reads. */
function bridgeWith(readEntries: BridgeOptions["readEntries"]): BridgeOptions {
  return bridgeReading(new Map(), { readEntries });
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

/** The built site, once. Reading the real pages is what a hand-written fixture cannot do. */
let built: ReturnType<typeof buildPages> | undefined;
function site(): ReturnType<typeof buildPages> {
  built ??= buildPages({});
  return built;
}

/** What `nameFor` calls a question — what an item with no usable heading falls back to. */
function nameForFirstQuestion(group: string): string {
  const question = WORKSHEETS.flatMap((one) => one.questions).find((one) => one.id === group);
  assert.ok(question !== undefined, `${group} is not in the schema`);
  return nameFor(question, group);
}

/** The accessible names on a page, with the fixed prefix stripped. */
function namesOn(document: Document): string[] {
  return [...document.querySelectorAll("button.agent-open")].map((one) =>
    (one.getAttribute("aria-label") ?? "").replace("Ask an assistant about ", ""),
  );
}

function worksheet(...groups: string[]): Document {
  window.document.body.innerHTML =
    REGION + groups.map((id) => `<p class="q-single" data-question="${id}">x</p>`).join("\n");
  return window.document as unknown as Document;
}

/**
 * A page of numbered items, the way the build stamps one.
 *
 * `[slug, heading, ...groups]` per item: the heading carries the slug as its `id`, and every
 * question of the item carries the slug as `data-section` — which is exactly what
 * build/questions.ts emits (#93) and the only thing the client can group on. A fixture without
 * it cannot tell one control per item from one per question, which is the whole of #82.
 */
function numbered(...items: readonly (readonly [slug: string, heading: string, ...groups: string[]])[]): Document {
  const markup = items.map(([slug, heading, ...groups]) => {
    const questions = groups
      .map((id) => `<p class="q-single" data-question="${id}" data-section="${slug}">x</p>`)
      .join("\n");
    return `<h2 id="${slug}">${heading}</h2>\n${questions}`;
  });
  window.document.body.innerHTML = REGION + markup.join("\n");
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

  it("wireQuestionControls_DayFourAsTheBuildRendersIt_HasFiveControlsNotFourteen", async () => {
    // Arrange — #82's first acceptance criterion, against the page the build actually emits
    // rather than a fixture. Day 4 was found on a device rendering FOURTEEN controls for five
    // numbered items: four separate buttons under "3. The contribution question (15 min)"
    // inviting four separate conversations about what the page presents as one exercise.
    const { pages } = await site();
    const day4 = pages.find((page) => page.source === "days/day-4-purpose.md");
    assert.ok(day4 !== undefined, "day 4 is no longer built");
    const QUESTIONS = 14;
    const ITEMS = 5;
    window.document.body.innerHTML = REGION + day4.html;
    const document = window.document as unknown as Document;
    assert.equal(
      document.querySelectorAll("[data-question]").length,
      QUESTIONS,
      "day 4 no longer renders the fourteen questions this grouping exists to gather",
    );

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert — five, and named for the five tasks the page prints.
    assert.deepEqual(namesOn(document), [
      "1. Unfair advantages (15 min)",
      "2. Who and what (20 min)",
      "3. The contribution question (15 min)",
      "4. Draft three purpose statements (20 min)",
      "5. The eulogy test (10 min)",
    ]);
    assert.equal([...document.querySelectorAll("button.agent-open")].length, ITEMS);
  });

  it("wireQuestionControls_EveryNumberedItemOnEveryPage_PutsItsControlAtTheItemsOwnLevel", async () => {
    // Arrange — the assertion the fixtures cannot make, and the one that caught a real defect.
    // `numbered()` emits flat `<p>` siblings; the workbook does not. Eleven controls landed
    // INSIDE a `<li>` or a `<blockquote>`, because that is where the item's first question
    // sits — one control indented inside bullet one while speaking for bullets one to three,
    // which is the reading #82 exists to fix arriving by another road.
    //
    // Directly under the numbered heading it is named after — every one, on every page. That is
    // what makes a control belong to the item rather than to whichever of its questions happens
    // to come first, and it is the one placement no worksheet's prose, labels, quotes or
    // sub-headings can push it out of. `happy-dom` has no layout (0014 · C3), so this proves
    // the DOM relationship and says nothing about how it looks.
    const { pages } = await site();
    let checked = 0;

    // Act & Assert
    for (const page of pages) {
      if (page.source.startsWith("docs/")) {
        continue;
      }
      window.document.body.innerHTML = REGION + page.html;
      const document = window.document as unknown as Document;
      wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
      for (const control of document.querySelectorAll("button.agent-open")) {
        const panel = control.nextElementSibling;
        assert.ok(
          panel?.classList.contains("agent-panel"),
          `${page.source}: a control is not followed by its panel`,
        );
        const covered = panel?.nextElementSibling ?? null;
        assert.ok(covered !== null, `${page.source}: a control sits above nothing`);
        // Which item this control is for, taken from the panel it opens rather than guessed from
        // its name — the orphan's name happens to be its page's own `<h1>`, so matching on text
        // called it an item and asserted the wrong thing about it.
        const id = (control.getAttribute("aria-controls") ?? "").replace("agent-panel-", "");
        if (document.querySelector(`[data-section="${id}"]`) === null) {
          // No question carries this id as a section, so it is the orphan: no numbered heading
          // to sit under, and its control stays immediately above the question itself.
          assert.equal(
            control.nextElementSibling?.nextElementSibling?.getAttribute("data-question"),
            id,
            `${page.source}: the orphan's control is not above its own question`,
          );
          continue;
        }
        const heading = document.getElementById(id);
        assert.ok(heading !== null, `${page.source}: no heading for the item ${id}`);
        const named = (control.getAttribute("aria-label") ?? "").replace("Ask an assistant about ", "");
        checked += 1;
        // `assert.ok` on the identity, never `assert.equal` on the nodes: a failing `equal`
        // serialises both DOM elements into its diff, and a happy-dom element carries its whole
        // subtree — the process is killed building the message rather than reporting it.
        assert.ok(
          control.previousElementSibling === heading,
          `${page.source}: "${named}" sits under <${control.previousElementSibling?.tagName ?? "nothing"}>, not under its heading`,
        );
      }
    }
    assert.ok(checked > 50, `only ${checked} controls were checked against a heading`);
  });

  it("wireQuestionControls_EveryQuestionKind_GetsAControlAgainstRealMarkup", () => {
    // Arrange — one of each answerable kind, rendered by the build rather than by hand.
    const OF_EACH = ["day4.eulogy", "day1.chapters", "day5.career", "day4.enough_and_more_1"];
    const document = realPage(...OF_EACH);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, OF_EACH.length);
  });

  it("wireQuestionControls_AControl_IsNeverPlacedInsideAListItsQuestionRenders", () => {
    // Arrange — a repeat renders as `<ol>`/`<ul>`, whose only permitted children are list
    // items, so a button inside one is markup no parser has to keep where it was put. Caught
    // on a device as a placement problem; this is the validity half of the same finding.
    const document = realPage("day1.chapters");

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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

  it("wireQuestionControls_EachControl_AsksAboutItsOwnQuestionAndNoOther", async () => {
    // Arrange — #82 turned `promptFor` into a function over a LIST of questions, and nothing
    // here held this call site to passing one. Duplicating the part — two entries for the same
    // question, which is what a careless read of the next slice would produce — left every
    // assertion above green while the panel offered "Question 1 of 2" and asked for two blocks
    // about one question. A reply to that is refused by `readBlocks` as a repeated group, so
    // the reader would interview, paste, and be told no.
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement | null)?.click();
    await settle();
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert — one question, so the one-question prompt, down to it not being numbered.
    assert.ok(preview.includes('"group": "day4.eulogy"'), "the panel has the wrong question");
    assert.ok(!preview.includes("Question 1 of"), "one control asked about more than one question");
    assert.equal(
      (preview.match(/```/g) ?? []).length,
      2,
      "one control asked for more than one block back",
    );
    // And a single question is not framed as an item. This fixture carries no `data-section`,
    // so it is the orphan path, where the name comes from `nameFor` — a clipped first line of
    // one question's ask, which is not what a worksheet calls a numbered item.
    assert.ok(
      !preview.includes("one numbered item of the worksheet"),
      "a single question was framed as a numbered item",
    );
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
    wireQuestionControls(document, memoryStorage(), bridgeReading(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button").length, 0);
  });

  it("wireQuestionControls_BridgeOn_GivesEveryQuestionAControl", () => {
    // Arrange
    const document = worksheet("day4.eulogy", "day1.patterns");

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, 0);
  });

  it("wireQuestionControls_Opened_ShowsTheLiteralPayloadIncludingTheQuestion", async () => {
    // Arrange — 0007 · 1 wants the exact text previewed, not a description of it. The
    // question itself being in there is what #75 made possible and what the whole feature is
    // for; before it, this preview would have read "A single answer: **Eulogy**".
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map([["day4.eulogy", WRITTEN]])));
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
      bridgeReading(new Map([["day4.eulogy", MARKUP]])),
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
      bridgeReading(new Map([["day4.eulogy", WRITTEN]])),
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeWith(() => {
      if (!hold) {
        return Promise.resolve(entries as ReadonlyMap<string, string>);
      }
      return new Promise<ReadonlyMap<string, string>>((resolve) => {
        release = () => resolve(entries);
      });
    }));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeWith(() =>
      Promise.reject(new Error("the store would not open")),
    ));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const panel = document.querySelector(".agent-panel") as HTMLElement;
    const naming = (child: Element): string =>
      child.tagName === "BUTTON" ? "button" : (child.className || child.tagName.toLowerCase());
    const halves = [...panel.children].map(naming);
    const prompt = document.querySelector(".agent-prompt") as HTMLElement;
    const order = [...prompt.children].map(naming);

    // Assert — the guarantee is unchanged by #110 splitting the panel in two, it just sits one
    // level down: the swap to the reply half is the last thing in the prompt half, after the
    // control it is an alternative to.
    assert.deepEqual(halves, ["agent-prompt", "agent-reply"]);
    assert.deepEqual(order, [
      "label",
      "agent-scroll",
      "agent-preview",
      "agent-note",
      "button",
      "button",
    ]);
  });

  it("wireQuestionControls_APayloadThatFits_DoesNotClaimThereIsMoreBelow", async () => {
    // Arrange — happy-dom has no layout (0014 · C3), so every box measures zero and the note
    // stays hidden. That is the honest outcome to assert here: whether a payload overflows is
    // the one property of this panel only a real device can decide, and the note used to be
    // emitted unconditionally — telling a reader to scroll a box with nothing out of sight.
    const document = worksheet("day4.eulogy");
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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

  it("wireQuestionControls_AQuestionWithoutItsOwnLabel_IsNamedByTheHeadingAboveIt", async () => {
    // Arrange — the ask's FIRST line, which is the heading printed directly above the control.
    // This took the LAST line, the one nearest the anchor, which on day 5 is the tail of a
    // paragraph the five questions share: all five announced "Ask an assistant about gap?".
    // The check that was here — non-empty, and not the literal id — is satisfied by five
    // identical fragments, so it certified the fix while the defect it named got worse.
    const EXPECTED = ["Career", "Money", "Place"];
    const document = worksheet("day5.career", "day5.money", "day5.place");

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
    const named = namesOn(document);

    // Assert
    assert.equal(named.length, GROUPS.length, "a question lost its control");
    assert.equal(new Set(named).size, GROUPS.length, `not distinct: ${named.join(" | ")}`);
  });

  it("wireQuestionControls_ANumberedItemOfSeveralQuestions_GetsOneControlAboveItsFirst", async () => {
    // Arrange — the whole of #82, found on a device: day 4 rendered fourteen controls for five
    // numbered items, so the bridge offered fourteen conversations about five tasks. Placement
    // matters as much as the count — a control below the questions it covers is one a reader
    // meets having already written by hand the thing it offered to help with.
    const ONE = 1;
    const document = numbered([
      "1-unfair-advantages-15-min",
      "1. Unfair advantages (15 min)",
      "day4.skills",
      "day4.experiences",
      "day4.networks",
    ]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    const controls = [...document.querySelectorAll("button.agent-open")];
    assert.equal(controls.length, ONE, `three questions of one item got ${controls.length} controls`);
    const first = document.querySelector('[data-question="day4.skills"]');
    assert.equal(
      first?.previousElementSibling?.previousElementSibling,
      controls[0],
      "the control does not sit above the item's first question",
    );
  });

  it("wireQuestionControls_TwoNumberedItems_GetOneControlEach", async () => {
    // Arrange — negative case for the grouping. Bucketing everything into one control would
    // pass a count-of-one assertion on a single item, and would offer one conversation for a
    // whole page.
    const TWO = 2;
    const document = numbered(
      ["1-unfair-advantages-15-min", "1. Unfair advantages (15 min)", "day4.skills", "day4.experiences"],
      ["2-who-and-what-20-min", "2. Who and what (20 min)", "day4.who", "day4.problem"],
    );

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.deepEqual(namesOn(document), ["1. Unfair advantages (15 min)", "2. Who and what (20 min)"]);
    const panels = [...document.querySelectorAll(".agent-panel")].map((one) => one.id);
    assert.equal(new Set(panels).size, TWO, `two items share a panel id: ${panels.join(", ")}`);
  });

  it("wireQuestionControls_AnItemOfSeveralQuestions_AsksAboutThemInPageOrder", async () => {
    // Arrange — `promptFor` numbers the questions "Question N of M" by their position in the
    // list it is given, and tells the assistant to work through them in that order because the
    // worksheet's order is how the exercise builds. Nothing in the signature enforces it, so
    // the client is the only thing that can get it right — and reversing the list here left
    // every assertion green, because membership was all that was checked.
    const IN_ORDER = ["day4.who", "day4.problem", "day4.changes"];
    const document = numbered(["2-who-and-what-20-min", "2. Who and what (20 min)", ...IN_ORDER]);
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement | null)?.click();
    await settle();
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert
    assert.deepEqual(
      [...preview.matchAll(/^### Question \d+ of \d+ — `([^`]+)`$/gm)].map((one) => one[1]),
      IN_ORDER,
      "the questions reached the prompt out of page order",
    );
  });

  it("wireQuestionControls_AnItemOfSeveralQuestions_CarriesEachQuestionsOwnAnswers", async () => {
    // Arrange — one prior per question, matched to its own question. Reading them all from the
    // item's FIRST question survived the suite, because every prior test until now used a
    // one-question page where every reading is the same reading. On a real item that puts one
    // question's stored answers — and, for a repeat, its instance identifiers — under another
    // question's heading, which 0015 · C3 is written to prevent.
    const MINE = "What I wrote for the first one.";
    const OTHER = "And something else entirely for the second.";
    const document = numbered([
      "2-who-and-what-20-min",
      "2. Who and what (20 min)",
      "day4.who",
      "day4.problem",
    ]);
    const stored = new Map([["day4.who", MINE], ["day4.problem", OTHER]]);
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(stored));

    // Act — with the answers opted in.
    (document.querySelector("button.agent-open") as HTMLElement | null)?.click();
    await settle();
    const include = document.querySelector(".agent-panel input") as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    await settle();
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert — each under its own question, not both under the first.
    const [, first = "", second = ""] = preview.split(/^### Question \d+ of \d+ — `[^`]+`$/gm);
    assert.ok(first.includes(MINE), "the first question lost its own answer");
    assert.ok(second.includes(OTHER), "the second question did not get its own answer");
    assert.ok(!second.includes(MINE), "one question's answer was carried under another's heading");
  });

  it("wireQuestionControls_AnItemAlreadyWired_DoesNotStopTheOnesAfterIt", async () => {
    // Arrange — partial idempotency, which the run-twice test cannot see because it uses a page
    // of one item where skipping and stopping are the same thing. #68's paste path re-runs this
    // over a page that may be part-wired; `return` instead of `continue` in the guard then
    // leaves every item after the first one without a control.
    const TWO = 2;
    const document = numbered(
      ["1-unfair-advantages-15-min", "1. Unfair advantages (15 min)", "day4.skills"],
      ["2-who-and-what-20-min", "2. Who and what (20 min)", "day4.who"],
    );
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
    // Take the SECOND item's control away, as though it had never been wired.
    const controls = [...document.querySelectorAll("button.agent-open")];
    controls[1]?.nextElementSibling?.remove();
    controls[1]?.remove();

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.equal(
      [...document.querySelectorAll("button.agent-open")].length,
      TWO,
      "the item after an already-wired one was skipped",
    );
    assert.deepEqual(namesOn(document), ["1. Unfair advantages (15 min)", "2. Who and what (20 min)"]);
  });

  it("wireQuestionControls_AControl_IsNamedAndWiredToThePanelForItsItem", async () => {
    // Arrange — three things `namesOn` cannot see because it strips the prefix before asserting:
    // that the label says what the button DOES, that the panel's id is derived from the item
    // rather than merely unique, and that the preview region is named for the item too. All
    // three survived a mutation while the names still read correctly.
    const SLUG = "2-who-and-what-20-min";
    const HEADING = "2. Who and what (20 min)";
    const document = numbered([SLUG, HEADING, "day4.who", "day4.problem"]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    const control = document.querySelector("button.agent-open");
    assert.equal(control?.getAttribute("aria-label"), `Ask an assistant about ${HEADING}`);
    assert.equal(control?.getAttribute("aria-controls"), `agent-panel-${SLUG}`);
    assert.equal(document.querySelector(".agent-panel")?.id, `agent-panel-${SLUG}`);
    assert.equal(
      document.querySelector(".agent-preview")?.getAttribute("aria-label"),
      `The exact text that will be copied for ${HEADING}`,
    );
  });

  it("wireQuestionControls_AHeadingCarryingMarkup_IsNamedByItsWordsAlone", async () => {
    // Arrange — rigorous day 3 emphasises a word in its heading, so the element really is
    // `<h2 id="…">4. The hypothetical — weighted <em>least</em> (15 min)</h2>`. Reading it as
    // `innerHTML` survived the suite and would have a screen reader announce the tags.
    const document = numbered([
      "4--the-hypothetical--weighted-least-15-min",
      "4. The hypothetical — weighted <em>least</em> (15 min)",
      "rday3.hypothetical",
      "rday3.reconciling",
    ]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.deepEqual(namesOn(document), ["4. The hypothetical — weighted least (15 min)"]);
  });

  it("wireQuestionControls_AnItemWhoseHeadingSaysNothing_FallsBackToTheQuestionsOwnName", async () => {
    // Arrange — an empty heading is not a name. `name ?? nameFor(...)` survived, and an empty
    // string is not `undefined`: the control would have been called "Ask an assistant about "
    // and the prompt would have printed the item as `****`.
    const document = numbered(["2-who-and-what-20-min", "   ", "day4.who", "day4.problem"]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    const named = namesOn(document)[0] ?? "";
    assert.notEqual(named, "", "the control was left with no name at all");
    assert.equal(named, nameForFirstQuestion("day4.who"), "it did not fall back to the question's own name");
  });

  it("wireQuestionControls_AnItemWithSubHeadings_PutsItsControlAboveThemAll", async () => {
    // Arrange — day 5 asks one question under each of five `###` dimensions (Career, Money,
    // Place, People, Time) inside ONE numbered item. Anything that places the control against
    // the item's content puts it under "Career", so the other four read as having no control at
    // all — the reader sees the offer once, attached to a quarter of the task. #93 established
    // that those sub-headings do not split the item; this is the same fact from the reader's
    // side, and it is why the control sits under the numbered heading rather than anywhere
    // among the item's own prose, labels and sub-headings.
    window.document.body.innerHTML = `${REGION}
<h2 id="2-test">2. Test against the five dimensions (40 min)</h2>
<p>For each dimension, ask where the gap is.</p>
<h3>Career</h3>
<p class="q-single" data-question="day5.career" data-section="2-test">x</p>
<h3>Money</h3>
<p class="q-single" data-question="day5.money" data-section="2-test">x</p>`;
    const document = window.document as unknown as Document;

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert — directly under the numbered heading, with everything the item holds below it.
    const control = document.querySelector("button.agent-open");
    assert.equal(control?.previousElementSibling?.tagName, "H2", "the control is not under the numbered heading");
    const panel = control?.nextElementSibling;
    assert.equal(panel?.nextElementSibling?.tagName, "P", "the item's own prose no longer follows the control");
    assert.ok(
      [...document.querySelectorAll("h3")].every(
        (one) => (one.compareDocumentPosition(control as Node) & DOCUMENT_POSITION_FOLLOWING) === 0,
      ),
      "a sub-heading of this item comes before its control",
    );
  });

  it("wireQuestionControls_AQuestionInNoNumberedItem_KeepsItsOwnControl", async () => {
    // Arrange — one question in the workbook sits outside every numbered heading:
    // `values.additions`, on a reference page with no headings at all. build.test.ts pins it by
    // name as the single exception, and it has to keep the control it has today rather than
    // being swept in with whatever happens to precede it.
    const ONE = 1;
    const document = worksheet("values.additions");

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    const named = namesOn(document);
    assert.equal(named.length, ONE);
    assert.ok((named[0] ?? "") !== "", "the orphan control has no name");
  });

  it("wireQuestionControls_AnItemHoldingAChecklist_CoversTheOtherQuestionsAndSkipsIt", async () => {
    // Arrange — 0015 keeps checklists out of the contract, and dropping the whole CONTAINER is
    // what this slice changes: over an item, that would have cost the reader every question
    // beside the readiness ticks. No numbered item in the workbook mixes the two today, so
    // only a fixture can reach it — which is why it is a fixture rather than a sweep.
    const ONE = 1;
    const document = numbered([
      "1-assemble-your-compass-20-min",
      "1. Assemble your compass (20 min)",
      "day5.ready",
      "day5.career",
    ]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
    (document.querySelector("button.agent-open") as HTMLElement | null)?.click();
    await settle();

    // Assert
    assert.equal([...document.querySelectorAll("button.agent-open")].length, ONE);
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";
    assert.ok(preview.includes("day5.career"), "the answerable question was dropped with the checklist");
    assert.ok(!preview.includes("day5.ready"), "the checklist was offered to an assistant");
  });

  it("wireQuestionControls_AnItemOfNothingButAChecklist_GetsNoControl", async () => {
    // Arrange — two real items hold nothing else (day 5's "Assemble your compass", rigorous
    // day 0's "Pull objective data"). A control there could only ever produce a refusal.
    const NONE = 0;
    const document = numbered([
      "1-assemble-your-compass-20-min",
      "1. Assemble your compass (20 min)",
      "day5.ready",
    ]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.equal([...document.querySelectorAll("button.agent-open")].length, NONE);
  });

  it("wireQuestionControls_AnItemOfSeveralQuestions_AsksAboutEveryOneOfThem", async () => {
    // Arrange — the control covering an item is only worth anything if the PROMPT does too.
    // Counting buttons proves a button exists, not that it carries the questions under it.
    const document = numbered([
      "2-who-and-what-20-min",
      "2. Who and what (20 min)",
      "day4.who",
      "day4.problem",
      "day4.changes",
    ]);
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement | null)?.click();
    await settle();
    const preview = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert
    for (const group of ["day4.who", "day4.problem", "day4.changes"]) {
      assert.ok(preview.includes(`"group": "${group}"`), `${group} is not asked for`);
    }
    assert.ok(preview.includes("2. Who and what (20 min)"), "the prompt does not name the item");
  });

  it("wireQuestionControls_TheSameSentenceAskedTwice_IsOneControlNamedForTheItem", async () => {
    // Arrange — day 4 asks one sentence twice on purpose, which is what #78's "… (2)" suffix
    // existed to disambiguate. They are one numbered item, so they are now one control and the
    // tie is gone rather than broken: the name is what the worksheet calls the task, and every
    // one of the 63 items has a heading distinct within its page.
    const HEADING = "3. The contribution question (15 min)";
    const ONE = 1;
    const document = numbered([
      "3-the-contribution-question-15-min",
      HEADING,
      "day4.enough_and_more_1",
      "day4.enough_and_more_2",
    ]);

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
    const named = namesOn(document);

    // Assert
    assert.equal(named.length, ONE, `two sentences of one item got ${named.length} controls`);
    assert.equal(named[0], HEADING);
    assert.ok(!(named[0] ?? "").includes("(2)"), "the tie-breaker outlived the tie");
  });

  it("wireQuestionControls_AMarkdownOrOverlongHeading_IsStillReadableAloud", async () => {
    // Arrange — negative case. The ask is Markdown source, so unstripped a screen reader reads
    // "asterisk asterisk Patterns", and uncut the button's name is a 79-character heading.
    // Both mutations survived: nothing asserted either.
    const LONGEST = 60;
    const ELLIPSIS = "…";
    const document = worksheet("day1.drainers", "day1.patterns");

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeWith(slow));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
    wireQuestionControls(document, memoryStorage("on"), bridgeWith(() =>
      new Promise<ReadonlyMap<string, string>>((resolve) => pending.push(resolve)),
    ));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeWith(() =>
      new Promise<ReadonlyMap<string, string>>((resolve) => pending.push(resolve)),
    ));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

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
      wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map())),
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Assert
    assert.equal(document.querySelectorAll("button.agent-open").length, 1);
    assert.equal(document.querySelectorAll(".agent-panel").length, 1);
  });

  it("wireQuestionControls_EveryPanel_HasAnIdentifierOfItsOwn", async () => {
    // Arrange — one shared id makes every button's `aria-controls` resolve to the first panel,
    // so a screen reader following the relationship lands on another question's payload.
    const document = worksheet("day4.eulogy", "day1.patterns");

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeWith(() => {
      if (first) {
        first = false;
        return Promise.resolve(answers);
      }
      return new Promise<ReadonlyMap<string, string>>((resolve) => {
        release = resolve;
      });
    }));
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
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
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

describe("the answers an item builds on", () => {
  const CIRCLED = "Autonomy, Craftsmanship, Curiosity, Freedom, Integrity, Solitude, Wonder";
  const BRAINSTORM = "day2.brainstorm";
  const TEN = "day2.shortlist_ten";

  it("wireQuestionControls_TheTick_CarriesWhatTheQuestionBuildsOnAsWellAsItsOwn", async () => {
    // Arrange — #105. Day 2 renders as five numbered items and each one's input is the previous
    // one's output, so the prompt for "Narrow to 10" says "From your circled list" and the list
    // lives under a question in a different item.
    const document = numbered(["narrow", "2. Narrow to 10 (10 min)", TEN]);
    wireQuestionControls(
      document,
      memoryStorage("on"),
      bridgeReading(new Map([[BRAINSTORM, CIRCLED]])),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Act
    const before = document.querySelector(".agent-preview")?.textContent ?? "";
    const include = document.querySelector(".agent-panel input") as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    await settle();
    const after = document.querySelector(".agent-preview")?.textContent ?? "";

    // Assert — 0007 · 2 holds at the widened boundary: off until asked for, in both directions.
    assert.ok(!before.includes(CIRCLED), "an earlier item's answer travelled without being asked for");
    assert.ok(after.includes(CIRCLED), "opting in did not carry what the question builds on");
  });

  it("wireQuestionControls_UntickingTheBox_TakesTheCarriedAnswersBackOut", async () => {
    // Arrange — negative case, and the one the preview is answerable for: 0007 · 1 makes the
    // previewed string and the copied string one value, so a carried answer left standing after
    // the tick came off would be on the clipboard as well as on the screen.
    const document = numbered(["narrow", "2. Narrow to 10 (10 min)", TEN]);
    wireQuestionControls(
      document,
      memoryStorage("on"),
      bridgeReading(new Map([[BRAINSTORM, CIRCLED]])),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const include = document.querySelector(".agent-panel input") as HTMLInputElement;
    include.checked = true;
    include.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    await settle();

    // Act
    include.checked = false;
    include.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    await settle();

    // Assert
    assert.ok(
      !(document.querySelector(".agent-preview")?.textContent ?? "").includes(CIRCLED),
      "a carried answer survived the tick coming off",
    );
  });

  it("wireQuestionControls_TheTicksLabel_SaysItCoversWhatTheQuestionBuildsOnToo", async () => {
    // Arrange — 0007 · 1 asks for the trade to be legible at the moment it is made. What the
    // tick covers grew with #105, so a label still saying only "what I have already written"
    // would describe half of what it does on the surface responsible for all of it.
    const document = numbered(["narrow", "2. Narrow to 10 (10 min)", TEN]);
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));

    // Act
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();

    // Assert
    const label = document.querySelector(".agent-panel label");
    assert.match(label?.textContent ?? "", /builds on/, "the tick does not say what it now covers");
  });
});

describe("bringing a reply back where the prompt was copied", () => {
  const EULOGY = "day4.eulogy";

  /** A store that records what it was asked to merge. */
  function recorder(seed: ReadonlyMap<string, string> = new Map()) {
    const merged: ReadonlyMap<string, string>[] = [];
    return {
      merged,
      store: {
        readAll: () => Promise.resolve(seed),
        merge: (entries: ReadonlyMap<string, string>) => {
          merged.push(new Map(entries));
          return Promise.resolve();
        },
      } as unknown as Store,
    };
  }

  /** A reply in the shape the prompt asks for, around the words an assistant would say. */
  function reply(group: string, body: Record<string, unknown>): string {
    const block = { format: "life-compass/agent-answers", version: 1, group, ...body };
    return `Here you go.\n\n\`\`\`json\n${JSON.stringify(block)}\n\`\`\``;
  }

  /** A worksheet with one panel, opened, with the reply half reachable. */
  async function panelOn(overrides: Partial<BridgeOptions> = {}) {
    const document = worksheet(EULOGY);
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map(), overrides));
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    const swaps = [...document.querySelectorAll("button.agent-swap")] as HTMLElement[];
    return {
      document,
      prompt: document.querySelector(".agent-prompt") as HTMLElement,
      reply: document.querySelector(".agent-reply") as HTMLElement,
      toReply: swaps[0] as HTMLElement,
      back: swaps[1] as HTMLElement,
      open: document.querySelector("button.agent-open") as HTMLElement,
      text: document.querySelector(".agent-reply textarea") as HTMLTextAreaElement,
      confirm: document.querySelector(".agent-reply div") as HTMLElement,
      /** By the words on them, not by position: the review's buttons sit inside `confirm`. */
      button: (label: string) =>
        [...document.querySelectorAll(".agent-reply button")].find(
          (one) => one.textContent === label,
        ) as HTMLElement,
      banner: () => document.getElementById("banner-region")?.textContent ?? "",
    };
  }

  /** Let the dynamic import of paste.ts and the read-then-plan chain settle. */
  async function loaded(): Promise<void> {
    const TURNS = 24;
    for (let turn = 0; turn < TURNS; turn += 1) {
      await Promise.resolve();
    }
  }

  it("wireQuestionControls_APanelJustOpened_ShowsThePromptAndNotTheReplyBox", async () => {
    // Arrange — #110 asks for the reply to come back where the prompt was copied, not for a
    // second box beside it. Both halves at once doubles the panel on the phone this is used
    // from, which is the clutter the two-phase shape exists to avoid.
    // Act
    const view = await panelOn();

    // Assert
    assert.equal(view.prompt.hidden, false, "the prompt half is not showing");
    assert.equal(view.reply.hidden, true, "the reply box is showing before it was asked for");
    assert.equal(view.toReply.getAttribute("aria-expanded"), "false");
  });

  it("wireQuestionControls_TheSwap_ShowsOneHalfAtATimeAndSaysWhich", async () => {
    // Arrange
    const view = await panelOn();

    // Act — forward, then back.
    view.toReply.click();
    await loaded();
    const forward = { prompt: view.prompt.hidden, reply: view.reply.hidden };
    view.back.click();
    await settle();

    // Assert
    assert.deepEqual(forward, { prompt: true, reply: false }, "the swap did not change halves");
    assert.equal(view.toReply.getAttribute("aria-expanded"), "false", "the swap still reads as open");
    assert.equal(view.prompt.hidden, false, "the prompt did not come back");
    assert.equal(view.reply.hidden, true, "the reply box stayed up");
  });

  it("wireQuestionControls_TheReviewsParts_AreAllInsideTheOneElementThatHidesThem", async () => {
    // Arrange — `PasteElements` states this and cannot check it: the surface hides the review
    // by hiding `confirm` alone, so a sibling would leave "What this would change" standing
    // over a review that had been emptied.
    const view = await panelOn();
    view.toReply.click();
    await loaded();

    // Act
    const inside = [...view.confirm.children].map((child) => child.tagName.toLowerCase());

    // Assert
    assert.deepEqual(inside, ["p", "p", "p", "div", "button", "button"]);
    assert.equal(view.confirm.hidden, true, "the review is showing before anything was read");
  });

  it("wireQuestionControls_ReadTappedBeforeTheModuleLands_SaysSoRatherThanDoingNothing", async () => {
    // Arrange — negative case. The button is on screen the moment the half is revealed, and
    // `paste.ts` arrives on that tap; a control that appears to do nothing in the gap is the
    // silence 0008 forbids.
    const view = await panelOn();

    // Act — revealed, and read tapped in the same turn, before the import can resolve.
    view.toReply.click();
    // Blurred first, because a tap moves focus to the button it lands on. `banner.ts` holds a
    // message back while the reader is mid-input, and happy-dom's `click()` leaves focus in the
    // textarea `enter()` put it in — so without this the fixture models a state a finger cannot
    // reach and the message is queued rather than said.
    view.text.blur();
    view.button("Read this reply").click();
    await settle();

    // Assert
    assert.match(view.banner(), /still getting ready/i);
  });

  it("wireQuestionControls_APanelJustOpened_HasNotOpenedTheStore", async () => {
    // Arrange — `paste.ts` reaches the reply reader and the planner, and the store behind
    // them. A reader who opens a panel to copy a prompt and never pastes anything pays for
    // none of it.
    let opens = 0;
    const NEVER = 0;

    // Act
    await panelOn({
      openStore: () => {
        opens += 1;
        return Promise.reject(new Error("not wanted"));
      },
    });

    // Assert
    assert.equal(opens, NEVER, "opening a panel opened the store");
  });

  it("wireQuestionControls_AReplySavedFromThePanel_WritesItAndStartsThePageAgain", async () => {
    // Arrange — the whole of #110. `bindAnswers` fills a blank only while it is empty, so the
    // answers just saved are in the store and nowhere on screen until the page starts again —
    // which is what `wireRestore` and `wireErase` already do for the same reason.
    const ANSWER = "That I showed up for the people who needed it.";
    const ONE_WRITE = 1;
    const said: string[] = [];
    const reloads: number[] = [];
    const order: string[] = [];
    const fake = recorder();
    const view = await panelOn({
      openStore: () => Promise.resolve(fake.store),
      onSaved: (message) => {
        said.push(message);
        order.push("said");
      },
      reload: () => {
        reloads.push(1);
        order.push("reloaded");
      },
    });
    view.toReply.click();
    await loaded();
    view.text.value = reply(EULOGY, { answer: ANSWER });

    // Act
    view.text.blur();
    view.button("Read this reply").click();
    await loaded();
    view.button("Save these answers").click();
    await loaded();

    // Assert
    assert.equal(fake.merged.length, ONE_WRITE, "the answers were not saved once");
    assert.deepEqual([...(fake.merged[0] ?? new Map())], [[EULOGY, ANSWER]]);
    assert.deepEqual(said, ["Saved 1 answer. It is on this page now."]);
    assert.deepEqual(reloads, [ONE_WRITE], "the page was not started again");
    // Stashed BEFORE the reload, which is the only order that works: a message written after
    // the page has been told to start again is a message that may never be written at all.
    assert.deepEqual(order, ["said", "reloaded"]);
  });

  it("wireQuestionControls_AReplyForAnotherPage_DoesNotSayItLandedOnThisOne", async () => {
    // Arrange — reported from use. Every block names its own question (0015), so a reply pasted
    // into one panel routes to whatever it answers: this one is pasted on a page that renders
    // `day4.who` and answers `day4.eulogy`, which is on another page. The first version said
    // "They are on this page now" unconditionally — true in the common case and a lie here, in
    // the one sentence a reader has to go looking for their answers by.
    const ONE_WRITE = 1;
    const said: string[] = [];
    const fake = recorder();
    const document = worksheet("day4.who");
    wireQuestionControls(
      document,
      memoryStorage("on"),
      bridgeReading(new Map(), {
        openStore: () => Promise.resolve(fake.store),
        onSaved: (message) => void said.push(message),
      }),
    );
    (document.querySelector("button.agent-open") as HTMLElement).click();
    await settle();
    (document.querySelector("button.agent-swap") as HTMLElement).click();
    await loaded();
    const text = document.querySelector(".agent-reply textarea") as HTMLTextAreaElement;
    const button = (label: string) =>
      [...document.querySelectorAll(".agent-reply button")].find(
        (one) => one.textContent === label,
      ) as HTMLElement;
    text.value = reply(EULOGY, { answer: "That he showed up." });
    text.blur();

    // Act
    button("Read this reply").click();
    await loaded();
    button("Save these answers").click();
    await loaded();

    // Assert — it did land, and it landed somewhere else.
    assert.deepEqual([...(fake.merged[0] ?? new Map())], [[EULOGY, "That he showed up."]]);
    assert.equal(fake.merged.length, ONE_WRITE);
    assert.doesNotMatch(said[0] ?? "", /on this page/, `it claimed this page: ${said[0] ?? ""}`);
    assert.match(said[0] ?? "", /^Saved 1 answer\. It is saved elsewhere in the workbook/);
  });

  it("savedNote_AnswersSplitAcrossPages_SaysSomeAreHereAndSomeAreNot", () => {
    // Arrange — the third case, which neither of the two above reaches: one reply carrying
    // blocks for this page and for another. Asserted on the function rather than through a
    // panel, because building a reply that lands on both sides is a fixture about the wording
    // rather than about the panel.
    const BOTH = 3;
    const here = new Set(["day4.who"]);

    // Act
    const note = savedNote(BOTH, ["day4.who", "day4.eulogy"], here);

    // Assert
    assert.equal(
      note,
      "Saved 3 answers. Some are on this page; the rest are saved elsewhere in the workbook, under the questions they name.",
    );
  });

  it("savedNote_OneAnswerOnThisPage_ReadsAsOneAnswer", () => {
    // Arrange — negative case for the plural, which the sentence changes in three places.
    const ONE = 1;

    // Act
    const note = savedNote(ONE, ["day4.who"], new Set(["day4.who"]));

    // Assert
    assert.equal(note, "Saved 1 answer. It is on this page now.");
  });

  it("wireQuestionControls_SwappingBackAndForth_WiresTheReplyBoxOnceAndSavesOnce", async () => {
    // Arrange — negative case. `wirePasteSurface` requires one wiring per element set: a second
    // attaches a second set of listeners, each with its own pending plan, so one tap of Save
    // would merge twice. Swapping is exactly the shape that invites re-wiring.
    const ONE_WRITE = 1;
    const fake = recorder();
    const view = await panelOn({ openStore: () => Promise.resolve(fake.store) });

    // Act — in and out three times before doing anything.
    for (let turn = 0; turn < 3; turn += 1) {
      view.toReply.click();
      await loaded();
      view.back.click();
      await settle();
    }
    view.toReply.click();
    await loaded();
    view.text.value = reply(EULOGY, { answer: "mine" });
    view.text.blur();
    view.button("Read this reply").click();
    await loaded();
    view.button("Save these answers").click();
    await loaded();

    // Assert
    assert.equal(fake.merged.length, ONE_WRITE, "the reply box was wired more than once");
  });

  it("wireQuestionControls_AReplyLeavingBlocksBehind_SaysSoInTheSentenceItStashes", async () => {
    // Arrange — the stranded half of the message is `paste.ts`'s wording, built where that
    // wording lives. A count carried out to `app.ts` would put a second copy of it in a third
    // file.
    const said: string[] = [];
    const fake = recorder();
    const view = await panelOn({
      openStore: () => Promise.resolve(fake.store),
      onSaved: (message) => void said.push(message),
    });
    view.toReply.click();
    await loaded();
    view.text.value = [
      reply(EULOGY, { answer: "mine" }),
      reply("example.not_a_real_group", { answer: "left on the placeholder" }),
    ].join("\n\n");

    // Act
    view.text.blur();
    view.button("Read this reply").click();
    await loaded();
    view.button("Save these answers").click();
    await loaded();

    // Assert
    assert.match(said[0] ?? "", /^Saved 1 answer\. It is on this page now\./);
    assert.match(said[0] ?? "", /still named the example question/);
  });

  it("wireQuestionControls_GoingBackToThePrompt_DropsThePlanTheReaderWasShown", async () => {
    // Arrange — a review is built from one read of the store, so one left standing while the
    // reader returns to the prompt and dictates is a Save button offering a plan measured
    // against answers that have since changed. That is #83's staleness, at the altitude only
    // the thing owning both halves can see.
    const NOTHING_SAVED = 0;
    const fake = recorder();
    const view = await panelOn({ openStore: () => Promise.resolve(fake.store) });
    view.toReply.click();
    await loaded();
    view.text.value = reply(EULOGY, { answer: "mine" });
    view.text.blur();
    view.button("Read this reply").click();
    await loaded();
    const reviewed = view.confirm.hidden;

    // Act
    view.back.click();
    view.toReply.click();
    await loaded();
    view.button("Save these answers").click();
    await loaded();

    // Assert
    assert.equal(reviewed, false, "the review never opened, so this proves nothing");
    assert.equal(view.confirm.hidden, true, "the review survived going back to the prompt");
    assert.equal(fake.merged.length, NOTHING_SAVED, "a plan the reader had been taken off was saved");
  });

  it("wireQuestionControls_ClosingThePanel_DropsThePlanToo", async () => {
    // Arrange — negative case for the other way out. Closing the panel is the commoner one:
    // the reader taps the control that opened it rather than the swap.
    const NOTHING_SAVED = 0;
    const fake = recorder();
    const view = await panelOn({ openStore: () => Promise.resolve(fake.store) });
    view.toReply.click();
    await loaded();
    view.text.value = reply(EULOGY, { answer: "mine" });
    view.text.blur();
    view.button("Read this reply").click();
    await loaded();

    // Act
    view.open.click();
    view.open.click();
    await loaded();

    // Assert
    assert.equal(view.confirm.hidden, true, "the review survived the panel closing");
    assert.equal(view.prompt.hidden, false, "the panel reopened on the reply half");
    view.button("Save these answers").click();
    await loaded();
    assert.equal(fake.merged.length, NOTHING_SAVED, "a plan behind a closed panel was still saved");
  });

  it("wireQuestionControls_EveryPanelOnAPage_HasItsOwnReplyBoxAndItsOwnName", async () => {
    // Arrange — one panel per numbered item, up to eight on a page. A screen reader listing
    // this page's buttons would otherwise find one "Paste a reply" per item with nothing
    // saying which is which (0001).
    const document = numbered(
      ["who", "2. Who and what (20 min)", "day4.who"],
      ["drafts", "4. Draft three purpose statements (20 min)", "day4.statements"],
    );
    const TWO = 2;

    // Act
    wireQuestionControls(document, memoryStorage("on"), bridgeReading(new Map()));
    const swaps = [...document.querySelectorAll("button.agent-swap")].filter(
      (one) => one.textContent === "Paste a reply",
    );
    const labels = swaps.map((one) => one.getAttribute("aria-label"));

    // Assert
    assert.equal(swaps.length, TWO, "the items did not get one reply control each");
    assert.equal(new Set(labels).size, TWO, `two controls read alike: ${labels.join(" / ")}`);
    assert.equal(
      new Set([...document.querySelectorAll(".agent-reply")].map((one) => one.id)).size,
      TWO,
      "two reply boxes share an id",
    );
  });
});
