import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSlugger, slugify } from "./slug.ts";

describe("slugify", () => {
  it("slugify_PlainHeading_LowercasesAndHyphenates", () => {
    // Arrange
    const heading = "Where the exercises come from";

    // Act
    const result = slugify(heading);

    // Assert — this exact slug is the target of a link in README.md.
    assert.equal(result, "where-the-exercises-come-from");
  });

  it("slugify_HeadingWithEmDash_KeepsTheDoubleHyphen", () => {
    // Arrange — the em dash is deleted, and the space either side of it becomes a
    // hyphen, so two hyphens survive. with-a-partner.md links to this exact anchor.
    const heading = "Add-on A — Outside input";

    // Act
    const result = slugify(heading);

    // Assert
    assert.equal(result, "add-on-a--outside-input");
  });

  it("slugify_HeadingWithPunctuationAndDigits_DropsPunctuationKeepsDigits", () => {
    // Arrange
    const heading = "A2 — Ask 3–5 people (needs lead time)";

    // Act
    const result = slugify(heading);

    // Assert — the en dash inside "3–5" is deleted rather than replaced, so the
    // digits run together. Matching GitHub matters more here than looking tidy.
    assert.equal(result, "a2--ask-35-people-needs-lead-time");
  });

  it("slugify_HeadingWithAmpersand_DropsIt", () => {
    // Arrange
    const heading = "Cultural & philosophical roots";

    // Act
    const result = slugify(heading);

    // Assert
    assert.equal(result, "cultural--philosophical-roots");
  });

  it("slugify_EmptyHeading_ReturnsEmptyString", () => {
    // Arrange
    const heading = "";

    // Act
    const result = slugify(heading);

    // Assert
    assert.equal(result, "");
  });

  it("slugify_HeadingOfOnlyPunctuation_ReturnsEmptyString", () => {
    // Arrange — negative case: nothing survives the filter.
    const heading = "—:.,()";

    // Act
    const result = slugify(heading);

    // Assert
    assert.equal(result, "");
  });
});

describe("createSlugger", () => {
  it("createSlugger_RepeatedHeadings_AppendsIncrementingSuffix", () => {
    // Arrange
    const heading = "Notes";
    const slug = createSlugger();

    // Act
    const first = slug(heading);
    const second = slug(heading);
    const third = slug(heading);

    // Assert
    assert.equal(first, "notes");
    assert.equal(second, "notes-1");
    assert.equal(third, "notes-2");
  });

  it("createSlugger_SeparateInstances_DoNotShareCounters", () => {
    // Arrange — sluggers are per-page, so one page's headings must not shift
    // another page's anchors.
    const heading = "Notes";
    const pageOne = createSlugger();
    const pageTwo = createSlugger();

    // Act
    pageOne(heading);
    const result = pageTwo(heading);

    // Assert
    assert.equal(result, "notes");
  });
});
