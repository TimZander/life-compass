import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { documentTitle, layout, SITE_TITLE } from "./layout.ts";
import { ROOT } from "./build.ts";

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

  /**
   * The Jekyll layout still serves the live domain until the DNS cutover, so the two
   * templates coexist and both files say they must be kept in step. Saying so is not a
   * mechanism; this is. Delete it with `_layouts/` when the cutover lands.
   */
  it("layout_NavEntries_MatchTheJekyllLayoutStillServingProduction", async () => {
    // Arrange
    const jekyll = await readFile(path.join(ROOT, "_layouts", "default.html"), "utf8");
    const jekyllNav = /<nav class="endnav">([\s\S]*?)<\/nav>/.exec(jekyll)?.[1];
    assert.ok(jekyllNav !== undefined, "could not find the endnav block in _layouts/default.html");
    const jekyllHrefs = [...jekyllNav.matchAll(/'([^']+)'\s*\|\s*relative_url/g)].map(
      (match) => match[1],
    );

    // Act
    const renderedNav = /<nav class="endnav">([\s\S]*?)<\/nav>/.exec(layout("", null))?.[1];
    assert.ok(renderedNav !== undefined, "could not find the endnav block in the typed layout");
    const typedHrefs = [...renderedNav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    // Assert
    assert.deepEqual(typedHrefs, jekyllHrefs);
  });
});
