import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANCHOR, checkRegistry, checkSchema, loadSchema, renderQuestion } from "./questions.ts";
import { gapsOf, identifiersOf, type Question } from "../src/questions/types.ts";
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

  it("identifiersOf_ChecklistQuestion_IncludesEveryItem", () => {
    // Arrange — a checklist carries items rather than fields, so it takes its own branch.
    const checklist: Question = {
      kind: "checklist",
      id: "t.ready",
      items: [
        { id: "a", label: "First" },
        { id: "b", label: "Second" },
      ],
    };

    // Act & Assert
    assert.deepEqual(identifiersOf(checklist), ["t.ready", "t.ready.a", "t.ready.b"]);
  });
});

describe("gapsOf", () => {
  it("gapsOf_TemplateWithGaps_ReturnsThemInOrder", () => {
    // Act & Assert
    assert.deepEqual(gapsOf("Enough {excess}, more {lack}."), ["excess", "lack"]);
  });

  it("gapsOf_RepeatedName_KeepsBothOccurrences", () => {
    // Arrange — checkSchema compares against a Set, so it needs the duplicate preserved
    // here to be able to notice it at all.
    // Act & Assert
    assert.deepEqual(gapsOf("{x} and {x}"), ["x", "x"]);
  });

  it("gapsOf_ProseWithNoGaps_IsEmpty", () => {
    // Act & Assert — negative case: braces are not gaps unless they name one.
    assert.deepEqual(gapsOf("A sentence with { spaces } and no gaps."), []);
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
    // Arrange — the sheet prints the floor of the range: two instances of two fields.
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

  it("checkSchema_GapWithNoField_IsReported", () => {
    // Arrange — negative case, and invisible in the output: a gap with no field renders
    // as nothing at all.
    const broken: Question = { ...SENTENCE, template: "Enough {excess}, more {missing}." };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [broken] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("{missing} gap with no matching field")));
  });

  it("checkSchema_FieldWithNoGap_IsReported", () => {
    // Arrange — negative case: a field the reader is never shown, but which the
    // registry, storage and the assistant contract all believe exists.
    const broken: Question = { ...SENTENCE, template: "The world has enough {excess}." };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [broken] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes('defines "lack"')));
  });

  it("checkSchema_RepeatedGapName_IsReported", () => {
    // Arrange — negative case that the set comparison alone calls agreement: both blanks
    // would render carrying one data-field, so #24 would store one answer for two.
    const broken: Question = {
      kind: "sentence",
      id: "t.twice",
      template: "Enough {excess}. More {excess}.",
      fields: [{ id: "excess", label: "Enough of", size: "short" }],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [broken] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("names the same gap more than once")));
  });

  it("checkSchema_RealSchema_IsClean", () => {
    // Act & Assert — the shipped sentences and their fields must agree.
    assert.deepEqual(checkSchema(loadSchema()), []);
  });
});

describe("checkSchema", () => {
  it("checkSchema_StraightApostropheInALabel_IsReported", () => {
    // Arrange — negative case, and invisible in a diff: generated text never reaches
    // markdown-it's typographer, so a straight apostrophe ships beside curly ones set
    // from the same paragraph.
    const question: Question = {
      kind: "group",
      id: "t.g",
      fields: [{ id: "f", label: "What doesn't serve you?", size: "long" }],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("straight apostrophe")));
  });

  it("checkSchema_CurlyApostropheInALabel_IsAccepted", () => {
    // Arrange — the positive counterpart, so the rule cannot be satisfied by banning
    // apostrophes outright.
    const question: Question = {
      kind: "group",
      id: "t.g",
      fields: [{ id: "f", label: "What doesn’t serve you?", size: "long" }],
    };

    // Act & Assert
    assert.deepEqual(checkSchema(loadSchema([{ source: "t.md", questions: [question] }])), []);
  });

  it("checkSchema_DuplicateFieldId_IsReported", () => {
    // Arrange — negative case: identifiersOf emits both and checkRegistry's set collapses
    // them, so nothing else in the build can see two blanks sharing one identifier.
    const question: Question = {
      kind: "group",
      id: "t.g",
      fields: [
        { id: "f", label: "First", size: "long" },
        { id: "f", label: "Second", size: "long" },
      ],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes('declares "f" twice')));
  });

  it("checkSchema_QuestionWithNoFields_IsReported", () => {
    // Arrange — negative case: renderQuestion returns an empty string for this, so the
    // anchor resolves and the page simply has no question where one was asked for.
    const question: Question = { kind: "group", id: "t.g", fields: [] };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("nothing to fill in")));
  });

  it("checkSchema_MaxBelowMin_IsReported", () => {
    // Arrange — negative case: max is what the sheet prints, so an inverted range prints
    // fewer slots than the worksheet requires, or none at all.
    const question: Question = { ...CHAPTERS, min: 4, max: 2 };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("max 2 below min 4")));
  });

  it("checkSchema_MinOfZero_IsReported", () => {
    // Arrange — negative case: a worksheet prints at least one of anything it asks for.
    const question: Question = { ...CHAPTERS, min: 0, max: 0 };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("a worksheet prints at least one")));
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
    assert.ok(html.includes('disabled="disabled"'));
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

describe("field labels", () => {
  function group(label: string): Question {
    return { kind: "group", id: "t.g", fields: [{ id: "f", label, size: "long" }] };
  }

  it("renderQuestion_LabelEndingInAQuestionMark_IsPrintedAsWritten", () => {
    // Arrange — Day 5's labels are the questions themselves. Appending a separator gave
    // "Does it use my passions, or just my skills?: ______" on twelve rows.
    // Act
    const html = renderQuestion(group("Does it use my passions, or just my skills?"));

    // Assert
    assert.ok(html.includes("or just my skills? <span"));
    assert.ok(!html.includes("?:"));
    assert.ok(!html.includes("<strong>"));
  });

  it("renderQuestion_LabelNamingTheAnswer_IsABoldLeadIn", () => {
    // Arrange — "**My definition:**" is how every worksheet wrote these before the
    // migration, and it is what set Day 5's "One change" apart from the questions above
    // it. Negative counterpart of the case above.
    // Act
    const html = renderQuestion(group("My definition"));

    // Assert
    assert.ok(html.includes("<strong>My definition:</strong> <span"));
  });

  it("renderQuestion_LoneFieldRestatingTheGroupLabel_PrintsOnlyTheBlank", () => {
    // Arrange — ten rows reading "Value: ____" under a heading that already says
    // "Narrow to 10"; the source printed bare numbered blanks.
    const question: Question = {
      kind: "repeat", id: "t.ten", instances: "row", label: "Value",
      min: 3, max: 3, fields: [{ id: "value", label: "Value", size: "long" }],
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.ok(!html.includes("Value"));
    assert.equal(html.match(/<li>/g)?.length, 3);
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
    assert.equal(html.match(/<h3 id=/g)?.length, 3);
    assert.ok(html.includes('<h3 id="t-values-1">Value 1 — '));
    assert.ok(html.includes('<h3 id="t-values-3">Value 3 — '));
    assert.ok(!html.includes("<ol"));
  });

  it("renderQuestion_LineInstances_PutEveryFieldOnOneRow", () => {
    // Arrange — ten brainstormed values stacked two-deep is twenty lines of page for ten
    // words, and the list stops reading as the quick scan the exercise asks for.
    const question: Question = {
      kind: "repeat", id: "t.generated", instances: "line", label: "Value",
      min: 2, max: 2,
      fields: [
        { id: "value", label: "Value", size: "short" },
        { id: "evidence", label: "Evidence", size: "short" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert — two rows, both fields on each, and the label matching the group's collapses
    // exactly as it does for a single-field row.
    assert.equal(html.match(/<li>/g)?.length, 2);
    assert.ok(!html.includes("<ul"));
    assert.ok(html.includes(" — <strong>Evidence:</strong> "));
    assert.ok(!html.includes("<strong>Value:</strong>"));
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
    assert.ok(/<h3 id="t-values-1">Value 1 — <span[^>]*data-field="t\.values\.name"/.test(html));
    assert.ok(html.includes('data-field="t.values.definition"'));
  });
});

describe("repeat ranges", () => {
  it("renderQuestion_GenuineRange_PrintsTheFloorNotTheCeiling", () => {
    // Arrange — "divide your life into 5–8 chapters". Printing eight was tried and read
    // as padding: eight blocks of three fields is a wall of ruled lines. The range is
    // still carried for #24, which is what will let a reader add the sixth.
    const question: Question = { ...CHAPTERS, min: 5, max: 8 };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.equal(html.match(/data-field="t\.chapters\.title"/g)?.length, 5);
    assert.ok(html.includes('data-min="5" data-max="8"'));
  });

  it("renderQuestion_SectionRange_PrintsTheFloorToo", () => {
    // Arrange — negative counterpart: the two shapes must not disagree about how many
    // instances a range means, or one worksheet prints its floor and another its ceiling.
    const question: Question = {
      kind: "repeat", id: "t.themes", instances: "section", label: "Theme",
      min: 3, max: 5,
      fields: [
        { id: "name", label: "Theme", size: "long" },
        { id: "example", label: "Example", size: "long" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.equal(html.match(/<h3 id=/g)?.length, 3);
  });
});
