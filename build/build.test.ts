/**
 * Whole-build checks against the real content, plus fixture-driven checks of the
 * failure paths.
 *
 * The structural expectations below are deliberately a list of page paths rather than
 * a byte-level snapshot of the rendered HTML. A byte snapshot would fail on every
 * prose edit — training whoever hits it to regenerate without reading — while catching
 * nothing a human would not have noticed anyway. Page-set and title changes are the
 * failures actually worth interrupting for.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { build, buildPages, type BuildResult } from "./build.ts";

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

/** Built once and shared: rendering 29 pages per test is pure waste. */
let cached: Promise<BuildResult> | undefined;
function site(): Promise<BuildResult> {
  cached ??= buildPages();
  return cached;
}

/** Temp roots created by the fixture tests, removed together at the end. */
const temporary: string[] = [];
async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "life-compass-"));
  temporary.push(root);
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  return root;
}

after(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildPages", () => {
  it("buildPages_RealContent_ReportsNoProblems", async () => {
    // Arrange & Act
    const result = await site();

    // Assert
    assert.deepEqual(
      result.problems.map((problem) => `[${problem.kind}] ${problem.source}: ${problem.detail}`),
      [],
    );
  });

  it("buildPages_RealContent_PublishesExactlyTheExpectedPages", async () => {
    // Arrange & Act
    const result = await site();

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
    const result = await site();

    // Assert
    for (const [source, url] of expected) {
      const page = result.pages.find((candidate) => candidate.source === source);
      assert.ok(page !== undefined, `expected a page built from ${source}`);
      assert.equal(page.url, url);
    }
  });

  it("buildPages_EveryPage_CarriesTheFullNavAndStylesheet", async () => {
    // Arrange & Act
    const result = await site();

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
    const result = await site();
    const home = result.pages.find((page) => page.source === homeSource);

    // Assert
    assert.ok(home !== undefined);
    assert.ok(home.html.includes("<title>Life Compass</title>"));
  });

  it("buildPages_SubPage_SuffixesTheSiteTitle", async () => {
    // Arrange
    const source = "days/day-1-excavation.md";

    // Act
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes("<title>Day 1 — Excavation · Life Compass</title>"));
  });

  it("buildPages_WorksheetBlanks_SurviveHtmlPassthrough", async () => {
    // Arrange
    const marker = /class="fill(?:-sm)?"/g;

    // Act
    const result = await site();
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
    const result = await site();
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
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes(`href="${expectedHref}"`));
  });

  it("buildPages_BuildSources_AreNotShippedAsAssets", async () => {
    // Arrange — negative case: everything unrecognised is copied verbatim, so the
    // build's own TypeScript would otherwise be published alongside the site.
    // Act
    const result = await site();

    // Assert
    assert.deepEqual(
      result.assets.filter((asset) => asset.endsWith(".ts")),
      [],
    );
  });

  it("buildPages_LinkToMissingPage_IsReportedAsBroken", async () => {
    // Arrange — negative case.
    const root = await fixture({ "README.md": "# Home\n\n[gone](nowhere.md)\n" });

    // Act
    const result = await buildPages(root);

    // Assert
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0]?.kind, "broken-link");
  });

  it("buildPages_AnchorNamingAMissingHeading_IsReportedAsMissingAnchor", async () => {
    // Arrange — negative case. The path resolves, so only fragment checking catches it.
    const root = await fixture({
      "README.md": "# Home\n\n[jump](other.md#no-such-heading)\n",
      "other.md": "# Other\n\n## Real heading\n",
    });

    // Act
    const result = await buildPages(root);

    // Assert
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0]?.kind, "missing-anchor");
  });

  it("buildPages_AnchorNamingAnExistingHeading_IsAccepted", async () => {
    // Arrange
    const root = await fixture({
      "README.md": "# Home\n\n[jump](other.md#real-heading)\n",
      "other.md": "# Other\n\n## Real heading\n",
    });

    // Act
    const result = await buildPages(root);

    // Assert
    assert.deepEqual(result.problems, []);
  });

  it("buildPages_SamePageAnchorToMissingHeading_IsReported", async () => {
    // Arrange — negative case: anchor-only links target the page they appear on.
    const root = await fixture({ "README.md": "# Home\n\n[up](#not-here)\n" });

    // Act
    const result = await buildPages(root);

    // Assert
    assert.equal(result.problems[0]?.kind, "missing-anchor");
  });

  it("buildPages_MarkdownLinkInRawHtml_IsReportedAsUnrewritten", async () => {
    // Arrange — negative case: raw HTML is not tokenised, so the anchor bypasses
    // rewriting entirely and would ship a dead `.md` target.
    const root = await fixture({
      "README.md": '# Home\n\n<a href="other.md">raw</a>\n',
      "other.md": "# Other\n",
    });

    // Act
    const result = await buildPages(root);

    // Assert
    assert.equal(result.problems[0]?.kind, "unrewritten-link");
  });

  it("buildPages_TwoSourcesClaimingOneOutput_Throws", async () => {
    // Arrange — negative case: README.md and index.md both want index.html.
    const root = await fixture({ "README.md": "# One\n", "index.md": "# Two\n" });

    // Act & Assert
    await assert.rejects(() => buildPages(root), /would both be written to/);
  });
});

describe("build", () => {
  it("build_ValidContent_WritesPagesAndAssetsToTheOutputDirectory", async () => {
    // Arrange
    const root = await fixture({
      "README.md": "# Home\n\n[day](days/one.md)\n",
      "days/one.md": "# Day\n",
      "assets/thing.txt": "kept\n",
    });
    const out = path.join(root, "__dist");

    // Act
    await build(root, out);

    // Assert
    const written = await readdir(out, { recursive: true, withFileTypes: true });
    const files = written.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    assert.deepEqual(files, ["index.html", "one.html", "thing.txt"]);
    assert.equal(await readFile(path.join(out, "assets", "thing.txt"), "utf8"), "kept\n");
  });

  it("build_StaleOutput_IsClearedBeforeWriting", async () => {
    // Arrange
    const root = await fixture({ "README.md": "# Home\n" });
    const out = path.join(root, "__dist");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "leftover.html"), "old", "utf8");

    // Act
    await build(root, out);

    // Assert
    const written = await readdir(out);
    assert.ok(!written.includes("leftover.html"));
  });

  it("build_ProblemsPresent_ThrowsAndWritesNothing", async () => {
    // Arrange — negative case: the refusal must happen before the output is touched.
    const root = await fixture({ "README.md": "# Home\n\n[gone](nowhere.md)\n" });
    const out = path.join(root, "__dist");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "sentinel.html"), "untouched", "utf8");

    // Act & Assert
    await assert.rejects(() => build(root, out), /refusing to build/);
    assert.equal(await readFile(path.join(out, "sentinel.html"), "utf8"), "untouched");
  });

  it("build_RelativeOutputPath_IsRefusedBeforeDeletingAnything", async () => {
    // Arrange — negative case: `out` is about to be removed recursively.
    const root = await fixture({ "README.md": "# Home\n" });

    // Act & Assert
    await assert.rejects(() => build(root, "dist"), /expected an absolute, non-root path/);
  });
});
