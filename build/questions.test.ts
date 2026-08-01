import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRegistry, loadSchema, renderQuestion, ANCHOR } from "./questions.ts";
import { identifiersOf, type Question } from "../src/questions/types.ts";
import type { Worksheet } from "../src/questions/index.ts";

const CHAPTERS: Question = {
  kind: "repeat",
  id: "t.chapters",
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
