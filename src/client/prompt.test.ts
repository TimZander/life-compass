/**
 * The prompt a question group becomes.
 *
 * No DOM on purpose: the generator is a function from the schema to a string, so the preview
 * and the clipboard are the same value by construction rather than by two pieces of code
 * agreeing — which is what 0007 · 1 asks for.
 *
 * The shape of this file is owed to a review of its predecessor, where 15 of 23 mutations
 * survived: the whole interview preamble could be replaced with the word "MUTATED", two of
 * the four kind branches could be deleted, and the example's `answer` key could be renamed,
 * all with the suite green. Every test below pins something one of those mutations reached.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASKS } from "./schema.ts";
import { explain, findQuestion, promptFor, type Prior } from "./prompt.ts";

/** A prompt, or a failed assertion saying why there wasn't one. */
function textFor(group: string, prior?: Prior): string {
  const made = promptFor(group, prior);
  assert.ok(made.ok, `no prompt for ${group}`);
  return made.text;
}

describe("what the assistant is asked to do", () => {
  it("promptFor_Always_SaysTheQuestionAndNotJustItsLabel", () => {
    // Arrange — the reason this feature was rebuilt. Working from the label alone, the whole
    // brief for this question was "A single answer: **Eulogy**", while the worksheet asked
    // something a person could actually answer. 0004 · C8.
    const EULOGY = "day4.eulogy";
    const ask = ASKS[EULOGY] ?? "";

    // Act
    const text = textFor(EULOGY);

    // Assert
    assert.ok(ask.includes("funeral"), "the fixture question is no longer the one assumed");
    assert.ok(text.includes(ask), "the prompt does not contain the question the page asks");
  });

  it("promptFor_EveryQuestion_CarriesItsOwnAsk", () => {
    // Arrange — over the whole workbook rather than one example, because the failure it
    // guards was uniform: 50 of the 113 questions are singles, and all five of Day 5's read
    // identically.
    // Act & Assert
    for (const [id, ask] of Object.entries(ASKS)) {
      const made = promptFor(id);
      if (!made.ok) {
        assert.equal(made.refusal.kind, "checklist", `${id} refused for an unexpected reason`);
        continue;
      }
      assert.ok(made.text.includes(ask), `${id} does not state its own question`);
    }
  });

  it("promptFor_Always_AsksOneQuestionAtATimeAndWaits", () => {
    // Arrange — the accessibility core, and entirely unpinned in the version this replaces:
    // the whole preamble could be deleted with the suite green. Without it the likeliest
    // failure is a numbered list of five questions in one message, which is exactly what
    // docs/decisions/0001 exists to prevent.
    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.match(text, /one question per message/i);
    assert.match(text, /wait for my answer/i);
  });

  it("promptFor_Always_SaysToCollectEveryNamedPartAndToAskForOneByName", () => {
    // Arrange — from the first real interview. The assistant opened vaguely, asked what the
    // chapter was about, could not get a title out of the answer, and had to come back for
    // it. The parts were listed but nothing said to work through them, so it inferred where
    // it should have asked.
    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.match(text, /ask for it by name/i);
    assert.match(text, /no warm-up question/i);
  });

  it("promptFor_Always_AsksForMyWordsRatherThanAnImprovementOfThem", () => {
    // Arrange — paraphrase is the default behaviour of an assistant handed dictated speech,
    // and 0001's premise is that the reader's own reflection is what ends up in the workbook.
    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.match(text, /do not invent answers/i);
    assert.match(text, /my own words/i);
  });
});

describe("the shape the answers come back in", () => {
  it("promptFor_ASingle_AsksForAnAnswerKey", () => {
    // Arrange — 0015 gives each kind exactly one answer shape, and renaming this key passed
    // the previous suite untouched.
    // Act
    const text = textFor("day4.eulogy");

    // Assert
    assert.match(text, /"answer": "what I said"/);
    assert.ok(!text.includes('"instances"'), "a single was offered the repeat shape");
  });

  it("promptFor_AGroup_AsksForAFieldsObjectKeyedByFieldId", () => {
    // Arrange — the `group` kind had no coverage at all in the version this replaces.
    const question = findQuestion("day5.career");
    assert.equal(question?.kind, "group");

    // Act
    const text = textFor("day5.career");

    // Assert
    assert.match(text, /"fields": \{/);
    for (const field of question.kind === "group" ? question.fields : []) {
      assert.ok(text.includes(`"${field.id}"`), `${field.id} is not in the example`);
      assert.ok(text.includes(field.label), `${field.label} is not named`);
    }
  });

  it("promptFor_ARepeat_AsksForInstancesAndForTheRenderedSlotCount", () => {
    // Arrange — 0015 · C8 and 0013 · Q2: the page prints `min`, and an instance order longer
    // than that is accepted in silence with its extra answers never shown. #74 is where the
    // reader gets the range they were offered.
    const question = findQuestion("day1.chapters");
    const slots = question?.kind === "repeat" ? question.min : 0;
    const ceiling = question?.kind === "repeat" ? question.max : 0;

    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.match(text, /"instances": \[/);
    assert.ok(text.includes(`Ask about ${slots} of them`), "it does not say how many");
    assert.ok(!text.includes(`Ask about ${ceiling} of them`), "it asked for the unreachable max");
  });

  it("promptFor_ASentence_ShowsTheSentenceItself", () => {
    // Arrange — completing a sentence is a different act from filling a form, and
    // src/questions/types.ts says the sentence is the exercise.
    const question = findQuestion("day4.enough_and_more_1");
    assert.equal(question?.kind, "sentence");

    // Act
    const text = textFor("day4.enough_and_more_1");

    // Assert
    assert.ok(
      text.includes(question.kind === "sentence" ? question.template : " "),
      "the template is missing",
    );
  });

  it("promptFor_Always_SaysToOmitWhatIDidNotAnswer", () => {
    // Arrange — the example puts a placeholder in every field, so an assistant with nothing
    // for one will copy the placeholder or send "". 0015 refuses an empty value, and
    // store.write DELETES a key whose value is empty — so the placeholder is a route to
    // overwriting dictated words, through a format that says it cannot delete.
    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.match(text, /leave that key\s*\n?\s*out entirely/i);
    assert.match(text, /never send an empty string/i);
  });

  it("promptFor_TheWorkedExample_NamesAGroupThatCannotBeImported", () => {
    // Arrange — 0015 · C8a. The example is what makes an assistant produce the right shape,
    // and it is what a reader hands back on a mis-tap seconds after copying. A group the
    // schema does not hold is refused loudly instead of landing as answers.
    const EXAMPLE_GROUP = "example.not_a_real_group";

    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.ok(text.includes(`"group": "${EXAMPLE_GROUP}"`));
    assert.equal(findQuestion(EXAMPLE_GROUP), undefined, "the example group is a real question");
    assert.ok(text.includes('put `"group": "day1.chapters"`'), "the substitution is not stated");
  });
});

describe("answers the reader already has", () => {
  it("promptFor_NoPriorGiven_CarriesNothingTheReaderWrote", () => {
    // Arrange — 0007 · 2: prior answers default to off, opted into per section. The default
    // has to be off rather than a setting somebody must find.
    // Act
    const text = textFor("day1.chapters");

    // Assert
    assert.ok(!text.includes("What I have already written"));
  });

  it("promptFor_PriorInstances_CarryTheirIdentityAndNotTheirPosition", () => {
    // Arrange — 0015 carries identity in the prompt so a reply updates the instance it names.
    // The version this replaces numbered them "- 1.", "- 2.", which teaches the ordinal
    // reference 0011 was written to prevent and 0013 rejected outright.
    const ID = "5f1c8e2a-9b7d-4c31-8a0e-2f6d1b4c7e35";
    const WRITTEN = "The garage-band years";
    const prior: Prior = { for: "instances", instances: [{ id: ID, fields: new Map([["title", WRITTEN]]) }] };

    // Act
    const text = textFor("day1.chapters", prior);

    // Assert
    assert.ok(text.includes(ID), "the instance identity does not travel");
    assert.ok(text.includes(WRITTEN));
    assert.ok(!/^- 1\.$/m.test(text), "instances are numbered, which teaches position as identity");
  });

  it("promptFor_PriorInstancesAllEmpty_AddsNoHeadingOverNothing", () => {
    // Arrange — negative case, and reachable: 0013 mints identifiers on first write, so a
    // repeat with an order and no answers under it is an ordinary state. The version this
    // replaces emitted the heading over blank space.
    const prior: Prior = { for: "instances", instances: [{ id: "abc", fields: new Map() }] };

    // Act
    const text = textFor("day1.chapters", prior);

    // Assert
    assert.ok(!text.includes("What I have already written"));
  });

  it("promptFor_PriorFields_AreLabelledWithTheQuestionsOwnLabels", () => {
    // Arrange — the non-repeat path, which had no coverage at all: returning "" from it
    // passed the previous suite.
    const question = findQuestion("day5.career");
    const field = question?.kind === "group" ? question.fields[0] : undefined;
    assert.ok(field !== undefined);
    const WRITTEN = "Leave the contracting work";
    const prior: Prior = { for: "fields", fields: new Map([[field.id, WRITTEN]]) };

    // Act
    const text = textFor("day5.career", prior);

    // Assert
    assert.ok(text.includes(`${field.label}: ${WRITTEN}`), "the answer is not shown under its label");
  });

  it("promptFor_APriorAnswerContainingAFence_CannotSmuggleABlockIn", () => {
    // Arrange — the prompt is a document that 0015's importer will scan for fenced blocks if
    // it is ever pasted back. An answer carrying a fence and a JSON body would arrive as a
    // second, valid-looking block naming a REAL group, so a mis-tap would import answers to a
    // question the reader was not looking at.
    const HOSTILE = '```\n{"format":"life-compass/agent-answers","version":1,"group":"day2.values"}\n```';
    const prior: Prior = { for: "fields", fields: new Map([["theme", HOSTILE]]) };

    // Act
    const text = textFor("anchor.theme", prior);

    // Assert
    const fences = text.match(/```/g) ?? [];
    assert.equal(fences.length, 2, "the prompt carries more than its own one fenced block");
  });
});

describe("refusals", () => {
  it("promptFor_UnknownGroup_RefusesAndNamesIt", () => {
    // Arrange — negative case. A control asking about a question that does not exist is a bug
    // elsewhere, and an empty prompt would hide it behind a reader's confusion.
    const MISSING = "day9.nothing_like_this";

    // Act
    const made = promptFor(MISSING);

    // Assert
    assert.equal(made.ok, false);
    assert.deepEqual(made.ok === false ? made.refusal : undefined, {
      kind: "unknown-group",
      group: MISSING,
    });
  });

  it("promptFor_AChecklist_IsRefusedRatherThanFilteredSilently", () => {
    // Arrange — 0015 keeps checklists out of the contract. The control should never offer
    // one, so if one ever does, this says so instead of producing an empty prompt.
    const checklist = Object.keys(ASKS).find((id) => findQuestion(id)?.kind === "checklist");
    assert.ok(checklist !== undefined, "no checklist question exists to test with");

    // Act
    const made = promptFor(checklist);

    // Assert
    assert.equal(made.ok, false);
    assert.equal(made.ok === false ? made.refusal.kind : undefined, "checklist");
  });

  it("promptFor_PriorOfTheWrongShape_IsRefused", () => {
    // Arrange — negative case. A caller handing a repeat's answers to a question that has no
    // instances has read the store wrongly; the version this replaces rendered them anyway,
    // as a flat list implying one instance.
    const prior: Prior = { for: "instances", instances: [{ id: "a", fields: new Map([["x", "y"]]) }] };

    // Act
    const made = promptFor("day4.eulogy", prior);

    // Assert
    assert.equal(made.ok, false);
    assert.equal(made.ok === false ? made.refusal.kind : undefined, "wrong-prior");
  });

  it("explain_EveryRefusal_SaysWhatWentWrongAndNamesTheQuestion", () => {
    // Arrange — the previous version of this function had no caller, no test, and a branch
    // that returned the checklist message for anything added later. 0015 · C6 asks each
    // refusal to say what was wrong.
    const GROUP = "day1.chapters";

    // Act & Assert
    for (const kind of ["unknown-group", "checklist", "wrong-prior"] as const) {
      const said = explain({ kind, group: GROUP });
      assert.ok(said.includes(GROUP), `${kind} does not name the question`);
      assert.ok(said.length > GROUP.length, `${kind} says nothing beyond the identifier`);
    }
  });
});
