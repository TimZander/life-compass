import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Any stable fingerprint; layout only passes it through. */
const DIGEST = "0123456789ab";
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
    const result = layout("<p>body</p>", pageTitle, DIGEST);

    // Assert
    assert.ok(result.includes("&lt;script&gt;&quot;x&quot; · Life Compass"));
    assert.ok(!result.includes("<script>"));
  });

});

describe("the schema fingerprint on the page", () => {
  it("layout_AnyPage_CarriesTheSchemaFingerprintForAnExportToRecord", () => {
    // Arrange — the client cannot work this out for itself: connect-src 'none' stops it
    // fetching questions.json, and 0013 has the binding read everything from the markup.
    // So the build stamps it here, and an export reads it from the page (0009).
    // Act
    const html = layout("<p>body</p>", "A page", DIGEST);

    // Assert
    assert.ok(
      html.includes(`<meta name="life-compass-schema" content="${DIGEST}">`),
      "the page does not carry the schema fingerprint",
    );
  });
});
