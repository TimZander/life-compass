import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Whether the page has anything to answer; the caller decides from the schema. */
const ANSWERABLE = true;
import { documentTitle, layout, SITE_TITLE } from "./layout.ts";
import { COMPASS_ROSE } from "./icons.ts";

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

describe("the backup and restore controls", () => {
  /** Every id `export.ts` and `import.ts` look up by name. */
  const REQUIRED = [
    "backup",
    "backup-save",
    "restore",
    "restore-file",
    "restore-confirm",
    "restore-chosen",
    "restore-summary",
    "restore-backup-first",
    "restore-ack",
    "restore-go",
    "restore-cancel",
  ];

  it("layout_TheBackupPage_CarriesEveryElementTheClientLooksUp", () => {
    // Arrange — the client finds these by id and gives up with a console message if one is
    // missing, so a rename ships a control that silently is not there. Nothing pinned the
    // restore ids at all: renaming any of them left the whole suite green.
    // Act
    const html = layout("<p>body</p>", "Backup", true);

    // Assert
    for (const id of REQUIRED) {
      assert.ok(html.includes(`id="${id}"`), `the page does not carry id="${id}"`);
    }
  });

  it("layout_BothControls_ShipHiddenAndTheReplaceButtonShipsLocked", () => {
    // Arrange — a control visible before the client can work is one somebody presses and
    // watches do nothing; a Replace button live on page load is worse than that.
    // Act
    const html = layout("<p>body</p>", "Backup", true);

    // Assert
    assert.ok(/<section class="tools" id="backup"[^>]*\shidden>/.test(html), "backup not hidden");
    assert.ok(/<section class="tools" id="restore"[^>]*\shidden>/.test(html), "restore not hidden");
    assert.ok(/id="restore-confirm"[^>]*\shidden>/.test(html), "the confirmation is not hidden");
    assert.ok(
      /id="restore-go"[^>]*aria-disabled="true"/.test(html),
      "the replace button ships unlocked",
    );
  });

  it("layout_TheRestoreControl_WarnsThatReplacingCannotBeUndone", () => {
    // Arrange — the one irreversible action in the application. The warning is the reason
    // the confirmation is more than a button.
    // Act
    const html = layout("<p>body</p>", "Backup", true);

    // Assert
    assert.ok(html.includes("only way back"), "no warning that there is no way back");
    assert.ok(html.includes("I have saved a copy"), "no acknowledgement to tick");
  });

  it("layout_AnyOtherPage_CarriesNeitherControl", () => {
    // Arrange — negative case. They belong on the page that exists for them, not under
    // every worksheet: export covers the whole store, and at the foot of Day 3 it read as
    // "back up Day 3".
    // Act
    const html = layout('<p><span class="fill" data-field="t.a">___</span></p>', "A worksheet", false);

    // Assert
    for (const id of REQUIRED) {
      assert.ok(!html.includes(`id="${id}"`), `a worksheet carries id="${id}"`);
    }
  });
});

describe("the wordmark", () => {
  it("layout_TheWordmarkPath_IsTheSameDrawingAsTheIcon", () => {
    // The installed icon and the page header must be one drawing rather than two shapes
    // that resemble each other — build/icons.ts rasterises the same coordinates. Nothing
    // else holds them together, so this fails if either is edited alone.
    const COORDS_PER_POINT = 2;
    const html = layout("<p>body</p>", null, false);

    // Act — read the coordinates back out of the rendered wordmark.
    const path = /class="wm-mark"[^>]*>\s*<path d="([^"]+)"/.exec(html);
    const numbers = (path?.[1] ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: number[][] = [];
    for (let at = 0; at < numbers.length; at += COORDS_PER_POINT) {
      points.push(numbers.slice(at, at + COORDS_PER_POINT));
    }

    // Assert
    assert.deepEqual(points, COMPASS_ROSE.map(([x, y]) => [x, y]));
  });
});
