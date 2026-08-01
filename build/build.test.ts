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
  "404.html",
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
  "docs/decisions/0011-question-identifiers-are-frozen-and-registered.html",
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
  "/one-page-anchor",
  "/days/day-1-excavation",
  "/rigorous/",
  "/with-a-partner",
  "/optional-add-ons",
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
    const expectedHref = "/optional-add-ons#add-on-a--outside-input";

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
    const result = await buildPages(root, undefined, []);

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
    const result = await buildPages(root, undefined, []);

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
    const result = await buildPages(root, undefined, []);

    // Assert
    assert.deepEqual(result.problems, []);
  });

  it("buildPages_SamePageAnchorToMissingHeading_IsReported", async () => {
    // Arrange — negative case: anchor-only links target the page they appear on.
    const root = await fixture({ "README.md": "# Home\n\n[up](#not-here)\n" });

    // Act
    const result = await buildPages(root, undefined, []);

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
    const result = await buildPages(root, undefined, []);

    // Assert
    assert.equal(result.problems[0]?.kind, "unrewritten-link");
  });

  it("buildPages_TwoSourcesClaimingOneOutput_Throws", async () => {
    // Arrange — negative case: README.md and index.md both want index.html.
    const root = await fixture({ "README.md": "# One\n", "index.md": "# Two\n" });

    // Act & Assert
    await assert.rejects(() => buildPages(root, undefined, []), /would both be written to/);
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
    await build(root, out, []);

    // Assert
    const written = await readdir(out, { recursive: true, withFileTypes: true });
    const files = written.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    // questions.json is emitted alongside the pages so the assistant contract and the
    // importer key off the same definitions the pages were rendered from (#15).
    assert.deepEqual(files, ["index.html", "one.html", "questions.json", "thing.txt"]);
    assert.equal(await readFile(path.join(out, "assets", "thing.txt"), "utf8"), "kept\n");
  });

  it("build_StaleOutput_IsClearedBeforeWriting", async () => {
    // Arrange
    const root = await fixture({ "README.md": "# Home\n" });
    const out = path.join(root, "__dist");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "leftover.html"), "old", "utf8");

    // Act
    await build(root, out, []);

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
    await assert.rejects(() => build(root, out, []), /refusing to build/);
    assert.equal(await readFile(path.join(out, "sentinel.html"), "utf8"), "untouched");
  });

  it("build_RelativeOutputPath_IsRefusedBeforeDeletingAnything", async () => {
    // Arrange — negative case: `out` is about to be removed recursively.
    const root = await fixture({ "README.md": "# Home\n" });

    // Act & Assert
    await assert.rejects(() => build(root, "dist", []), /expected an absolute, non-root path/);
  });
});

describe("task lists", () => {
  it("buildPages_CheckboxSyntax_RendersADisabledCheckboxLikeKramdown", async () => {
    // Arrange — markdown-it does not do this natively; without the rule these render
    // as the literal text "[ ] Values filled in" on eight items across two worksheets.
    const source = "days/day-5-synthesis.md";
    const expected =
      '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" ' +
      'disabled="disabled" />Values filled in</li>';

    // Act
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes('<ul class="task-list">'));
    assert.ok(page.html.includes(expected));
  });

  it("buildPages_OrdinaryBulletStartingWithABracket_IsNotTreatedAsATask", async () => {
    // Arrange — negative case: only `[ ]` and `[x]` are markers.
    const root = await fixture({ "README.md": "# Home\n\n- [a link](README.md) here\n" });

    // Act
    const result = await buildPages(root, undefined, []);

    // Assert
    assert.ok(!result.pages[0]?.html.includes("task-list"));
  });
});

describe("heading ids", () => {
  it("buildPages_HeadingContainingRawHtml_KeepsTheMarkupOutOfTheId", async () => {
    // Arrange — several worksheets have headings shaped `### Value 1 — <span ...>`.
    // Including the raw HTML produced id="value-1--span-classfill______span".
    const source = "days/day-2-values.md";

    // Act
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(!/id="[^"]*span-class/.test(page.html), "an id still contains tag text");
    assert.ok(page.html.includes('<h3 id="value-1--______">'));
  });
});

describe("question anchors", () => {
  it("buildPages_Day1_RendersItsQuestionsFromTheSchema", async () => {
    // Arrange — the pilot worksheet's blanks are now generated, not hand-written.
    const source = "days/day-1-excavation.md";

    // Act
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes('data-question="day1.chapters"'));
    assert.ok(page.html.includes('data-field="day1.chapters.defined_by"'));
    // Every blank on the page now carries a field identifier; none are anonymous.
    const blanks = page.html.match(/class="fill(?:-sm)?"/g)?.length ?? 0;
    const identified = page.html.match(/class="fill(?:-sm)?" data-field=/g)?.length ?? 0;
    assert.equal(identified, blanks);
  });

  it("buildPages_Day1_AnchorsEveryQuestionExactlyOnce", async () => {
    // Arrange & Act
    const result = await site();
    const page = result.pages.find((c) => c.source === "days/day-1-excavation.md");

    // Assert
    assert.ok(page !== undefined);
    assert.deepEqual([...page.anchors].sort(), [
      "day1.chapters",
      "day1.drainers",
      "day1.energizers",
      "day1.low_points",
      "day1.patterns",
      "day1.peaks",
      "day1.threads",
    ]);
  });

  it("buildPages_AnchorNamingNoQuestion_IsReported", async () => {
    // Arrange — negative case.
    const root = await fixture({ "README.md": "# Home\n\n<!-- questions: nope.here -->\n" });

    // Act
    const result = await buildPages(root, undefined, []);

    // Assert
    assert.ok(result.problems.some((p) => p.kind === "unresolved-question-anchor"));
  });

  it("buildPages_OrdinaryHtmlComment_IsLeftAlone", async () => {
    // Arrange — negative case: only the questions form is a directive.
    const root = await fixture({ "README.md": "# Home\n\n<!-- just a note -->\n" });

    // Act
    const result = await buildPages(root, undefined, []);

    // Assert
    assert.deepEqual(result.problems, []);
    assert.ok(result.pages[0]?.html.includes("<!-- just a note -->"));
  });
});

describe("canonical urls", () => {
  it("buildPages_EmittedLinks_CarryNoHtmlExtension", async () => {
    // Arrange — Pages 308s /page.html to /page, so emitting the extension puts a
    // redirect on every navigation and would have a service worker caching redirects
    // rather than pages (0005 · C6).
    const result = await site();

    // Act
    const withExtension = result.pages.flatMap((page) =>
      [...page.html.matchAll(/href="(\/[^"#]*)"/g)]
        .map((match) => match[1] ?? "")
        .filter((href) => href.endsWith(".html")),
    );

    // Assert
    assert.deepEqual(withExtension, []);
  });

  it("buildPages_FilesOnDisk_KeepTheirHtmlNames", async () => {
    // Arrange — the extension survives on disk so links written before this change
    // still resolve, via the very redirect the emitted URLs now avoid.
    const result = await site();

    // Act
    const page = result.pages.find((c) => c.source === "days/day-1-excavation.md");

    // Assert
    assert.equal(page?.output, "days/day-1-excavation.html");
    assert.equal(page?.url, "/days/day-1-excavation");
  });

  it("buildPages_DirectoryIndexes_StayDirectoryUrls", async () => {
    // Arrange & Act
    const result = await site();

    // Assert
    assert.equal(result.pages.find((c) => c.source === "rigorous/README.md")?.url, "/rigorous/");
    assert.equal(result.pages.find((c) => c.source === "README.md")?.url, "/");
  });
});
