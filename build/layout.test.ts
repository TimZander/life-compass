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

describe("the backup control", () => {
  const BLANK = '<p><span class="fill" data-field="t.a" data-label="A">______</span></p>';

  it("layout_APageWithBlanks_CarriesTheBackupControlHidden", () => {
    // Arrange — 0008 · C3 makes an export the only copy that survives eviction or
    // uninstall, so it is a first-class control rather than a settings item. It ships
    // `hidden` because until app.ts has a working store there is nothing behind it, and a
    // button that does nothing when pressed is worse than one that is not there.
    // Act
    const html = layout(BLANK, "A worksheet", DIGEST);

    // Assert
    assert.ok(html.includes('<section class="backup" id="backup" hidden>'), "no backup control");
    assert.ok(html.includes('id="backup-save"'), "no backup button");
  });

  it("layout_APageWithNoBlanks_HasNoBackupControl", () => {
    // Arrange — negative case. Export covers the whole store so it would work anywhere,
    // but a decision record is not somewhere anybody is answering anything.
    // Act
    const html = layout("<p>Just prose.</p>", "A decision record", DIGEST);

    // Assert
    assert.ok(!html.includes('id="backup"'), "a page with nothing to answer offered a backup");
  });

  it("layout_TheBackupControl_SaysWhatTheFileIsAndThatItCoversEverything", () => {
    // Arrange — 0009 · C1 asks for plaintext to be stated plainly, accurate and not
    // alarming. The scope wording matters too: the button sits on one worksheet and does
    // not mean that worksheet.
    // Act
    const html = layout(BLANK, "A worksheet", DIGEST);

    // Assert
    assert.ok(html.includes("all your answers"), "the control implies it covers this page only");
    assert.ok(html.includes("not encrypted"), "the control does not say the file is plaintext");
  });
});
