import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANCHOR, checkRegistry, checkSentences, loadSchema, renderQuestion } from "./questions.ts";
import { identifiersOf, type Question } from "../src/questions/types.ts";
import type { Worksheet } from "../src/questions/index.ts";

const CHAPTERS: Question = {
  kind: "repeat",
  id: "t.chapters",
  instances: "row",
  label: "Chapter",
  min: 2,
  max: 4,
  fields: [
    { id: "title", label: "Title", size: "long" },
    { id: "learned", label: "Learned", size: "short" },
  ],
};

const NOTE: Question = { kind: "single", id: "t.note", label: "Note", size: "long" };

function sheet(questions: readonly Question[]): readonly Worksheet[] {
  return [{ source: "t.md", questions }];
}

describe("ANCHOR", () => {
  it("ANCHOR_WellFormedComment_CapturesTheQuestionId", () => {
    // Arrange
    const comment = "<!-- questions: day1.chapters -->";

    // Act
    const match = ANCHOR.exec(comment);

    // Assert
    assert.equal(match?.[1], "day1.chapters");
  });

  it("ANCHOR_ExtraWhitespace_StillMatches", () => {
    // Arrange
    const comment = "<!--   questions:   day1.peaks   -->";

    // Act & Assert
    assert.equal(ANCHOR.exec(comment)?.[1], "day1.peaks");
  });

  it("ANCHOR_OrdinaryComment_DoesNotMatch", () => {
    // Arrange — negative case: prose comments must pass through untouched.
    const comment = "<!-- a note to self -->";

    // Act & Assert
    assert.equal(ANCHOR.exec(comment), null);
  });
});

describe("identifiersOf", () => {
  it("identifiersOf_RepeatQuestion_IncludesGroupAndEveryField", () => {
    // Act
    const ids = identifiersOf(CHAPTERS);

    // Assert
    assert.deepEqual(ids, ["t.chapters", "t.chapters.title", "t.chapters.learned"]);
  });

  it("identifiersOf_SingleQuestion_IsJustItsOwnId", () => {
    // Act & Assert
    assert.deepEqual(identifiersOf(NOTE), ["t.note"]);
  });
});

describe("loadSchema", () => {
  it("loadSchema_DuplicateQuestionId_Throws", () => {
    // Arrange — negative case: two questions claiming one identifier would make stored
    // answers ambiguous, which is the whole thing 0011 exists to prevent.
    const duplicated = sheet([NOTE, { ...NOTE }]);

    // Act & Assert
    assert.throws(() => loadSchema(duplicated), /duplicate question id: t\.note/);
  });
});

describe("checkRegistry", () => {
  it("checkRegistry_RealSchema_IsClean", () => {
    // Arrange & Act — the shipped registry and the shipped questions must agree.
    const problems = checkRegistry(loadSchema());

    // Assert
    assert.deepEqual(problems, []);
  });

  it("checkRegistry_IdentifierNotInRegistry_IsReported", () => {
    // Arrange — negative case. `t.*` is deliberately absent from the real registry.
    const schema = loadSchema(sheet([NOTE]));

    // Act
    const problems = checkRegistry(schema);

    // Assert
    assert.ok(problems.some((p) => p.includes("t.note is used by a question but is not in the registry")));
  });

  it("checkRegistry_RegisteredIdentifierNoLongerUsed_IsReported", () => {
    // Arrange — the direction that catches a rename done by editing one line. Every
    // real identifier goes unused when the schema is replaced by a fixture.
    const schema = loadSchema(sheet([NOTE]));

    // Act
    const problems = checkRegistry(schema);

    // Assert
    assert.ok(
      problems.some((p) => p.includes("day1.chapters is registered active but no question uses it")),
    );
  });
});

describe("renderQuestion", () => {
  it("renderQuestion_SingleQuestion_CarriesItsIdAndOneBlank", () => {
    // Act
    const html = renderQuestion(NOTE);

    // Assert
    assert.ok(html.includes('data-question="t.note"'));
    assert.equal(html.match(/class="fill(?:-sm)?"/g)?.length, 1);
  });

  it("renderQuestion_RepeatQuestion_RendersMinInstancesWithEveryField", () => {
    // Arrange — two instances of two fields.
    const expectedBlanks = CHAPTERS.kind === "repeat" ? CHAPTERS.min * CHAPTERS.fields.length : 0;

    // Act
    const html = renderQuestion(CHAPTERS);

    // Assert
    assert.equal(html.match(/class="fill(?:-sm)?"/g)?.length, expectedBlanks);
    assert.ok(html.includes('data-field="t.chapters.title"'));
    assert.ok(html.includes('data-field="t.chapters.learned"'));
    assert.ok(html.includes('data-min="2"'));
    assert.ok(html.includes('data-max="4"'));
  });

  it("renderQuestion_SizeHint_SelectsTheBlankWidth", () => {
    // Arrange — the stylesheet's two widths, chosen by the hint rather than by guess.
    // Act
    const html = renderQuestion(CHAPTERS);

    // Assert
    assert.ok(html.includes('<span class="fill" data-field="t.chapters.title"'));
    assert.ok(html.includes('<span class="fill-sm" data-field="t.chapters.learned"'));
  });

  it("renderQuestion_FieldLabelContainingMarkup_IsEscaped", () => {
    // Arrange — negative case: labels are authored text, not trusted markup. Checked on
    // a repeat field rather than a single, because a single question's label is
    // deliberately not printed — the prose above it already asks the question.
    const hostile: Question = {
      kind: "repeat",
      id: "t.x",
      instances: "row",
      label: "X",
      min: 1,
      max: 1,
      fields: [{ id: "f", label: '<script>"x"', size: "long" }],
    };

    // Act
    const html = renderQuestion(hostile);

    // Assert
    assert.ok(html.includes("&lt;script&gt;&quot;x&quot;"));
    assert.ok(!html.includes("<script>"));
  });

  it("renderQuestion_SingleQuestion_DoesNotPrintItsLabel", () => {
    // Arrange — the prose immediately above already asks the question, so printing the
    // label produced "Patterns — what kind of work…" followed by "Patterns: ____".
    // Act
    const html = renderQuestion(NOTE);

    // Assert
    assert.ok(!html.includes("Note"));
    assert.ok(html.includes('data-question="t.note"'));
  });
});

describe("sentence questions", () => {
  const SENTENCE: Question = {
    kind: "sentence",
    id: "t.sentence",
    template: "The world has enough {excess}. It needs more {lack}.",
    fields: [
      { id: "excess", label: "Enough of", size: "short" },
      { id: "lack", label: "More of", size: "short" },
    ],
  };

  it("renderQuestion_Sentence_InterleavesProseAndBlanks", () => {
    // Arrange — the sentence is the exercise; splitting it into labelled fields would
    // capture the same words while asking a different thing.
    // Act
    const html = renderQuestion(SENTENCE);

    // Assert
    assert.ok(html.includes("The world has enough "));
    assert.ok(html.includes(". It needs more "));
    assert.equal(html.match(/class="fill-sm"/g)?.length, 2);
  });

  it("checkSentences_GapWithNoField_IsReported", () => {
    // Arrange — negative case, and invisible in the output: a gap with no field renders
    // as nothing at all.
    const broken: Question = { ...SENTENCE, template: "Enough {excess}, more {missing}." };

    // Act
    const problems = checkSentences(loadSchema([{ source: "t.md", questions: [broken] }]));

    // Assert
    assert.ok(problems.some((p) => p.includes("{missing} gap with no matching field")));
  });

  it("checkSentences_FieldWithNoGap_IsReported", () => {
    // Arrange — negative case: a field the reader is never shown, but which the
    // registry, storage and the assistant contract all believe exists.
    const broken: Question = { ...SENTENCE, template: "The world has enough {excess}." };

    // Act
    const problems = checkSentences(loadSchema([{ source: "t.md", questions: [broken] }]));

    // Assert
    assert.ok(problems.some((p) => p.includes('defines "lack"')));
  });

  it("checkSentences_RealSchema_IsClean", () => {
    // Act & Assert — the shipped sentences and their fields must agree.
    assert.deepEqual(checkSentences(loadSchema()), []);
  });
});

describe("checklist and group questions", () => {
  it("renderQuestion_Checklist_RendersOneListWithAFieldPerItem", () => {
    // Arrange — one question with several items, not one question per tick: four
    // questions would need four anchors and render as four separate lists.
    const checklist: Question = {
      kind: "checklist",
      id: "t.ready",
      items: [
        { id: "a", label: "First" },
        { id: "b", label: "Second" },
      ],
    };

    // Act
    const html = renderQuestion(checklist);

    // Assert
    assert.equal(html.match(/<ul/g)?.length, 1);
    assert.ok(html.includes('data-field="t.ready.a"'));
    assert.ok(html.includes('data-field="t.ready.b"'));
    assert.ok(html.includes("disabled"));
  });

  it("renderQuestion_Group_IsUnnumbered", () => {
    // Arrange — these prompts differ from one another rather than repeating, so
    // numbering them would imply an order that is not there.
    const group: Question = {
      kind: "group",
      id: "t.group",
      fields: [{ id: "a", label: "A", size: "long" }],
    };

    // Act
    const html = renderQuestion(group);

    // Assert
    assert.ok(html.includes("<ul"));
    assert.ok(!html.includes("<ol"));
  });
});

describe("repeat instance weight", () => {
  const FIELDS = [
    { id: "name", label: "Value", size: "long" as const },
    { id: "definition", label: "My definition", size: "long" as const },
  ];

  it("renderQuestion_SectionInstances_GiveEachOneAHeading", () => {
    // Arrange — headings are navigation as well as hierarchy: a screen reader moves by
    // them, so rendering five sections as five list rows removes five landmarks (0001).
    const question: Question = {
      kind: "repeat", id: "t.values", instances: "section", label: "Value",
      min: 3, max: 3, fields: FIELDS,
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.equal(html.match(/<h3>/g)?.length, 3);
    assert.ok(html.includes("<h3>Value 1 — "));
    assert.ok(html.includes("<h3>Value 3 — "));
    assert.ok(!html.includes("<ol"));
  });

  it("renderQuestion_RowInstances_StayANumberedListWithNoHeadings", () => {
    // Arrange — negative case: short notes do not earn a heading each, and Day 1's
    // chapters read worse with one.
    const question: Question = {
      kind: "repeat", id: "t.chapters", instances: "row", label: "Chapter",
      min: 3, max: 3, fields: FIELDS,
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.ok(html.includes("<ol"));
    assert.ok(!html.includes("<h3"));
  });

  it("renderQuestion_SectionInstances_PutTheFirstFieldInTheHeading", () => {
    // Arrange — "Value 1 — ______" is the reader naming the section, so that blank
    // belongs in the heading rather than beneath it.
    const question: Question = {
      kind: "repeat", id: "t.values", instances: "section", label: "Value",
      min: 1, max: 1, fields: FIELDS,
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.ok(/<h3>Value 1 — <span[^>]*data-field="t\.values\.name"/.test(html));
    assert.ok(html.includes('data-field="t.values.definition"'));
  });
});
