/**
 * Whole-build checks against the real content.
 *
 * The structural expectations below are deliberately a list of page paths rather than
 * a byte-level snapshot of the rendered HTML. A byte snapshot would fail on every
 * prose edit — training whoever hits it to regenerate without reading — while catching
 * nothing a human would not have noticed anyway. Page-set and title changes are the
 * failures actually worth interrupting for.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPages } from "./build.ts";

/** Every page the site is expected to publish. */
const EXPECTED_PAGES: readonly string[] = [
  "days/day-1-excavation.html",
  "days/day-2-values.html",
  "days/day-3-passions.html",
  "days/day-4-purpose.html",
  "days/day-5-synthesis.html",
  "docs/decisions/0001-voice-first-input-is-a-primary-constraint.html",
  "docs/decisions/0002-typescript-not-jsdoc-typed-javascript.html",
  "docs/decisions/0003-multi-page-static-rendering-no-framework.html",
  "docs/decisions/0004-prose-in-markdown-questions-in-typescript.html",
  "docs/decisions/0005-cloudflare-pages-for-header-control.html",
  "docs/decisions/0006-no-in-app-speech-recognition.html",
  "docs/decisions/0007-clipboard-is-the-airgap.html",
  "docs/decisions/0008-installation-makes-storage-durable.html",
  "docs/decisions/0009-encryption-is-an-opt-in-add-on.html",
  "docs/decisions/0010-printing-is-a-supported-output.html",
  "docs/decisions/index.html",
  "index.html",
  "one-page-anchor.html",
  "optional-add-ons.html",
  "reference/values-list.html",
  "rigorous/day-0-prep.html",
  "rigorous/day-1-excavation.html",
  "rigorous/day-2-values.html",
  "rigorous/day-3-passions.html",
  "rigorous/day-4-purpose.html",
  "rigorous/day-5-synthesis.html",
  "rigorous/index.html",
  "templates/life-compass.html",
  "with-a-partner.html",
];

/** Nav entries every page carries, from the layout. */
const NAV_HREFS: readonly string[] = [
  "/",
  "/one-page-anchor.html",
  "/days/day-1-excavation.html",
  "/rigorous/",
  "/with-a-partner.html",
  "/optional-add-ons.html",
  "/docs/decisions/",
];

/**
 * Answer blanks across the worksheets: 369 wide plus 74 narrow. The count is asserted
 * so that a rendering regression which silently drops the inline HTML — the markers are
 * raw `<span>` in Markdown, so they depend on HTML passthrough staying enabled — fails
 * here rather than on a printed worksheet. Update deliberately when blanks are added.
 */
const EXPECTED_FILL_MARKERS = 443;

describe("buildPages", () => {
  it("buildPages_RealContent_ProducesNoBrokenLinks", async () => {
    // Arrange & Act
    const result = await buildPages();

    // Assert
    assert.deepEqual(
      result.broken.map((link) => `${link.source} -> ${link.raw}`),
      [],
    );
  });

  it("buildPages_RealContent_PublishesExactlyTheExpectedPages", async () => {
    // Arrange & Act
    const result = await buildPages();

    // Assert
    assert.deepEqual([...result.pages.map((page) => page.output)].sort(), [...EXPECTED_PAGES]);
  });

  it("buildPages_ReadmeFiles_BecomeDirectoryIndexes", async () => {
    // Arrange
    const expected = new Map([
      ["README.md", "/"],
      ["rigorous/README.md", "/rigorous/"],
      ["docs/decisions/README.md", "/docs/decisions/"],
    ]);

    // Act
    const result = await buildPages();

    // Assert
    for (const [source, url] of expected) {
      const page = result.pages.find((candidate) => candidate.source === source);
      assert.ok(page !== undefined, `expected a page built from ${source}`);
      assert.equal(page.url, url);
    }
  });

  it("buildPages_EveryPage_CarriesTheFullNavAndStylesheet", async () => {
    // Arrange & Act
    const result = await buildPages();

    // Assert
    for (const page of result.pages) {
      assert.ok(
        page.html.includes('<link rel="stylesheet" href="/assets/css/style.css">'),
        `${page.output} is missing the stylesheet`,
      );
      for (const href of NAV_HREFS) {
        assert.ok(
          page.html.includes(`<a href="${href}">`),
          `${page.output} is missing the nav entry ${href}`,
        );
      }
    }
  });

  it("buildPages_HomePage_DoesNotDoubleTheSiteTitle", async () => {
    // Arrange
    const homeSource = "README.md";

    // Act
    const result = await buildPages();
    const home = result.pages.find((page) => page.source === homeSource);

    // Assert
    assert.ok(home !== undefined);
    assert.ok(home.html.includes("<title>Life Compass</title>"));
  });

  it("buildPages_SubPage_SuffixesTheSiteTitle", async () => {
    // Arrange
    const source = "days/day-1-excavation.md";

    // Act
    const result = await buildPages();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes("<title>Day 1 — Excavation · Life Compass</title>"));
  });

  it("buildPages_WorksheetBlanks_SurviveHtmlPassthrough", async () => {
    // Arrange
    const marker = /class="fill(?:-sm)?"/g;

    // Act
    const result = await buildPages();
    const total = result.pages
      .filter((page) => !page.source.startsWith("docs/"))
      .reduce((sum, page) => sum + (page.html.match(marker)?.length ?? 0), 0);

    // Assert
    assert.equal(total, EXPECTED_FILL_MARKERS);
  });

  it("buildPages_HtmlInsideCodeSpans_IsEscapedNotRendered", async () => {
    // Arrange — a decision record quotes the blank markup inside backticks. Passing
    // HTML through must not extend to code spans, or the record renders a live blank
    // in place of the example it is discussing.
    const source = "docs/decisions/0004-prose-in-markdown-questions-in-typescript.md";

    // Act
    const result = await buildPages();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes("<code>&lt;span class=&quot;fill&quot;&gt;"));
  });

  it("buildPages_AnchoredCrossPageLink_KeepsItsFragment", async () => {
    // Arrange — the em-dash-derived double hyphen is the fragile part.
    const source = "with-a-partner.md";
    const expectedHref = "/optional-add-ons.html#add-on-a--outside-input";

    // Act
    const result = await buildPages();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes(`href="${expectedHref}"`));
  });

  it("buildPages_BuildSources_AreNotShippedAsAssets", async () => {
    // Arrange — negative case: everything unrecognised is copied verbatim, so the
    // build's own TypeScript would otherwise be published alongside the site.
    // Act
    const result = await buildPages();

    // Assert
    assert.deepEqual(
      result.assets.filter((asset) => asset.endsWith(".ts")),
      [],
    );
  });
});
