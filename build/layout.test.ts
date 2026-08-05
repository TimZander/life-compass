import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    const result = layout("<p>body</p>", pageTitle);

    // Assert
    assert.ok(result.includes("&lt;script&gt;&quot;x&quot; · Life Compass"));
    assert.ok(!result.includes("<script>"));
  });

});

describe("wordmark", () => {
  it("layout_WordmarkPath_IsTheSameDrawingAsTheIconCompassRose", () => {
    // The installed icon and the page header must be the same drawing, not two shapes that
    // merely resemble each other — icons.ts lifts its coordinates from this path. This
    // fails the build if the two ever drift apart.
    // Arrange
    const COORDS_PER_POINT = 2;
    const html = layout("<p>body</p>", null);

    // Act — pull the compass-rose path out of the wordmark SVG and read its coordinates.
    const match = html.match(/class="wm-mark"[^>]*>\s*<path d="([^"]+)"/);
    const numbers = (match?.[1] ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: number[][] = [];
    for (let i = 0; i < numbers.length; i += COORDS_PER_POINT) {
      points.push([numbers[i] ?? NaN, numbers[i + 1] ?? NaN]);
    }

    // Assert
    assert.ok(match, "the wordmark should carry a compass-rose path");
    assert.deepEqual(
      points,
      COMPASS_ROSE.map(([x, y]) => [x, y]),
    );
  });
});
