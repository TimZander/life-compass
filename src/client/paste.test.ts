/**
 * The box that brings an assistant's answers back.
 *
 * The reading and the planning are `agent-answers.ts`'s and are tested there. What belongs
 * here is the part that decides what a reader sees and when anything is written: that nothing
 * reaches storage before they have looked at it, that what is applied is what they were shown,
 * and that every way this can fail says so.
 *
 * `happy-dom` has no layout (docs/decisions/0014 · C3), so whether the box is reachable on a
 * phone is a device question this file cannot answer.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { after, before, describe, it } from "node:test";
import { wirePaste } from "./paste.ts";
import { layout } from "../../build/layout.ts";
import { answerKey, orderKey, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

let window: Window;

before(() => {
  window = new Window({ url: "https://example.test/agent" });
  const scope = globalThis as unknown as Record<string, unknown>;
  scope["document"] = window.document;
  scope["HTMLElement"] = window.HTMLElement;
  scope["HTMLInputElement"] = window.HTMLInputElement;
  scope["HTMLTextAreaElement"] = window.HTMLTextAreaElement;
  scope["Event"] = window.Event;
});

after(() => {
  void window.close();
});

const SINGLE = "day4.eulogy";
const REPEAT = "day1.chapters";

/** Storage with the bridge switched on, which is what reveals the box. */
function storageWith(setting: string | undefined): Storage {
  const held = new Map<string, string>(
    setting === undefined ? [] : [["life-compass:assistant", setting]],
  );
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  } as unknown as Storage;
}

/** A store that records what it was asked to merge, and can be made to fail. */
function recorder(seed: ReadonlyMap<string, string> = new Map()) {
  const kept = new Map(seed);
  const merged: ReadonlyMap<string, string>[] = [];
  const fake = {
    merged,
    kept,
    failRead: false,
    failMerge: false,
    store: {
      async readAll() {
        if (fake.failRead) {
          throw new Error("the store would not open");
        }
        return kept;
      },
      async merge(entries: ReadonlyMap<string, string>) {
        if (fake.failMerge) {
          throw new Error("quota");
        }
        merged.push(new Map(entries));
        for (const [key, value] of entries) {
          kept.set(key, value);
        }
      },
      async write() {
        throw new Error("the paste box does not write one key at a time");
      },
      async claim() {
        throw new Error("the paste box does not claim");
      },
      async replaceAll() {
        throw new Error("the paste box must never replace everything");
      },
    } as Store,
  };
  return fake;
}

/** The real assistant page, wired, with the bridge on unless told otherwise. */
function page(fake: ReturnType<typeof recorder>, setting = "on") {
  window.document.body.innerHTML = layout("<p>body</p>", "Assistant", "agent");
  const document = window.document as unknown as Document;
  wirePaste(document, storageWith(setting), () => Promise.resolve(fake.store));
  return {
    document,
    section: document.getElementById("paste") as HTMLElement,
    text: document.getElementById("paste-text") as HTMLTextAreaElement,
    read: document.getElementById("paste-read") as HTMLElement,
    confirm: document.getElementById("paste-confirm") as HTMLElement,
    summary: document.getElementById("paste-summary") as HTMLElement,
    detail: document.getElementById("paste-detail") as HTMLElement,
    go: document.getElementById("paste-go") as HTMLElement,
    cancel: document.getElementById("paste-cancel") as HTMLElement,
    banner: () => document.getElementById("banner-region")?.textContent ?? "",
  };
}

function reply(body: Record<string, unknown>): string {
  return `Here you go.\n\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;
}

function block(group: string, rest: Record<string, unknown>): Record<string, unknown> {
  return { format: "life-compass/agent-answers", version: 1, group, ...rest };
}

/** Let the read-then-plan chain settle. */
async function settle(): Promise<void> {
  const TURNS = 8;
  for (let turn = 0; turn < TURNS; turn += 1) {
    await Promise.resolve();
  }
}

describe("when the box is offered at all", () => {
  it("wirePaste_TheBridgeSwitchedOff_LeavesTheBoxHidden", () => {
    // Arrange — negative case, and 0007's rule. Offering to bring an assistant's answers back
    // to somebody who declined the assistant is the nudge that record rules out, and it is
    // incoherent besides: the copy buttons that produce these replies are not there.
    const fake = recorder();

    // Act
    const view = page(fake, "off");

    // Assert
    assert.equal(view.section.hidden, true);
  });

  it("wirePaste_TheBridgeSwitchedOn_RevealsTheBox", () => {
    // Arrange
    const fake = recorder();

    // Act
    const view = page(fake, "on");

    // Assert
    assert.equal(view.section.hidden, false);
  });

  it("wirePaste_TheOptInBeingToggled_ShowsAndHidesTheBoxWithIt", () => {
    // Arrange — the two controls sit on one page, so a reader switching the bridge on expects
    // the way back to appear with it rather than after a reload.
    const fake = recorder();
    const storage = storageWith("off");
    window.document.body.innerHTML = layout("<p>body</p>", "Assistant", "agent");
    const document = window.document as unknown as Document;
    wirePaste(document, storage, () => Promise.resolve(fake.store));
    const section = document.getElementById("paste") as HTMLElement;
    const toggle = document.getElementById("agent-on") as HTMLInputElement;
    assert.equal(section.hidden, true);

    // Act
    storage.setItem("life-compass:assistant", "on");
    toggle.dispatchEvent(new window.Event("change") as unknown as Event);

    // Assert
    assert.equal(section.hidden, false);
  });
});

describe("reading a reply", () => {
  it("wirePaste_AReplyWithNewAnswers_ShowsWhatWouldChangeAndWritesNothingYet", async () => {
    // Arrange — the whole point of the confirmation. 0007 · C3 forbids a silent overwrite, and
    // "silent" includes writing before the reader has looked.
    const ANSWER = "That I showed up for the people who needed it.";
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: ANSWER }));

    // Act
    view.read.click();
    await settle();

    // Assert
    assert.equal(view.confirm.hidden, false, "the reader was shown nothing");
    assert.match(view.summary.textContent ?? "", /Nothing you have already written would change/);
    assert.match(view.detail.textContent ?? "", /1 new answer/);
    assert.equal(fake.merged.length, 0, "answers were written before the reader agreed");
  });

  it("wirePaste_AReplyThatLeftABlockNamingTheExample_SaysSoBeforeTheReaderApproves", async () => {
    // Arrange — the failure #82's prompt makes ordinary. A prompt covering a numbered item
    // shows one worked example per question and every one names the same placeholder group, so
    // an assistant that substitutes one of two leaves a block the importer cannot attribute.
    // It is skipped rather than refused, because refusing would throw away the answer that DID
    // come back — but skipping it in silence showed the reader a tally of one, which is a true
    // statement about what was read and a false one about what they dictated. Said above the
    // tally, because it is about what is missing from it.
    const ANSWER = "That I showed up for the people who needed it.";
    const fake = recorder();
    const view = page(fake);
    view.text.value =
      `Here you go.\n\n\`\`\`json\n${JSON.stringify(block(SINGLE, { answer: ANSWER }))}\n\`\`\`\n\n` +
      `\`\`\`json\n${JSON.stringify(block("example.not_a_real_group", { answer: "what I said" }))}\n\`\`\``;

    // Act
    view.read.click();
    await settle();

    // Assert
    assert.equal(view.confirm.hidden, false, "the reader was shown nothing");
    const shown = view.detail.textContent ?? "";
    assert.match(shown, /still named the example question/i, "the block left out is not mentioned");
    assert.match(shown, /1 new answer/, "what did come back is no longer shown");
    assert.equal(fake.merged.length, 0, "answers were written before the reader agreed");
  });

  it("wirePaste_NothingToChangeButABlockLeftOut_StillSaysABlockWasLeftOut", async () => {
    // Arrange — the path that never reaches the confirmation surface, and so never reached the
    // notice above it. An assistant asked to review what the reader already had agrees with it
    // word for word, and leaves the one NEW question's block naming the example group: the
    // plan is empty, the reader is told "there is nothing to change", and the question they
    // spent the interview on is the one thing that did not come back. True about what was
    // read, false about what they said.
    const MINE = "That I showed up for the people who needed it.";
    const fake = recorder(new Map([[SINGLE, MINE]]));
    const view = page(fake);
    view.text.value =
      `Here you go.\n\n\`\`\`json\n${JSON.stringify(block(SINGLE, { answer: MINE }))}\n\`\`\`\n\n` +
      `\`\`\`json\n${JSON.stringify(block("example.not_a_real_group", { answer: "the new one" }))}\n\`\`\``;

    // Act
    view.read.click();
    await settle();

    // Assert
    assert.equal(view.confirm.hidden, true, "there was something to approve after all");
    assert.match(view.banner(), /still named the example question/i, "the block left out is not mentioned");
    assert.equal(fake.merged.length, 0);
  });

  it("wirePaste_AReplyWithNothingLeftOut_SaysNothingAboutBlocksLeftOut", async () => {
    // Arrange — the negative case, and the reason it matters more than it looks: a warning
    // shown on every import is a warning nobody reads by the third one. This is the ordinary
    // path, and it has to stay quiet.
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "Something plain." }));

    // Act
    view.read.click();
    await settle();

    // Assert
    assert.ok(
      !/example question/i.test(view.detail.textContent ?? ""),
      "a clean reply was warned about anyway",
    );
  });

  it("wirePaste_AnOverwrite_IsShownInFullBeforeAndAfter", async () => {
    // Arrange — an addition fills a blank and needs no review; a change replaces the reader's
    // own words and is the case the surface exists for. Showing only the new text would ask
    // them to accept a replacement they cannot see.
    const MINE = "What I actually wrote, in my own words.";
    const THEIRS = "A tidier sentence somebody else made of it.";
    const fake = recorder(new Map([[SINGLE, MINE]]));
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: THEIRS }));

    // Act
    view.read.click();
    await settle();

    // Assert
    const shown = view.detail.textContent ?? "";
    assert.ok(shown.includes(MINE), "the reader is not shown what they would lose");
    assert.ok(shown.includes(THEIRS), "the reader is not shown what would replace it");
    assert.match(view.summary.textContent ?? "", /1 answer would replace something you wrote/);
  });

  it("wirePaste_SeveralInstancesOfOneRepeat_AreToldApartInTheReview", async () => {
    // Arrange — three overwritten chapters used to produce three rows all reading "Title",
    // byte-identical where the old values matched. Approving three things you cannot tell
    // apart is not the consent 0007 · C3 asks for. The slot number is the one the page already
    // prints beside each entry; it is display only and never touches a key (0011, 0013 · O1).
    const first = "5f1c8e2a-0000-4000-8000-000000000001";
    const second = "5f1c8e2a-0000-4000-8000-000000000002";
    const fake = recorder(
      new Map([
        [orderKey(REPEAT), writeOrder([first, second])],
        [answerKey(REPEAT, first, "title"), "The garage-band years"],
        [answerKey(REPEAT, second, "title"), "Leaving home"],
      ]),
    );
    const view = page(fake);
    view.text.value = reply(
      block(REPEAT, {
        instances: [
          { id: first, fields: { title: "The years in the garage" } },
          { id: second, fields: { title: "The year I left" } },
        ],
      }),
    );

    // Act
    view.read.click();
    await settle();

    // Assert
    const titles = [...view.detail.querySelectorAll(".paste-change-title")].map(
      (one) => one.textContent ?? "",
    );
    assert.equal(titles.length, 2);
    assert.equal(new Set(titles).size, 2, `the rows cannot be told apart: ${titles.join(" | ")}`);
    assert.ok(titles[0]?.includes("1 ·"), `the first row does not say which entry: ${titles[0]}`);
    assert.ok(titles[1]?.includes("2 ·"), `the second row does not say which entry: ${titles[1]}`);
  });

  it("wirePaste_TheGroupsTouched_AreNamedTheWayThePageNamesThem", async () => {
    // Arrange — the reader is told where a block went (0015), and telling them "day4.eulogy"
    // is telling them a storage identifier. The same reasoning the copy buttons already apply.
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "x" }));

    // Act
    view.read.click();
    await settle();

    // Assert
    const said = `${view.summary.textContent ?? ""} ${view.detail.textContent ?? ""}`;
    assert.ok(!said.includes(SINGLE), `the reader is shown an identifier: ${said}`);
    assert.match(said, /eulogy test/i);
  });

  it("wirePaste_AWholeRepeatComingBack_IsCountedInEntriesRatherThanStoredFields", async () => {
    // Arrange — found on a device. Day 1's peak experiences are five slots of four fields, so
    // a reply filling them is twenty stored answers — and a reader who described five things
    // was told "20 answers are new". Right arithmetic, wrong unit, and alarming in a way the
    // number does not deserve. Entries are what the page shows and what they think they wrote.
    const PEAKS = "day1.peaks";
    const ENTRIES = 5;
    const FIELDS = 20;
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(
      block(PEAKS, {
        instances: Array.from({ length: ENTRIES }, (_unused, index) => ({
          fields: {
            moment: `moment ${index}`,
            doing: `doing ${index}`,
            with: `with ${index}`,
            quality: `quality ${index}`,
          },
        })),
      }),
    );

    // Act
    view.read.click();
    await settle();

    // Assert
    const shown = view.detail.textContent ?? "";
    assert.match(shown, new RegExp(`${ENTRIES} new entries`), `counted in the wrong unit: ${shown}`);
    assert.match(shown, new RegExp(`${FIELDS} answers in all`), "the field total is not available");
    assert.match(view.summary.textContent ?? "", /Nothing you have already written would change/);
  });

  it("wirePaste_ARepeatPartlyRewrittenAndPartlyNew_TellsThoseApartInTheTally", async () => {
    // Arrange — the commonest real reply to "I started this by hand, help me finish": some
    // entries come back rewritten and some are added. Counting them all as new tells the
    // reader nothing of theirs is at risk when something is, which is the one thing the
    // summary above exists to say.
    const MINE = "5f1c8e2a-0000-4000-8000-000000000001";
    const fake = recorder(
      new Map([
        [orderKey(REPEAT), writeOrder([MINE])],
        [answerKey(REPEAT, MINE, "title"), "The garage-band years"],
      ]),
    );
    const view = page(fake);
    view.text.value = reply(
      block(REPEAT, {
        instances: [
          { id: MINE, fields: { title: "The years in the garage" } },
          { fields: { title: "Leaving home" } },
        ],
      }),
    );

    // Act
    view.read.click();
    await settle();

    // Assert
    const shown = view.detail.textContent ?? "";
    assert.match(shown, /1 new entry/, `the added entry is miscounted: ${shown}`);
    assert.match(shown, /1 entry updated/, `the rewritten entry is counted as new: ${shown}`);
    assert.match(view.summary.textContent ?? "", /would replace something you wrote/);
  });

  it("wirePaste_AReplyMatchingWhatIsSaved_SaysSoRatherThanOfferingAnEmptyConfirmation", async () => {
    // Arrange — negative case, and a real outcome rather than a failure: the reader asked an
    // assistant to review what they already had and it agreed with all of it. Saying nothing
    // would read as the button not working.
    const MINE = "Unchanged, word for word.";
    const fake = recorder(new Map([[SINGLE, MINE]]));
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: MINE }));

    // Act
    view.read.click();
    await settle();

    // Assert
    assert.equal(view.confirm.hidden, true, "an empty confirmation was offered");
    assert.match(view.banner(), /already saved/);
    assert.equal(fake.merged.length, 0);
  });

  it("wirePaste_ARefusedReply_SaysWhyAndOffersNothingToConfirm", async () => {
    // Arrange — negative case. Every refusal ends by saying the device is untouched, and this
    // is the surface where the reader reads it.
    const fake = recorder();
    const view = page(fake);
    view.text.value = "I think your chapters are about growth and loss.";

    // Act
    view.read.click();
    await settle();

    // Assert
    assert.equal(view.confirm.hidden, true);
    assert.match(view.banner(), /code block/);
    assert.match(view.banner(), /Nothing on this device has changed/);
  });

  it("wirePaste_TheStoreRefusingToBeRead_SaysSoAndDoesNotOfferToSave", async () => {
    // Arrange — negative case. Without the store there is nothing to compare against, so the
    // counts would be a guess and every overwrite would look like an addition.
    const fake = recorder();
    fake.failRead = true;
    const noisy = console.error;
    console.error = (): void => {};
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "x" }));

    // Act
    view.read.click();
    await settle();
    console.error = noisy;

    // Assert
    assert.equal(view.confirm.hidden, true);
    assert.match(view.banner(), /could not be read/);
  });

  it("wirePaste_ASecondReply_ReplacesTheFirstConfirmationRatherThanStandingBesideIt", async () => {
    // Arrange — negative case. Leaving the previous confirmation up while the next reply is
    // read is what would let somebody approve a plan built from text they had already
    // replaced, which is the defect the generation guard in agent.ts exists for.
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "the first one" }));
    view.read.click();
    await settle();
    assert.equal(view.confirm.hidden, false);

    // Act — a reply that will be refused, so nothing replaces the confirmation.
    view.text.value = "nothing usable in here at all";
    view.read.click();
    await settle();

    // Assert
    assert.equal(view.confirm.hidden, true, "a stale confirmation was left standing");
    assert.equal(view.detail.textContent, "");
  });
});

describe("saving what was shown", () => {
  it("wirePaste_Saving_WritesExactlyWhatTheReaderWasShown", async () => {
    // Arrange — the plan applied is the plan previewed. Re-planning at this point against a
    // fresh read would apply something the reader never saw, which is the same promise broken
    // from the other end.
    const ANSWER = "That I showed up.";
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: ANSWER }));
    view.read.click();
    await settle();

    // Act
    view.go.click();
    await settle();

    // Assert
    assert.equal(fake.merged.length, 1, "the answers were not saved once");
    assert.deepEqual([...(fake.merged[0] ?? new Map())], [[SINGLE, ANSWER]]);
    assert.match(view.banner(), /Saved 1 answer/);
    assert.equal(view.confirm.hidden, true, "the confirmation stayed up after saving");
    assert.equal(view.text.value, "", "the reply was left in the box after being saved");
  });

  it("wirePaste_Cancelling_WritesNothingAndSaysSo", async () => {
    // Arrange — negative case. A reader who looks at the diff and decides against it must end
    // up exactly where they started, and be told they did.
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "x" }));
    view.read.click();
    await settle();

    // Act
    view.cancel.click();
    await settle();

    // Assert
    assert.equal(fake.merged.length, 0);
    assert.equal(view.confirm.hidden, true);
    assert.match(view.banner(), /Nothing was saved/);
  });

  it("wirePaste_SavingTwice_AppliesThePlanOnlyOnce", async () => {
    // Arrange — negative case. A double tap is ordinary on a phone, and the second merge would
    // be harmless only by luck; the button is `aria-disabled` rather than `disabled` because a
    // disabled element cannot hold focus, so the guard has to be in the handler.
    const fake = recorder();
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "x" }));
    view.read.click();
    await settle();

    // Act
    view.go.click();
    view.go.click();
    await settle();

    // Assert
    assert.equal(fake.merged.length, 1, "the plan was applied twice");
  });

  it("wirePaste_AMergeThatFails_SaysSoAndLeavesWhatWasThere", async () => {
    // Arrange — negative case. 0008 makes what storage can and cannot promise something the
    // app says out loud, and this is the moment it matters most: the reader has just agreed to
    // something and needs to know whether it happened.
    const fake = recorder();
    fake.failMerge = true;
    const noisy = console.error;
    console.error = (): void => {};
    const view = page(fake);
    view.text.value = reply(block(SINGLE, { answer: "x" }));
    view.read.click();
    await settle();

    // Act
    view.go.click();
    await settle();
    console.error = noisy;

    // Assert
    assert.match(view.banner(), /could not be saved/);
    assert.ok(!/Saved/.test(view.banner()), "a failed save reported success");
  });

  it("wirePaste_SavingBeforeAnythingWasRead_DoesNothing", async () => {
    // Arrange — negative case. The button ships `aria-disabled`, but that is an announcement
    // rather than an enforcement: it can still be clicked.
    const fake = recorder();
    const view = page(fake);

    // Act
    view.go.click();
    await settle();

    // Assert
    assert.equal(fake.merged.length, 0);
  });
});
