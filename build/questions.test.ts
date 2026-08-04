import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANCHOR, checkRegistry, checkSchema, loadSchema, renderQuestion } from "./questions.ts";
import { gapsOf, identifiersOf, type Question } from "../src/questions/types.ts";
import { WORKSHEETS, type Worksheet } from "../src/questions/index.ts";

/**
 * The text a reader actually sees, with attributes stripped.
 *
 * A label can legitimately appear in `data-label` — that is how the bound control gets its
 * accessible name — while being deliberately absent from the printed page. Asserting
 * against the raw HTML conflates the two, and would pass or fail for the wrong reason.
 */
function printed(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

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

  it("renderQuestion_SingleQuestion_DoesNotPrintItsLabelButStillCarriesItForAScreenReader", () => {
    // Arrange — the prose immediately above already asks the question, so printing the
    // label produced "Patterns — what kind of work…" followed by "Patterns: ____". The
    // label is still the only thing that can name the control once #24 binds it: derived
    // from the surrounding prose instead, the name came out as the literal "______".
    // Act
    const html = renderQuestion(NOTE);

    // Assert
    assert.ok(!printed(html).includes("Note"), "the label was printed");
    assert.ok(html.includes('data-label="Note"'), "the label was not carried for a screen reader");
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

  it("checkSchema_StraightDoubleQuoteInATemplate_IsReported", () => {
    // Arrange — negative case. The anchor page's two quoted sentences needed curly quotes
    // and got them by hand; this is the build knowing instead of the author remembering.
    const question: Question = {
      kind: "sentence",
      id: "t.quoted",
      template: String.fromCharCode(34) + "I default to {rule}." + String.fromCharCode(34),
      fields: [{ id: "rule", label: "Rule", size: "short" }],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("straight double quote")));
  });

  it("checkSchema_ThreeDotsAndDoubleHyphen_AreReported", () => {
    // Arrange — negative case: the typographer would have made these … and –, and it
    // never sees generated text.
    const question: Question = {
      kind: "group",
      id: "t.g",
      fields: [
        { id: "a", label: "Wait for it...", size: "long" },
        { id: "b", label: "Pages 3--4", size: "long" },
      ],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("three dots")));
    assert.ok(problems.some((problem) => problem.includes("two hyphens")));
  });

  it("checkSchema_TypographicPunctuation_IsAccepted", () => {
    // Arrange — the positive counterpart, so the rules cannot be satisfied by banning the
    // punctuation outright. An em dash is not two hyphens and must pass.
    const question: Question = {
      kind: "group",
      id: "t.g",
      fields: [{ id: "a", label: "Wait for it… — “quoted”, it’s fine", size: "long" }],
    };

    // Act & Assert
    assert.deepEqual(checkSchema(loadSchema([{ source: "t.md", questions: [question] }])), []);
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

  it("checkSchema_DuplicateFieldId_IsNotAlsoReportedAsACollision", () => {
    // Arrange — the identifier check sees the duplicate too, as an id already owned by
    // the question that owns it. Reporting it there would read `t.g.f is produced by
    // both t.g and t.g` — one question named twice, which sounds like a second problem
    // and is the same one. checkParts' message must be the only one.
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

    // Assert — exact equality, so a second message of any wording fails here.
    assert.deepEqual(problems, ['t.g declares "f" twice']);
  });

  it("checkSchema_QuestionsDeclaredInEitherOrder_AreBothReported", () => {
    // Arrange — negative case, and one nothing else catches: checkParts looks inside a
    // single question, loadSchema compares question ids, and checkRegistry collapses
    // both into one `used` entry. The identifier is the storage key, so this is two
    // questions writing over each other. The collision is also symmetric — catching it
    // only when the repeat is declared first would make the check depend on file order.
    const repeat: Question = {
      kind: "repeat", id: "day1.chapters", instances: "row", label: "Chapter",
      min: 1, max: 1, fields: [{ id: "title", label: "Title", size: "long" }],
    };
    const group: Question = {
      kind: "group",
      id: "day1",
      fields: [{ id: "chapters", label: "Chapters", size: "long" }],
    };

    // Act & Assert
    for (const questions of [[repeat, group], [group, repeat]]) {
      const problems = checkSchema(loadSchema([{ source: "t.md", questions }]));
      assert.ok(problems.some((problem) => problem.includes("is produced by both")));
    }
  });

  it("checkSchema_EmptyPartId_IsReported", () => {
    // Arrange — negative case: a blank segment makes the identifier unaddressable.
    // `day1.chapters.` names nothing a reader could ever be shown or given back. This
    // is the TRAILING position; the two tests below cover the middle and the front.
    const question: Question = {
      kind: "group",
      id: "day1.chapters",
      fields: [{ id: "", label: "Nameless", size: "long" }],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("blank segment")));
  });

  it("checkSchema_PartIdStartingWithADot_IsReported", () => {
    // Arrange — negative case with the blank segment MID-identifier: `day1..title`
    // splits into "day1", "", "title". A rule that looked only at the identifier's
    // ends — `id.endsWith(".")`, say — would pass this.
    const question: Question = {
      kind: "group",
      id: "day1",
      fields: [{ id: ".title", label: "Title", size: "long" }],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("blank segment")));
  });

  it("checkSchema_QuestionIdStartingWithADot_IsReported", () => {
    // Arrange — negative case with the blank segment LEADING: `.day1` splits into
    // "", "day1". A single question, so the id under test is the only identifier.
    const question: Question = { kind: "single", id: ".day1", label: "Note", size: "long" };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("blank segment")));
  });

  it("checkSchema_WhitespaceOnlyPartId_IsReported", () => {
    // Arrange — negative case an empty-string rule alone missed: `{ id: "  " }` passed
    // and shipped `data-field="t.g.  "`, an address that differs from a truly empty one
    // only in characters nobody can see.
    const question: Question = {
      kind: "group",
      id: "t.g",
      fields: [{ id: "  ", label: "Blank", size: "long" }],
    };

    // Act
    const problems = checkSchema(loadSchema([{ source: "t.md", questions: [question] }]));

    // Assert
    assert.ok(problems.some((problem) => problem.includes("blank segment")));
  });

  it("checkSchema_GroupPrefixingItsOwnFields_IsAccepted", () => {
    // Arrange — the positive counterpart. Every group identifier is a dotted prefix of
    // its own field identifiers; that IS the structure, and 141 such pairs exist in the
    // shipped schema. A check that flagged them would flag the whole workbook.
    const question: Question = {
      kind: "group",
      id: "day1.chapters",
      fields: [
        { id: "title", label: "Title", size: "long" },
        { id: "learned", label: "Learned", size: "long" },
      ],
    };

    // Act & Assert
    assert.deepEqual(checkSchema(loadSchema([{ source: "t.md", questions: [question] }])), []);
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

    // Assert — not printed, but each row is still named distinctly, or a reader tabbing
    // through hears "Value" three times with nothing to say which row they are in.
    assert.ok(!printed(html).includes("Value"), "the label was printed");
    assert.deepEqual(
      [...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]),
      ["Value 1", "Value 2", "Value 3"],
    );
    assert.equal(html.match(/<li data-instance="\d+">/g)?.length, 3);
  });
});

describe("what a screen reader is told", () => {
  it("renderQuestion_SectionRepeat_NamesEveryBlankByItsInstance", () => {
    // Arrange — the heading blank and the fields beneath it both need the instance number,
    // or a reader tabbing through a five-value section hears "Value" and "My definition"
    // five times each with nothing to say which one they are in.
    const question: Question = {
      kind: "repeat", id: "t.values", instances: "section", label: "Value",
      min: 2, max: 2,
      fields: [
        { id: "name", label: "Value", size: "long" },
        { id: "definition", label: "My definition", size: "long" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.deepEqual(
      [...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]),
      ["Value 1 — Value", "Value 1 — My definition", "Value 2 — Value", "Value 2 — My definition"],
    );
  });

  it("renderQuestion_SentenceGap_NamesEachBlankAfterItsOwnField", () => {
    // Arrange — a sentence has no label of its own; the template is the prose. The field
    // labels read as the fragments they complete.
    const question: Question = {
      kind: "sentence", id: "t.enough",
      template: "The world has enough {excess}. It needs more {lack}.",
      fields: [
        { id: "excess", label: "Enough of", size: "short" },
        { id: "lack", label: "More of", size: "short" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assert.deepEqual(
      [...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]),
      ["Enough of", "More of"],
    );
  });

  it("renderQuestion_EveryShape_GivesEveryBlankANonEmptyName", () => {
    // Arrange — negative case across the real schema rather than a fixture. A blank with no
    // name, or one named after its own underscores, is what a screen reader reads out.
    // Act & Assert
    for (const worksheet of WORKSHEETS) {
      for (const question of worksheet.questions) {
        const html = renderQuestion(question);
        const blanks = html.match(/class="fill(-sm)?"/g)?.length ?? 0;
        const labels = [...html.matchAll(/data-label="([^"]*)"/g)].map((match) => match[1]);
        assert.equal(labels.length, blanks, `${question.id} has an unnamed blank`);
        for (const label of labels) {
          assert.ok(label !== undefined && label.trim() !== "", `${question.id} has a blank name`);
          assert.ok(!label.includes("___"), `${question.id} is named after its underscores`);
        }
      }
    }
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
    assert.equal(html.match(/<li data-instance="\d+">/g)?.length, 2);
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

describe("instance containment", () => {
  // What these tests pin, and only this: every blank an instance owns sits inside the
  // element carrying its slot marker, once, in declared order — and counting proves no
  // blank sits outside every instance and no marker repeats. They deliberately do NOT
  // pin the blank glyph, class names, separators or newlines: the golden strings that
  // used to live here failed on a seven-underscore blank and on an attribute reorder,
  // neither of which is a containment bug. Splitting on the marker alone cannot prove
  // containment — a render with an empty marked element followed by the blanks passes
  // any substring check. Knowing where the marked element ENDS can, which is what
  // `elementAt` does by balancing the element's own tag.
  //
  // Every fixture asks for at least two instances, because no shipped repeat has a min
  // below two: a one-slot fixture pins slot 0 only, and a renderer broken for every
  // later slot would pass it.

  /** The complete element carrying `marker`, sliced out by balancing its tag. */
  function elementAt(html: string, marker: string): string {
    const at = html.indexOf(marker);
    assert.notEqual(at, -1, `no element carries ${marker}`);
    const open = html.lastIndexOf("<", at);
    const name = /^<([a-z0-9]+)/.exec(html.slice(open))?.[1];
    assert.ok(name !== undefined, `no tag opens before ${marker}`);
    const tags = new RegExp(`<${name}[\\s>]|</${name}>`, "g");
    tags.lastIndex = open;
    let depth = 0;
    for (let match = tags.exec(html); match !== null; match = tags.exec(html)) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        return html.slice(open, match.index + match[0].length);
      }
    }
    assert.fail(`the <${name}> carrying ${marker} is never closed`);
  }

  /** Every `data-field` in a fragment, in document order. */
  function fieldsIn(fragment: string): readonly string[] {
    return [...fragment.matchAll(/data-field="([^"]*)"/g)].map((match) => match[1] ?? "");
  }

  /** Each of `min` slots holds exactly `fields`, and no blank or marker escapes them. */
  function assertContainment(html: string, min: number, fields: readonly string[]): void {
    for (let index = 0; index < min; index += 1) {
      const instance = elementAt(html, `data-instance="${index}"`);
      assert.deepEqual(fieldsIn(instance), fields, `blanks inside instance ${index}`);
    }
    // Marked elements are siblings, so if each holds its own blanks and the totals
    // match, nothing sits outside every instance and no marker appears twice.
    assert.equal(html.match(/data-instance="/g)?.length, min, "one marker per slot");
    assert.equal(fieldsIn(html).length, min * fields.length, "no blank outside a slot");
  }

  it("renderQuestion_RowInstances_WrapEveryFieldInTheirMarkedListItem", () => {
    // Arrange
    const MIN = 3;
    const question: Question = {
      kind: "repeat", id: "t.chapters", instances: "row", label: "Chapter",
      min: MIN, max: MIN,
      fields: [
        { id: "title", label: "Title", size: "long" },
        { id: "learned", label: "Learned", size: "long" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert — the nested list holding the second field is inside the marked item too.
    assertContainment(html, MIN, ["t.chapters.title", "t.chapters.learned"]);
  });

  it("renderQuestion_LoneFieldRowInstances_KeepTheBlankInsideTheirMarkedListItem", () => {
    // Arrange — the shape the other three do not touch, and the commonest one shipped:
    // 17 of the schema's 34 repeats are a row of exactly one field. The renderer takes
    // a separate branch for it — no nested list — so containment for the two-field row
    // says nothing about this one.
    const MIN = 2;
    const question: Question = {
      kind: "repeat", id: "t.ten", instances: "row", label: "Value",
      min: MIN, max: MIN,
      fields: [{ id: "value", label: "Value", size: "long" }],
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assertContainment(html, MIN, ["t.ten.value"]);
  });

  it("renderQuestion_SectionInstances_WrapEachHeadingAndItsFieldsTogether", () => {
    // Arrange — the shape that needed a new element: before it, the heading and the
    // field list were siblings with nothing to belong to.
    const MIN = 3;
    const question: Question = {
      kind: "repeat", id: "t.values", instances: "section", label: "Value",
      min: MIN, max: MIN,
      fields: [
        { id: "name", label: "Value", size: "long" },
        { id: "definition", label: "My definition", size: "long" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert — the heading's blank counts as inside its wrapper, not before it.
    assertContainment(html, MIN, ["t.values.name", "t.values.definition"]);
  });

  it("renderQuestion_LineInstances_KeepEveryFieldOnTheirMarkedRow", () => {
    // Arrange
    const MIN = 2;
    const question: Question = {
      kind: "repeat", id: "t.generated", instances: "line", label: "Value",
      min: MIN, max: MIN,
      fields: [
        { id: "value", label: "Value", size: "short" },
        { id: "evidence", label: "Evidence", size: "short" },
      ],
    };

    // Act
    const html = renderQuestion(question);

    // Assert
    assertContainment(html, MIN, ["t.generated.value", "t.generated.evidence"]);
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
