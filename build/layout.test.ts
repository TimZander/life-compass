import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Whether the page has anything to answer; the caller decides from the schema. */
const ANSWERABLE = true;
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
    const result = layout("<p>body</p>", pageTitle, ANSWERABLE);

    // Assert
    assert.ok(result.includes("&lt;script&gt;&quot;x&quot; · Life Compass"));
    assert.ok(!result.includes("<script>"));
  });

});

describe("the backup control", () => {
  it("layout_AnAnswerablePage_CarriesTheBackupControlHidden", () => {
    // Arrange — 0008 · C3 makes an export the only copy that survives eviction or
    // uninstall, so it is a first-class control rather than a settings item. It ships
    // `hidden` because until app.ts has a working store there is nothing behind it, and a
    // button that does nothing when pressed is worse than one that is not there.
    // Act
    const html = layout("<p>body</p>", "A worksheet", true);

    // Assert
    assert.ok(html.includes('id="backup"'), "no backup control");
    assert.ok(html.includes("hidden>"), "the control is not hidden until a store opens");
    assert.ok(html.includes('aria-labelledby="backup-heading"'), "the region has no name");
    assert.ok(html.includes('id="backup-save"'), "no backup button");
  });

  it("layout_APageWithNothingToAnswer_HasNoBackupControl", () => {
    // Arrange — negative case. Export covers the whole store so it would work anywhere,
    // but a decision record is not somewhere anybody is answering anything.
    // Act
    const html = layout("<p>Just prose.</p>", "A decision record", false);

    // Assert
    assert.ok(!html.includes('id="backup"'), "a page with nothing to answer offered a backup");
  });

  it("layout_TheBackupControl_SaysWhatTheFileIsAndThatItCoversEverything", () => {
    // Arrange — 0009 · C1 asks for plaintext to be stated plainly, accurate and not
    // alarming. The scope wording matters too: the button sits on one worksheet and does
    // not mean that worksheet.
    // Act
    const html = layout("<p>body</p>", "A worksheet", true);

    // Assert
    assert.ok(html.includes("all your answers"), "the control implies it covers this page only");
    assert.ok(html.includes("not encrypted"), "the control does not say the file is plaintext");
  });
});
