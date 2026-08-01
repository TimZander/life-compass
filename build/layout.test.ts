import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentTitle, layout, SITE_TITLE } from "./layout.ts";

describe("documentTitle", () => {
  it("documentTitle_PageTitleMatchingSiteTitle_IsNotDoubled", () => {
    // Arrange — the home page's own H1 is the site title.
    const pageTitle = SITE_TITLE;

    // Act
    const result = documentTitle(pageTitle);

    // Assert
    assert.equal(result, SITE_TITLE);
  });

  it("documentTitle_DistinctPageTitle_IsSuffixedWithSiteTitle", () => {
    // Arrange
    const pageTitle = "Day 1 — Excavation";

    // Act
    const result = documentTitle(pageTitle);

    // Assert
    assert.equal(result, "Day 1 — Excavation · Life Compass");
  });

  it("documentTitle_NoPageTitle_FallsBackToSiteTitle", () => {
    // Arrange — negative case: a page with no H1 at all.
    const pageTitle = null;

    // Act
    const result = documentTitle(pageTitle);

    // Assert
    assert.equal(result, SITE_TITLE);
  });
});

describe("layout", () => {
  it("layout_TitleContainingMarkup_EscapesItInTheTitleElement", () => {
    // Arrange — negative case: a heading is arbitrary author text, not trusted markup.
    const pageTitle = '<script>"x"';

    // Act
    const result = layout("<p>body</p>", pageTitle);

    // Assert
    assert.ok(result.includes("&lt;script&gt;&quot;x&quot; · Life Compass"));
    assert.ok(!result.includes("<script>"));
  });

});
