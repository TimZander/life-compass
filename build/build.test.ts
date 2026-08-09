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
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { build, buildPages, ROOT, type BuildResult } from "./build.ts";
import { WORKSHEETS } from "../src/questions/index.ts";
import { renderQuestion, loadSchema } from "./questions.ts";
import { icons } from "./icons.ts";
import { renderManifest } from "./manifest.ts";
import { render } from "./markdown.ts";
import { checkSpecifiers } from "./client.ts";

/** Every page the site is expected to publish. */
const EXPECTED_PAGES: readonly string[] = [
  "404.html",
  "agent.html",
  "backup.html",
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
  "docs/decisions/0012-client-typescript-stripped-at-build-time.html",
  "docs/decisions/0013-instance-identity-for-rendered-slots.html",
  "docs/decisions/0014-a-dom-for-tests-only.html",
  "docs/decisions/0015-assistant-output-is-self-describing-blocks.html",
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
  "/backup",
  "/agent",
  "/docs/decisions/",
];

/**
 * Answer blanks across the worksheets. Asserted so that a rendering regression which
 * silently drops them fails here rather than on a printed worksheet — for the pages
 * still using raw `<span>` markup that means HTML passthrough, and for the migrated ones
 * it means the schema still produces what it produced.
 *
 * 447, up from 443, in two steps and for one reason both times. On days/day-3 themes 4
 * and 5 carried two example slots where the first three carried three; on rigorous/day-3
 * they carried one where the first three carried two. A repeat cannot say that about some
 * instances and not others, so all five get the same, which adds two blanks each time and
 * removes an inconsistency that read as arbitrary rather than deliberate.
 */
const EXPECTED_FILL_MARKERS = 447;

/** Built once and shared: rendering 29 pages per test is pure waste. */
let cached: Promise<BuildResult> | undefined;
function site(): Promise<BuildResult> {
  cached ??= buildPages({ checkHeaders: true, checkRegistry: true });
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

describe("the stylesheet and the markup agreeing", () => {
  it("styleSheet_TheLockedReplaceButton_IsKeyedOnTheAttributeTheClientActuallySets", async () => {
    // Arrange — the destructive button is held shut with `aria-disabled`, because
    // `disabled` makes an element unfocusable and would drop a keyboard reader to the body
    // mid-flow. The stylesheet styled `[disabled]`, which the markup never sets, so the
    // button looked armed from the moment the confirmation appeared and nothing showed that
    // ticking the acknowledgement was what released it.
    const css = await readFile(path.join(ROOT, "assets/css/style.css"), "utf8");
    const { pages } = await site();
    const backup = pages.find((page) => page.url === "/backup");
    assert.ok(backup !== undefined, "there is no backup page");

    // Act & Assert — the markup ships the attribute, and the stylesheet keys off the same
    // one. Either half alone leaves a destructive control with no visible locked state.
    assert.ok(
      /id="restore-go"[^>]*aria-disabled="true"/.test(backup.html),
      "the replace button does not ship locked",
    );
    assert.ok(
      css.includes('#restore-go[aria-disabled="true"]'),
      "the stylesheet does not style the locked replace button",
    );
    assert.ok(
      !css.includes("#restore-go[disabled]"),
      "the stylesheet still targets an attribute the markup never sets",
    );
  });

  it("styleSheet_TheManifestColours_AreTheColoursTheStylesheetPaints", async () => {
    // Arrange — the same two colours are declared in three places: the manifest (which the
    // OS paints an installed app's chrome and splash with), the layout's theme-color meta
    // tag, and the stylesheet's custom properties. The manifest and the layout are held
    // together by sharing a constant since #62; the stylesheet cannot import TypeScript, so
    // this is what holds the third copy. Drift shows as an installed app whose chrome does
    // not match the paper directly below it — obvious on a device, invisible in a diff.
    const css = await readFile(path.join(ROOT, "assets/css/style.css"), "utf8");
    const declared = JSON.parse(renderManifest());

    // Act — read the palette back out of the stylesheet.
    const accent = /--accent:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const paper = /--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];

    // Assert
    assert.equal(declared.theme_color, accent, "theme_color is not the stylesheet's --accent");
    assert.equal(declared.background_color, paper, "background_color is not the --bg painted");
  });
});

describe("the prose that introduces a question", () => {
  /** Render one page's worth of Markdown and read back what each anchor claimed. */
  function asksIn(markdown: string): Map<string, string> {
    const schema = loadSchema(WORKSHEETS);
    const rendered = render(markdown, "fixture.md", {
      questions: schema.byId,
      urls: new Map<string, string>(),
      assets: new Set<string>(),
    });
    return new Map(rendered.asks);
  }

  const ANCHOR_ONE = "<!-- questions: day1.chapters -->";
  const ANCHOR_TWO = "<!-- questions: day1.peaks -->";

  it("render_AProseParagraphAboveTheAnchor_IsTheAsk", () => {
    // Arrange — the ordinary shape, and the one that makes the feature work at all: the
    // definitions carry a label, docs/decisions/0004 keeps the question itself in Markdown.
    const ASK = "What did you love doing at ten that you no longer do?";

    // Act
    const asks = asksIn(`${ASK}\n\n${ANCHOR_ONE}\n`);

    // Assert
    assert.equal(asks.get("day1.chapters"), ASK);
  });

  it("render_AnAnchorNestedInAListItem_TakesTheItemAndNotTheListAboveIt", () => {
    // Arrange — Day 4 asks three questions as bullets with the anchor indented under each.
    const MINE = "**Who do you want to be useful to?** Be specific.";
    const markdown = `- Something else entirely.\n\n- ${MINE}\n\n  ${ANCHOR_ONE}\n`;

    // Act
    const asks = asksIn(markdown);

    // Assert
    assert.equal(asks.get("day1.chapters"), MINE);
  });

  it("render_AListAboveTheAnchor_IsNotCollected", () => {
    // Arrange — negative case, and a real failure this rule had. The rigorous Day 3 lists
    // History and Spending as bullets, then introduces the calendar in its own paragraph.
    // Walking back across the list collected the bullet about spending as though it
    // introduced the calendar — a plausible-looking ask that was simply the wrong question.
    const MINE = "**Calendar:**";
    const markdown = `- **Spending:** what do you spend on without resentment?\n\n${MINE}\n\n${ANCHOR_ONE}\n`;

    // Act
    const asks = asksIn(markdown);

    // Assert
    assert.equal(asks.get("day1.chapters"), MINE);
  });

  it("render_ConsecutiveAnchors_ShareTheLeadInAboveThem", () => {
    // Arrange — Day 4 puts one instruction above four sentence questions in a row. The
    // second has nothing between it and the first, and an empty ask would be worse than a
    // shared one.
    const LEAD = "Finish these sentences (multiple times if needed):";

    // Act
    const asks = asksIn(`${LEAD}\n\n${ANCHOR_ONE}\n\n${ANCHOR_TWO}\n`);

    // Assert
    assert.equal(asks.get("day1.chapters"), LEAD);
    assert.equal(asks.get("day1.peaks"), LEAD);
  });

  it("render_AnAnchorBelowAnother_SeesTheAnchorAndNotTheQuestionItBecame", () => {
    // Arrange — the subtlest failure this had. The render pass REPLACES an anchor's content
    // with the markup it generated, and the ask was being read in that same pass, so a
    // question could not recognise the anchor above it — already rewritten — and walked
    // straight through into the previous question's lead-in. It read as a plausible ask.
    const FIRST = "**History:** what do you return to?";
    const SECOND = "**Calendar:**";

    // Act
    const asks = asksIn(`${FIRST}\n\n${ANCHOR_ONE}\n\n${SECOND}\n\n${ANCHOR_TWO}\n`);

    // Assert
    assert.equal(asks.get("day1.peaks"), SECOND, "it reached past the anchor above it");
    assert.equal(asks.get("day1.chapters"), FIRST);
  });

  it("render_AHeadingBetweenTheProseAndTheAnchor_IsCarriedAsTheSubject", () => {
    // Arrange — Day 5 asks one question five times under `### Career`, `### Money` and so
    // on. Without the heading all five read identically; with only the heading none of them
    // says what to ask. Both halves are needed, which is why both are asserted.
    const LEAD = "For each dimension ask: is my setup aligned?";
    const markdown = `${LEAD}\n\n### Money\n\n${ANCHOR_ONE}\n`;

    // Act
    const ask = asksIn(markdown).get("day1.chapters") ?? "";

    // Assert
    assert.ok(ask.includes("Money"), "the heading naming the subject is missing");
    assert.ok(ask.includes(LEAD), "the prose that asks the question is missing");
  });

  it("render_AQuotedExampleBelowTheInstruction_IsKeptWithIt", () => {
    // Arrange — Day 1 puts the instruction in a paragraph and an example in a blockquote
    // beneath it, and Day 4 quotes a format with a bulleted example. A list inside a quote
    // is part of the example rather than a sibling of the question, and treating it as a
    // boundary left one question with no ask at all.
    const INSTRUCTION = "Divide your life into chapters.";
    const markdown = `${INSTRUCTION}\n\n> Example:\n>\n> - "The garage-band years"\n\n${ANCHOR_ONE}\n`;

    // Act
    const ask = asksIn(markdown).get("day1.chapters") ?? "";

    // Assert
    assert.ok(ask.includes(INSTRUCTION), "the instruction was dropped");
    assert.ok(ask.includes("garage-band"), "the quoted example was treated as a boundary");
  });

  it("render_TheNearestHeading_IsTheSubjectAndNotTheOneAboveIt", () => {
    // Arrange — the mutation that matters here, and the one the code comment beside it
    // describes: taking the furthest heading instead of the nearest makes all five of Day 5's
    // questions read identically, which is the defect the heading rule was added to fix. A
    // single-heading fixture cannot tell the two apart, so this one has both.
    const LEAD = "For each dimension ask: is my setup aligned?";
    const markdown = `## The five dimensions\n\n${LEAD}\n\n### Money\n\n${ANCHOR_ONE}\n`;

    // Act
    const ask = asksIn(markdown).get("day1.chapters") ?? "";

    // Assert
    assert.ok(ask.includes("Money"), "the nearest heading is missing");
    assert.ok(!ask.includes("The five dimensions"), "it reached past to the section heading");
    assert.ok(ask.includes(LEAD), "the prose that asks the question is missing");
  });

  it("render_TheHeading_ComesBeforeTheProseItIntroduces", () => {
    // Arrange — order is meaning here. "Money / For each dimension ask…" is a subject and its
    // question; reversed, it is a question with a stray word after it.
    const LEAD = "For each dimension ask: is my setup aligned?";

    // Act
    const ask = asksIn(`${LEAD}\n\n### Money\n\n${ANCHOR_ONE}\n`).get("day1.chapters") ?? "";

    // Assert
    assert.ok(ask.indexOf("Money") < ask.indexOf(LEAD), "the subject arrives after the question");
  });

  it("render_SeveralBlocks_KeepTheirOrderAndStaySeparate", () => {
    // Arrange — Day 1 puts the instruction first and an example beneath it. Reversed, the
    // example reads as the instruction; run together on one line, both read as neither.
    const FIRST = "Divide your life into chapters.";
    const SECOND = "Example: the garage-band years.";

    // Act
    const ask = asksIn(`${FIRST}\n\n${SECOND}\n\n${ANCHOR_ONE}\n`).get("day1.chapters") ?? "";

    // Assert
    assert.ok(ask.indexOf(FIRST) < ask.indexOf(SECOND), "the blocks came back reversed");
    assert.ok(ask.includes(`${FIRST}\n\n${SECOND}`), "the blocks were run together");
  });

  it("render_AnOrderedListAboveTheAnchor_IsABoundaryLikeABulletList", () => {
    // Arrange — bullet lists and list items were both pinned; ordered lists were not, and a
    // numbered list is how several worksheets lay out their steps.
    const MINE = "**Calendar:**";
    const markdown = `1. A numbered step that is not this question.\n\n${MINE}\n\n${ANCHOR_ONE}\n`;

    // Act
    const ask = asksIn(markdown).get("day1.chapters") ?? "";

    // Assert
    assert.equal(ask, MINE);
  });

  it("buildPages_RealContent_EveryQuestionHasAnAsk", async () => {
    // Arrange — the property that matters, over the whole workbook rather than one shape.
    // Seven questions came out empty on the first attempt and one on the second, each time
    // in a shape the rule had not met.
    const result = await site();

    // Act
    const missing = [...result.schema.byId.keys()].filter(
      (id) => (result.asks.get(id) ?? "").trim() === "",
    );

    // Assert
    assert.deepEqual(missing, []);
  });

  it("buildPages_AQuestionWithNoProseAnywhere_IsReported", async () => {
    // Arrange — negative case. The rule is structural, so a worksheet written in a shape it
    // has not seen can yield nothing, and nothing is the half that would otherwise be silent.
    // A bare anchor with no prose and no heading above it is that case: a heading alone would
    // supply an ask, which is the fallback working rather than the failure being tested.
    const root = await fixture({ "README.md": `${ANCHOR_ONE}\n` });

    // Act
    const result = await buildPages({ root, worksheets: WORKSHEETS });
    const reported = result.problems
      .filter((problem) => problem.kind === "questionless-ask")
      // Whole identifier, not a substring: `rday1.chapters` contains `day1.chapters`, and an
      // earlier version of this test passed on the wrong question because of it.
      .map((problem) => problem.detail.split(" ")[0]);

    // Assert
    assert.ok(reported.includes("day1.chapters"), "a question with no prose was not reported");
  });
});

describe("refusing a client graph the browser cannot load", () => {
  it("checkSpecifiers_AnImportNothingEmits_Throws", () => {
    // Arrange — the failure this exists for, and it shipped once. `buildClient` discovers
    // modules by reading a directory, so a GENERATED module that was never written is not an
    // error, it is simply absent from the list. Deleting src/client/schema.ts left the build
    // emitting prompt.js importing ./schema.js, shipping it, and leaving it out of the
    // precache — so cache.addAll succeeded and every gate passed on a dead client.
    const modules = [
      { output: "assets/js/app.js", code: 'import { x } from "./gone.js";\n' },
      { output: "assets/js/keys.js", code: "export const x = 1;\n" },
    ];

    // Act & Assert
    assert.throws(() => checkSpecifiers(modules), /imports \.\/gone\.js, which nothing emits/);
  });

  it("checkSpecifiers_EveryImportEmitted_DoesNotThrow", () => {
    // Arrange — the ordinary case, including a specifier that climbs a directory, so the
    // resolution is doing real path work rather than comparing strings.
    const modules = [
      { output: "assets/js/app.js", code: 'import { k } from "./keys.js";\n' },
      { output: "assets/js/keys.js", code: 'import { s } from "../js/schema.js";\n' },
      { output: "assets/js/schema.js", code: "export const s = 1;\n" },
    ];

    // Act & Assert
    assert.doesNotThrow(() => checkSpecifiers(modules));
  });

  it("checkSpecifiers_BareSpecifiers_AreLeftAlone", () => {
    // Arrange — negative case. Only relative specifiers name something this build emits; a
    // bare one would be a dependency, which this tier does not have and must not start
    // reporting as a missing file.
    const modules = [{ output: "assets/js/app.js", code: 'import { z } from "node:path";\n' }];

    // Act & Assert
    assert.doesNotThrow(() => checkSpecifiers(modules));
  });
});

describe("the decision records and their index", () => {
  /** Every record file, and the table rows in the index that name them. */
  async function records(): Promise<{
    files: string[];
    listed: Map<string, string>;
  }> {
    const dir = path.join(ROOT, "docs/decisions");
    const files = (await readdir(dir))
      .filter((name) => /^\d{4}-.*\.md$/.test(name))
      .sort();
    const index = await readFile(path.join(dir, "README.md"), "utf8");
    const listed = new Map<string, string>();
    for (const row of index.split("\n")) {
      // | [0009](0009-....md) | Title | Status |
      const found = /^\|\s*\[\d{4}\]\(([^)]+)\)\s*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(row);
      if (found?.[1] !== undefined && found[2] !== undefined) {
        listed.set(found[1], found[2]);
      }
    }
    return { files, listed };
  }

  it("decisionRecords_EveryFile_IsListedInTheIndex", async () => {
    // Arrange — the index table is how anyone finds a record; the nav points at the
    // directory, not at individual pages. A record nobody links is a record nobody reads,
    // and nothing until now would have noticed one shipping unlisted.
    const { files, listed } = await records();

    // Act
    const missing = files.filter((name) => !listed.has(name));

    // Assert
    assert.deepEqual(missing, [], "decision records exist that the index does not list");
  });

  it("decisionRecords_EveryIndexRow_NamesAFileThatExists", async () => {
    // Arrange — negative case, the other direction: a renamed or deleted record leaves a
    // row pointing at nothing, and the build only checks links inside published pages.
    const { files, listed } = await records();

    // Act
    const dangling = [...listed.keys()].filter((name) => !files.includes(name));

    // Assert
    assert.deepEqual(dangling, [], "the index lists records that do not exist");
  });

  it("decisionRecords_TheIndexStatus_MatchesTheRecordsOwn", async () => {
    // Arrange — two copies of one fact, which is the failure 0015 itself is about. Six of
    // the records are Proposed and the README's own clause governs when that changes, so a
    // record promoted to Accepted in its own file and left Proposed in the table is the
    // likely drift rather than an exotic one.
    const { files, listed } = await records();
    const disagreements: string[] = [];

    // Act
    for (const name of files) {
      const body = await readFile(path.join(ROOT, "docs/decisions", name), "utf8");
      const own = /^- \*\*Status:\*\*\s*(\S+)/m.exec(body)?.[1];
      const row = listed.get(name);
      if (own !== undefined && row !== undefined && own !== row) {
        disagreements.push(`${name}: file says ${own}, index says ${row}`);
      }
    }

    // Assert
    assert.deepEqual(disagreements, []);
  });
});

describe("which page carries which controls", () => {
  it("buildPages_RealContent_PutsTheAssistantOptInOnExactlyTheAssistantPage", async () => {
    // Arrange — the decision, which nothing asserted. layout.test.ts proves `layout()` emits
    // the section when told to; build.test.ts proved `agent.html` exists. Neither noticed that
    // the build could stop telling it: replacing the AGENT_SOURCE arm with `null` shipped the
    // page whose entire purpose is one switch, with no switch, past a green suite. This page
    // has already shipped switchless once for a different reason.
    const { pages } = await site();

    // Act
    const withOptIn = pages.filter((page) => page.html.includes('id="agent-on"'));

    // Assert
    assert.deepEqual(withOptIn.map((page) => page.url), ["/agent"]);
  });

  it("buildPages_RealContent_LeavesTheBackupControlsWhereTheyWere", async () => {
    // Arrange — the same decision for the other page, and a regression guard on the parameter
    // this branch changed from a boolean to a named union. A ternary that got either arm wrong
    // would move the controls silently.
    const { pages } = await site();

    // Act
    const withBackup = pages.filter((page) => page.html.includes('id="restore-file"'));

    // Assert
    assert.deepEqual(withBackup.map((page) => page.url), ["/backup"]);
  });
});

describe("the stylesheet and the assistant controls agreeing", () => {
  /**
   * Every `.agent-*` rule was independently deletable with the suite green — including whole
   * rules — because nothing in the project asserts on this stylesheet except the one backup
   * pair. Each declaration below carries a failure a reader would meet, which is the only
   * reason to pin a stylesheet at all.
   */
  const REQUIRED: readonly (readonly [selector: string, declaration: string, because: string])[] = [
    [".agent-open", "border:1px solid var(--accent)", "the button reverts to a browser default nobody could find on a device"],
    [".agent-open", "display:block", "the control runs into the question text beside it"],
    [".agent-open:focus-visible", "outline:2px solid var(--accent-dark)", "a keyboard reader cannot see where they are"],
    [".tools", "border-left:3px solid var(--accent)", "both tools sections merge into the prose around them"],
    [".agent-preview", "max-height:70vh", "the payload shrinks back to a fraction of itself, which is the defect this pair was written to fix"],
    [".agent-preview", "font-size:.92rem", "the text 0007 · 1 requires the reader to READ becomes too small to read"],
    [".agent-preview", "overflow:auto", "the payload cannot be scrolled to read the rest of it"],
    [".agent-preview", "white-space:pre-wrap", "the payload collapses into one unreadable line"],
    [".agent-preview", "overflow-wrap:anywhere", "the payload runs off the side of a phone"],
    [".agent-preview", "border:1px solid var(--accent)", "the box loses its only boundary — its background differs from the panel's by 1.10:1"],
    [".agent-preview:focus-visible", "outline:2px solid var(--accent-dark)", "the scrollable region gives no focus indication"],
    [".agent-note", "color:var(--ink)", "0007 · 3's one required sentence returns to 2.49:1 contrast"],
    [".agent-scroll", "color:var(--ink)", "the note saying the payload scrolls is the same 2.49:1 grey"],
  ];

  /**
   * The declarations inside one rule, by exact selector, each normalised to `property:value`.
   *
   * Whole declarations rather than a substring of one, which is what this checked before and
   * why it certified claims that were not true. `"border"` was satisfied by the neighbouring
   * `border-radius`, so deleting the actual border passed; `"outline"` by `outline-offset`;
   * and `"max-height"` matched `max-height:6em`, which is precisely the shrunken box the
   * commit above it claims to have fixed. `"white-space:pre-wrap"` also matched the invalid
   * `pre-wrap-x`, which browsers discard. Five of nine rows could not fail.
   */
  function declarationsFor(css: string, selector: string): readonly string[] {
    // Comments stripped first: this stylesheet carries a long one above most rules, and a
    // naive scan folds it into the selector it precedes.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    return [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((rule) => (rule[1] ?? "").trim() === selector)
      .flatMap((rule) => (rule[2] ?? "").split(";"))
      .map((declaration) => declaration.replace(/\s+/g, " ").trim())
      .filter((declaration) => declaration !== "");
  }

  it("styleSheet_TheAssistantControls_KeepTheDeclarationsAReaderDependsOn", async () => {
    // Arrange
    const css = await readFile(path.join(ROOT, "assets/css/style.css"), "utf8");

    // Act & Assert
    for (const [selector, declaration, because] of REQUIRED) {
      const body = declarationsFor(css, selector);
      assert.ok(body.length > 0, `${selector} has no rule at all: ${because}`);
      assert.ok(
        body.includes(declaration),
        `${selector} lost "${declaration}": ${because}\n  it now has: ${body.join("; ")}`,
      );
    }
  });

  it("styleSheet_ADeclarationWithTheRightPropertyButAWrongValue_IsNotAccepted", () => {
    // Arrange — negative case for the helper itself, which is the part that was broken. Each
    // of these is a real mutation that survived the previous version of the check.
    const CSS = ".agent-preview{max-height:6em;white-space:pre-wrap-x;border-radius:4px}";

    // Act
    const body = declarationsFor(CSS, ".agent-preview");

    // Assert
    assert.ok(!body.includes("max-height:70vh"), "a shrunken box passed as the full-height one");
    assert.ok(!body.includes("white-space:pre-wrap"), "an invalid value passed as the valid one");
    assert.ok(
      !body.includes("border:1px solid var(--accent)"),
      "border-radius passed as a border",
    );
  });

  it("styleSheet_TheControls_DoNotPrint", async () => {
    // Arrange — 0010 · C3 asks for the absence of form controls on paper, and this file's own
    // history is the argument: the backup print rule was keyed on a class the markup never
    // carried and was dead from #25 until this branch. A print rule that silently stops
    // matching is the failure 0010 predicts by name.
    const css = await readFile(path.join(ROOT, "assets/css/style.css"), "utf8");

    // Act
    const printed = /@media print\{([^}]*)\{display:none\}\}/g;
    const hidden = [...css.matchAll(printed)].flatMap((match) => (match[1] ?? "").split(","));

    // Assert — every selector named here must appear in the markup the build emits, which is
    // what the dead `.backup` rule did not.
    for (const selector of ["#backup", "#restore", "#agent", ".agent-open", ".agent-panel"]) {
      assert.ok(hidden.includes(selector), `${selector} is not hidden in print`);
    }
  });
});

describe("the backup page in a real build", () => {
  it("buildPages_RealContent_PutsTheToolsOnTheBackupPageAndNoOther", async () => {
    // Arrange — layout.test.ts proves the controls are emitted when asked for; nothing
    // proved the build ever asks, and passing `false` for every page left all 35 without
    // the one control 0008 · C3 calls mandatory, with every test green.
    const { pages } = await site();

    // Act
    const withTools = pages.filter((page) => page.html.includes('id="restore-file"'));

    // Assert
    assert.deepEqual(
      withTools.map((page) => page.url),
      ["/backup"],
      "the backup and restore controls are not on exactly the backup page",
    );
  });

  it("buildPages_RealContent_LinksToTheBackupPageFromEveryPage", async () => {
    // Arrange — the controls left the worksheets, so the footer link is now the only route
    // to them. On every page, including the ones with nothing to answer.
    const { pages } = await site();

    // Act
    const missing = pages.filter((page) => !page.html.includes('href="/backup"'));

    // Assert
    assert.deepEqual(missing.map((page) => page.url), [], "some pages cannot reach the backup");
  });
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
    const result = await buildPages({ root, worksheets: [] });

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
    const result = await buildPages({ root, worksheets: [] });

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
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.deepEqual(result.problems, []);
  });

  it("buildPages_SamePageAnchorToMissingHeading_IsReported", async () => {
    // Arrange — negative case: anchor-only links target the page they appear on.
    const root = await fixture({ "README.md": "# Home\n\n[up](#not-here)\n" });

    // Act
    const result = await buildPages({ root, worksheets: [] });

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
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.equal(result.problems[0]?.kind, "unrewritten-link");
  });

  it("buildPages_TwoSourcesClaimingOneOutput_Throws", async () => {
    // Arrange — negative case: README.md and index.md both want index.html.
    const root = await fixture({ "README.md": "# One\n", "index.md": "# Two\n" });

    // Act & Assert
    await assert.rejects(() => buildPages({ root, worksheets: [] }), /would both be written to/);
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
    await build({ root, out, worksheets: [] });

    // Assert
    const written = await readdir(out, { recursive: true, withFileTypes: true });
    // Icon filenames carry a digest of their own bytes (#62), so they are matched on
    // shape rather than named: writing the current digests here would make redrawing the
    // mark fail this test, which is the opposite of what the digest is for.
    const files = written
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.replace(/\.[0-9a-f]{8}\.png$/, ".<hash>.png"))
      .sort();
    // questions.json is emitted alongside the pages so the assistant contract and the
    // importer key off the same definitions the pages were rendered from (#15).
    // Icons, the manifest and the service worker are generated, not copied — see
    // build/icons.ts, build/manifest.ts and build/serviceworker.ts. They appear here
    // because they are genuinely written.
    assert.deepEqual(files, [
      "icon-192.<hash>.png",
      "icon-512.<hash>.png",
      "icon-maskable-512.<hash>.png",
      "index.html",
      "manifest.webmanifest",
      "one.html",
      "questions.json",
      "sw.js",
      "thing.txt",
    ]);
    assert.equal(await readFile(path.join(out, "assets", "thing.txt"), "utf8"), "kept\n");
  });

  it("build_StaleOutput_IsClearedBeforeWriting", async () => {
    // Arrange
    const root = await fixture({ "README.md": "# Home\n" });
    const out = path.join(root, "__dist");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "leftover.html"), "old", "utf8");

    // Act
    await build({ root, out, worksheets: [] });

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
    await assert.rejects(() => build({ root, out, worksheets: [] }), /refusing to build/);
    assert.equal(await readFile(path.join(out, "sentinel.html"), "utf8"), "untouched");
  });

  it("build_RelativeOutputPath_IsRefusedBeforeDeletingAnything", async () => {
    // Arrange — negative case: `out` is about to be removed recursively.
    const root = await fixture({ "README.md": "# Home\n" });

    // Act & Assert
    await assert.rejects(
      () => build({ root, out: "dist", worksheets: [] }),
      /expected an absolute, non-root path/,
    );
  });
});

describe("header contract", () => {
  // The wiring between `checkHeaders` and the build's problem list had no test: it was
  // gated on `root === ROOT`, so no fixture could turn it on, and the integration could
  // quietly detach while every other test stayed green (#37). A `_headers` the checker
  // accepts, weakened at exactly the directive the privacy claim rests on: `connect-src`
  // is 'self' rather than 'none', which is the one change that lets the app reach the
  // network. Everything else is intact, so the checker reports that and only that.
  const INTACT_HEADERS = [
    "/*",
    "  Content-Security-Policy: default-src 'self'; connect-src 'none'; form-action 'none'",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: microphone=()",
    "/manifest.webmanifest",
    "  Cache-Control: no-cache",
    "/sw.js",
    "  Cache-Control: no-cache",
    "  ! Content-Security-Policy",
    "  Content-Security-Policy: default-src 'self'; connect-src 'self'",
    "",
  ].join("\n");
  const WEAKENED_HEADERS = INTACT_HEADERS.replace("connect-src 'none'", "connect-src 'self'");

  it("buildPages_WeakenedHeadersWithCheckOn_ReportsAHeadersProblem", async () => {
    // Arrange — the fixture root is not ROOT, so this only reports if the check is gated
    // on the flag rather than on the path.
    const root = await fixture({ "README.md": "# Home\n", _headers: WEAKENED_HEADERS });

    // Act
    const result = await buildPages({ root, worksheets: [], checkHeaders: true });

    // Assert
    const headerProblems = result.problems.filter((problem) => problem.kind === "headers");
    assert.equal(headerProblems.length, 1);
    assert.match(headerProblems[0]?.detail ?? "", /connect-src/);
  });

  it("buildPages_WeakenedHeadersWithCheckOff_IsSilent", async () => {
    // Arrange — the same weakened file, but the flag defaults off. This is the guard the
    // old `root === ROOT` gate could not express: a fixture is safe without opting out,
    // and the flag — not the path — is what turns the check on.
    const root = await fixture({ "README.md": "# Home\n", _headers: WEAKENED_HEADERS });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.deepEqual(result.problems, []);
  });

  it("buildPages_IntactHeadersWithCheckOn_ReportsNoProblem", async () => {
    // Arrange — proves the check passes a contract it should accept, so the positive case
    // above is not a test that is simply always red.
    const root = await fixture({ "README.md": "# Home\n", _headers: INTACT_HEADERS });

    // Act
    const result = await buildPages({ root, worksheets: [], checkHeaders: true });

    // Assert
    assert.deepEqual(result.problems, []);
  });
});

describe("registry contract", () => {
  // The registry check was gated on `worksheets === WORKSHEETS` the same fragile way the
  // header check was gated on `root`, and it detaches just as silently: `checkRegistry`
  // compares the schema against the real registry, so on real content it reports nothing
  // whether or not it is wired in — site() cannot tell the two apart. An empty schema uses
  // none of the active registered ids, which is what gives the check something to report,
  // so a fixture can finally prove the wiring the way the header block does above (#37).
  it("buildPages_RegistryCheckOn_ReportsRegistryProblems", async () => {
    // Arrange — worksheets: [] means no question uses any registered id.
    const root = await fixture({ "README.md": "# Home\n" });

    // Act
    const result = await buildPages({ root, worksheets: [], checkRegistry: true });

    // Assert
    assert.ok(result.problems.some((problem) => problem.kind === "registry"));
  });

  it("buildPages_RegistryCheckOff_ReportsNoRegistryProblem", async () => {
    // Arrange — the same empty schema, flag defaulted off. This is the guard the fragile
    // `worksheets === WORKSHEETS` gate could not express, and it is what keeps every other
    // fixture test — all of which build with worksheets: [] — clean.
    const root = await fixture({ "README.md": "# Home\n" });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.ok(!result.problems.some((problem) => problem.kind === "registry"));
  });
});

describe("task lists", () => {
  it("buildPages_HandWrittenTaskMarker_IsReported", async () => {
    // Arrange — markdown-it does not do task lists and the rule that added them is gone,
    // so a hand-written one renders as the literal text "[ ] Values filled in". That is
    // what it did the day it was first noticed; now the build refuses instead.
    const root = await fixture({ "README.md": "# Home\n\n- [ ] Values filled in\n" });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.ok(result.problems.some((problem) => problem.kind === "task-list"));
    assert.ok(result.problems.some((problem) => problem.detail.includes("checklist question")));
  });

  it("buildPages_TaskSyntaxInsideAFence_IsNotReported", async () => {
    // Arrange — negative case, and the reason this is checked on the token stream rather
    // than the raw source: a fenced block showing the syntax did not mean it.
    const root = await fixture({ "README.md": "# Home\n\n```\n- [ ] not a real tick\n```\n" });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.deepEqual(result.problems, []);
  });

  it("buildPages_OrdinaryBulletStartingWithABracket_IsNotTreatedAsATask", async () => {
    // Arrange — negative case: only `[ ]` and `[x]` are markers, not any bracket.
    const root = await fixture({ "README.md": "# Home\n\n- [a link](README.md) here\n" });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.deepEqual(result.problems, []);
    assert.ok(!result.pages[0]?.html.includes("task-list"));
  });

  it("buildPages_ChecklistQuestion_StillRendersTheCheckboxMarkup", async () => {
    // Arrange — the capability did not leave with the rule: `checklist` emits it directly,
    // which is the whole reason the rule could go.
    const source = "days/day-5-synthesis.md";
    const expected =
      '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox"' +
      ' disabled="disabled" data-field="day5.ready.values" />Values filled in</li>';

    // Act
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes('<ul class="task-list q-checklist"'));
    assert.ok(page.html.includes(expected));
  });
});

describe("hand-written blanks", () => {
  it("buildPages_FillSpanWithSpacesAroundEquals_IsRefused", async () => {
    // Arrange — the spelling that slipped every canonical-regex check: a browser
    // resolves `class = "fill"` as class="fill", so a page once carried a blank with a
    // copied data-field — two blanks sharing one storage address — while the suite
    // stayed green and the build succeeded.
    const EXPECTED_PROBLEMS = 1;
    const root = await fixture({
      "README.md": '# Home\n\n<span class = "fill" data-field="day1.patterns">______</span>\n',
    });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    const reported = result.problems.filter((problem) => problem.kind === "hand-written-fill");
    assert.equal(reported.length, EXPECTED_PROBLEMS);
    assert.ok(
      reported[0]?.detail.includes('class = "fill"'),
      "the offending text is not in the report",
    );
  });

  it("buildPages_FillClassInEverySpellingABrowserAccepts_IsRefused", async () => {
    // Arrange — one fixture per spelling: attribute-name case, single quotes, no
    // quotes, the narrow variant, and fill as one class token among several. Each is
    // markup a browser resolves to a drawn blank, so each must refuse to build.
    const spellings = [
      'CLASS="fill"',
      "class='fill'",
      "class=fill",
      'class="fill-sm"',
      'class="fill extra"',
    ];

    for (const spelling of spellings) {
      const root = await fixture({ "README.md": `# Home\n\n<span ${spelling}>______</span>\n` });

      // Act
      const result = await buildPages({ root, worksheets: [] });

      // Assert
      assert.ok(
        result.problems.some((problem) => problem.kind === "hand-written-fill"),
        `${spelling} was not refused`,
      );
    }
  });

  it("buildPages_FillSpanInlineInProse_IsRefused", async () => {
    // Arrange — mid-sentence markup arrives as html_inline rather than html_block,
    // which is the shape every hand-written blank actually had. Both paths must report.
    const root = await fixture({
      "README.md": '# Home\n\nAnswer <span class="fill">______</span> here.\n',
    });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.ok(result.problems.some((problem) => problem.kind === "hand-written-fill"));
  });

  it("buildPages_FillMarkupInsideCodeSpansAndFences_IsNotRefused", async () => {
    // Arrange — negative case, and the reason the check reads the token stream rather
    // than the raw source: docs/decisions/0004 and 0013 discuss this markup inside
    // backticks and fences, where it is escaped text, not a blank.
    const root = await fixture({
      "README.md": [
        "# Home",
        "",
        'A record may quote `<span class="fill">______</span>` in prose,',
        "",
        "```html",
        '<span class = "fill" data-field="day1.patterns">______</span>',
        "```",
        "",
      ].join("\n"),
    });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.deepEqual(result.problems, []);
  });

  it("buildPages_ClassValueMerelyContainingTheWordFill_IsNotRefused", async () => {
    // Arrange — negative case: class matching is token-wise, the way a browser matches
    // selectors, so a class that merely starts with "fill" draws no blank.
    const root = await fixture({
      "README.md": '# Home\n\n<span class="filler">not a blank</span>\n',
    });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.deepEqual(result.problems, []);
  });
});

describe("heading ids", () => {
  it("buildPages_HeadingContainingRawHtml_KeepsTheMarkupOutOfTheId", async () => {
    // Arrange — a fixture for the same reason as the checkbox test above: this asserts how
    // the slugger treats raw HTML in a heading, and every real page that had one is being
    // migrated away by #22. Including the markup produced
    // id="value-1--span-classfill______span".
    const root = await fixture({
      "README.md": '# Home\n\n### Value 1 — <span class="fill">______</span>\n',
    });

    // Act
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.ok(result.pages[0]?.html.includes('<h3 id="value-1--______">'));
  });

  it("buildPages_EveryPage_HasNoTagTextInAnyId", async () => {
    // Arrange — the durable half, over real content: whatever a heading contains, no id
    // anywhere on the site may carry tag text. Unlike a named page this cannot go stale as
    // the remaining worksheets migrate.
    const result = await site();

    // Assert
    for (const page of result.pages) {
      assert.ok(!/id="[^"]*span-class/.test(page.html), `${page.output} has tag text in an id`);
      for (const id of page.headingIds) {
        assert.ok(!id.includes("<") && !id.includes(">"), `${page.output} id "${id}" has markup`);
      }
    }
  });

  it("buildPages_GeneratedHeading_CarriesAnIdLikeEveryOtherHeading", async () => {
    // Arrange — section repeats are injected after parsing, so the slugger never sees
    // them. Without an id of their own, Day 2's five values are the only headings on the
    // site that cannot be linked to and that the build's anchor check cannot see.
    const source = "days/day-2-values.md";

    // Act
    const result = await site();
    const page = result.pages.find((candidate) => candidate.source === source);

    // Assert
    assert.ok(page !== undefined);
    assert.ok(page.html.includes('<h3 id="day2-operationalised-1">'));
    assert.ok(page.headingIds.includes("day2-operationalised-5"));
  });
});

/**
 * A blank's storage address (docs/decisions/0013): its own data-field, and the
 * data-instance carried by the nearest enclosing marked element — undefined when no
 * marked element encloses the blank. `field` is undefined only for a blank carrying no
 * data-field at all; that is a defect for the caller to surface, not an address.
 */
type BlankAddress = {
  readonly field: string | undefined;
  readonly instance: string | undefined;
};

/**
 * Walk a page's tags in document order and resolve every blank to its address.
 *
 * A walk, not a regex over instance blocks, because the block shapes defeat patterns:
 * `data-instance` sits on `<li>` for row and line repeats and on a `<div>` for section
 * repeats, and a multi-field row nests plain `<li>` rows inside the marked one — so a
 * non-greedy match to the next closing tag ends an instance at its first nested row.
 * An earlier version of the slot test in this suite was exactly that regex, terminated
 * at `</div>`, and it passed while reading one instance per section repeat. Tracking
 * which elements are open is the only way "nearest enclosing" means what it says.
 *
 * This is not an HTML parser; it reads what this build emits — double-quoted
 * attributes — and no more. The emitted pages include tags that never close: `<meta>`
 * and `<link>` in every head, `<hr>` between worksheet sections, and the checklist
 * `<input>`s, which are written self-closing. All of them are pushed like any other
 * open tag, and the one rule that handles them is the pop: a close tag pops to its
 * matching open tag BY NAME, abandoning whatever sits unclosed above it. No emitted
 * void or self-closing element carries `data-instance`, so an abandoned frame is never
 * the one a lookup reads. Comments are cut before walking because ordinary HTML
 * comments pass through the renderer to the built page, and markup quoted inside one
 * must not be mistaken for structure. Both mechanisms are pinned by fixtures below.
 */
function blankAddresses(html: string): BlankAddress[] {
  const blanks: BlankAddress[] = [];
  // Open elements, innermost last. The tag name is kept to pop the matching frame;
  // the instance value is what "which marked element is currently open" reads from.
  const open: { readonly tag: string; readonly instance: string | undefined }[] = [];
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const token of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^">])*)>/g)) {
    const tag = (token[2] ?? "").toLowerCase();
    const attributes = token[3] ?? "";
    if (token[1] === "/") {
      // Pop to the matching open tag; anything left unclosed above it is abandoned
      // with it rather than allowed to hold the stack open forever.
      const depth = open.map((element) => element.tag).lastIndexOf(tag);
      if (depth !== -1) {
        open.length = depth;
      }
      continue;
    }
    const cls = /class="([^"]*)"/.exec(attributes)?.[1];
    if (cls === "fill" || cls === "fill-sm") {
      blanks.push({
        field: /data-field="([^"]*)"/.exec(attributes)?.[1],
        instance: open.findLast((element) => element.instance !== undefined)?.instance,
      });
    }
    open.push({ tag, instance: /data-instance="([^"]*)"/.exec(attributes)?.[1] });
  }
  return blanks;
}

describe("repeat instances", () => {
  it("renderQuestion_EveryRepeatInTheSchema_MarksEachSlotOnceFromZero", () => {
    // Arrange — before this, every slot of a group carried the same data-field, so 264 of
    // the site's blanks shared a key with another blank and would have overwritten each
    // other in storage. The pair (data-instance, data-field) is what makes them distinct.
    //
    // Asserted against the schema rather than by matching the rendered block. The first
    // version of this scraped the page with a non-greedy regex terminated by </div>,
    // which the new q-instance wrapper cut short: it inspected one instance of every
    // section repeat and passed while all five claimed slot zero.
    // Act & Assert
    for (const worksheet of WORKSHEETS) {
      for (const question of worksheet.questions) {
        if (question.kind !== "repeat") {
          continue;
        }
        const rendered = renderQuestion(question);
        // Split on the marker itself, so the shape of the element carrying it does not
        // matter — a <li> and a wrapping <div> are read the same way.
        const [preamble, ...slots] = rendered.split('data-instance="');
        // Only the text before the FIRST marker is checked here — a blank between or
        // after instances lands inside some slot's split segment and is caught by the
        // per-slot field count below, not by this assertion. `split` always returns at
        // least one element, so the fallback is for the type checker, not for a case
        // that can happen.
        assert.equal(
          (preamble ?? "").includes("data-field"),
          false,
          `${question.id}: a blank sits before the first instance marker`,
        );
        assert.deepEqual(
          slots.map((slot) => Number(slot.slice(0, slot.indexOf('"')))),
          Array.from({ length: question.min }, (_, index) => index),
          `${question.id}: slots are not one marker each, numbered 0 upward`,
        );
        for (const [index, slot] of slots.entries()) {
          assert.equal(
            slot.match(/data-field=/g)?.length ?? 0,
            question.fields.length,
            `${question.id} slot ${index}: wrong number of blanks`,
          );
        }
      }
    }
  });

  it("buildPages_SiteWide_MarksAsManySlotsAsTheSchemaDeclares", async () => {
    // Arrange — the per-question check above runs the renderer directly, so this is what
    // proves the same NUMBER of markers actually reached the pages. Only the number:
    // what the markers say once there is the address test below.
    const expected = WORKSHEETS.flatMap((worksheet) => worksheet.questions)
      .filter((question) => question.kind === "repeat")
      .reduce((total, question) => total + question.min, 0);

    // Act
    const result = await site();
    const marked = result.pages.reduce(
      (total, page) => total + (page.html.match(/data-instance="/g)?.length ?? 0),
      0,
    );

    // Assert
    assert.equal(
      marked,
      expected,
      "slot markers on the built pages do not match the schema's total",
    );
  });

  it("buildPages_SiteWide_GivesEveryBlankADistinctInstanceFieldAddress", async () => {
    // Arrange — the count above cannot tell 163 distinct markers from 163 copies of
    // `data-instance="0"`, and the latter restores every collision this migration
    // removed: inside a repeat, data-field alone is shared by design (0011 freezes it),
    // so the pair (nearest enclosing data-instance, own data-field) is the whole of a
    // blank's identity in storage (0013). That pair being distinct site-wide is the
    // property asserted here, over the built pages rather than the renderer.
    //
    // The counts pin the split so the walker cannot pass by not seeing blanks: 334
    // blanks sit inside repeat instances, and 113 sit outside every marker — those
    // belong to single-valued questions, whose data-field is unique by itself, so "no
    // enclosing marker" is a valid address component there rather than a defect.
    const EXPECTED_INSIDE_INSTANCES = 334;
    const EXPECTED_OUTSIDE_INSTANCES = 113;

    // Act
    const result = await site();
    const blanks = result.pages.flatMap((page) =>
      blankAddresses(page.html).map((blank) => ({ page: page.output, ...blank })),
    );

    // Assert
    assert.equal(
      blanks.length,
      EXPECTED_FILL_MARKERS,
      "the walker did not resolve every blank the marker count sees",
    );
    assert.deepEqual(
      blanks.filter((blank) => blank.field === undefined).map((blank) => blank.page),
      [],
      "a blank with no data-field has no address at all",
    );
    assert.equal(
      blanks.filter((blank) => blank.instance !== undefined).length,
      EXPECTED_INSIDE_INSTANCES,
      "wrong number of blanks inside repeat instances",
    );
    assert.equal(
      blanks.filter((blank) => blank.instance === undefined).length,
      EXPECTED_OUTSIDE_INSTANCES,
      "wrong number of blanks outside every instance",
    );
    const byAddress = new Map<string, string[]>();
    for (const blank of blanks) {
      const address = JSON.stringify([blank.instance ?? null, blank.field]);
      const occurrences = byAddress.get(address) ?? [];
      occurrences.push(blank.page);
      byAddress.set(address, occurrences);
    }
    const collisions = [...byAddress]
      .filter(([, pages]) => pages.length > 1)
      .map(([address, pages]) => `${address} on ${pages.join(", ")}`);
    assert.deepEqual(collisions, [], "blanks sharing one (instance, field) address");
  });

  it("blankAddresses_MarkedRowsNestingUnmarkedRows_KeepEachBlankInItsOwnInstance", () => {
    // Arrange — the shape that defeats pattern matching: a multi-field row is a marked
    // <li> holding a nested <ul> of plain <li>, so ending an instance at the next
    // closing tag hands the nested blanks to the wrong slot. This pins the walker
    // against the exact mistake a previous regex version of the slot test made.
    const html = [
      '<ol data-question="q">',
      '<li data-instance="0">a<ul><li><span class="fill" data-field="q.f">______</span></li></ul></li>',
      '<li data-instance="1">b<ul><li><span class="fill" data-field="q.f">______</span></li></ul></li>',
      "</ol>",
    ].join("\n");

    // Act
    const addresses = blankAddresses(html);

    // Assert
    assert.deepEqual(addresses, [
      { field: "q.f", instance: "0" },
      { field: "q.f", instance: "1" },
    ]);
  });

  it("blankAddresses_BlankAfterItsMarkerHasClosed_IsNotClaimedByThatMarker", () => {
    // Arrange — negative case: an empty marked <li> followed by an unmarked <li>
    // holding the blank satisfies every marker count, and only document order shows
    // the truth — the marked element closed before the blank opened, so the blank has
    // no enclosing instance.
    const html =
      '<ol><li data-instance="0"></li>' +
      '<li><span class="fill" data-field="q.f">______</span></li></ol>';

    // Act
    const addresses = blankAddresses(html);

    // Assert
    assert.deepEqual(addresses, [{ field: "q.f", instance: undefined }]);
  });

  it("blankAddresses_MarkerNestedInsideAnotherMarker_ResolvesTheNearestOne", () => {
    // Arrange — 0013 says a blank's address pairs its data-field with the NEAREST
    // enclosing marker. No shape the build emits today nests one marker inside another,
    // so without this fixture "nearest" is a claim nothing constrains: reading the
    // OUTERMOST marker instead resolves every current page identically. The inner
    // blank is the discriminating one; the outer blank pins that leaving the inner
    // marker restores the outer one rather than losing both.
    const html =
      '<div data-instance="0"><ul><li data-instance="1">' +
      '<span class="fill" data-field="q.inner">______</span></li></ul>' +
      '<span class="fill" data-field="q.outer">______</span></div>';

    // Act
    const addresses = blankAddresses(html);

    // Assert
    assert.deepEqual(addresses, [
      { field: "q.inner", instance: "1" },
      { field: "q.outer", instance: "0" },
    ]);
  });

  it("blankAddresses_UnclosedVoidInsideAMarker_DoesNotHoldTheMarkerOpen", () => {
    // Arrange — the built pages carry tags that never close: <hr> between sections,
    // <meta> and <link> in every head. The walker pushes them like any other tag, so
    // only popping BY NAME keeps </li> closing the marked <li> rather than the
    // abandoned <hr>; a blind pop of the top frame leaves the marker open, and the
    // next blank inherits an instance it does not sit inside.
    const html =
      '<li data-instance="0"><hr><span class="fill" data-field="q.f">______</span></li>' +
      '<li><span class="fill" data-field="q.g">______</span></li>';

    // Act
    const addresses = blankAddresses(html);

    // Assert
    assert.deepEqual(addresses, [
      { field: "q.f", instance: "0" },
      { field: "q.g", instance: undefined },
    ]);
  });

  it("blankAddresses_MarkupQuotedInsideAComment_IsNotReadAsStructure", () => {
    // Arrange — negative case: ordinary HTML comments pass through the renderer to the
    // built page (pinned under "question anchors"), so a comment quoting instance
    // markup can genuinely reach the walker. Without comment stripping the quoted tag
    // is pushed, nothing inside the comment ever closes it, and every later blank on
    // the page resolves to an instance that exists only as quoted text.
    const html =
      '<!-- an example: <li data-instance="9"> -->' +
      '<li><span class="fill" data-field="q.f">______</span></li>';

    // Act
    const addresses = blankAddresses(html);

    // Assert
    assert.deepEqual(addresses, [{ field: "q.f", instance: undefined }]);
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

  it("buildPages_EveryMigratedWorksheet_RendersItsQuestionsAndNoAnonymousBlanks", async () => {
    // Arrange — the Day 1 assertions above are what prove a migration landed, so they
    // run for every worksheet rather than only the pilot. Day 1's copy stays because it
    // names the specific identifiers; this one comes from the schema, so #22's remaining
    // slices are covered the moment they are declared.
    const result = await site();

    // Act & Assert
    for (const worksheet of WORKSHEETS) {
      const page = result.pages.find((candidate) => candidate.source === worksheet.source);
      assert.ok(page !== undefined, `${worksheet.source} was not built`);
      const blanks = page.html.match(/class="fill(?:-sm)?"/g)?.length ?? 0;
      const identified = page.html.match(/class="fill(?:-sm)?" data-field=/g)?.length ?? 0;
      assert.equal(identified, blanks, `${worksheet.source} has anonymous blanks`);
      assert.ok(blanks > 0, `${worksheet.source} rendered no blanks at all`);
      for (const question of worksheet.questions) {
        assert.ok(
          page.html.includes(`data-question="${question.id}"`),
          `${worksheet.source} never rendered ${question.id}`,
        );
      }
    }
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
    const result = await buildPages({ root, worksheets: [] });

    // Assert
    assert.ok(result.problems.some((p) => p.kind === "unresolved-question-anchor"));
  });

  it("buildPages_OrdinaryHtmlComment_IsLeftAlone", async () => {
    // Arrange — negative case: only the questions form is a directive.
    const root = await fixture({ "README.md": "# Home\n\n<!-- just a note -->\n" });

    // Act
    const result = await buildPages({ root, worksheets: [] });

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
    // The fragment is stripped rather than excluded from the pattern: a character class
    // that stops at "#" never matches an anchored link at all, so `/page.html#frag`
    // was invisible to this assertion while it appeared to cover every emitted link.
    const withExtension = result.pages.flatMap((page) =>
      [...page.html.matchAll(/href="(\/[^"]*)"/g)]
        .map((match) => (match[1] ?? "").split("#")[0] ?? "")
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

describe("service worker precache", () => {
  it("build_RealSite_PrecachesEveryPublishedPage", async () => {
    // Arrange — a page missing from the precache list still builds, still deploys, and
    // quietly stops working offline. Nothing else notices, so this is the only guard.
    const out = await mkdtemp(path.join(tmpdir(), "life-compass-sw-"));
    temporary.push(out);

    // Act
    const result = await build({ root: ROOT, out });
    const worker = await readFile(path.join(out, "sw.js"), "utf8");
    const match = /const PRECACHE = (\[[\s\S]*?\]);/.exec(worker);
    assert.ok(match?.[1] !== undefined, "PRECACHE not found in the generated worker");
    const precached = new Set(JSON.parse(match[1]) as string[]);

    // Assert
    const missing = result.pages.map((page) => page.url).filter((url) => !precached.has(url));
    assert.deepEqual(missing, []);
  });

  it("build_RealSite_PrecachesTheShellAndTheSchema", async () => {
    // Arrange — the manifest, the icons, the registration script and questions.json are
    // all served, so all of them belong in the cache. questions.json was the one that
    // was not, which would have surfaced at #15 as "the agent bridge fails offline".
    const out = await mkdtemp(path.join(tmpdir(), "life-compass-sw-"));
    temporary.push(out);

    // Act
    await build({ root: ROOT, out });
    const worker = await readFile(path.join(out, "sw.js"), "utf8");
    const match = /const PRECACHE = (\[[\s\S]*?\]);/.exec(worker);
    assert.ok(match?.[1] !== undefined);
    const precached = new Set(JSON.parse(match[1]) as string[]);

    // Assert
    for (const url of [
      "/manifest.webmanifest",
      "/assets/css/style.css",
      "/assets/js/app.js",
      "/assets/js/banner.js",
      "/assets/js/sw-update.js",
      "/questions.json",
      "/404",
    ]) {
      assert.ok(precached.has(url), `${url} is served but not precached`);
    }

    // The icons are asked for by the names they were actually given, since #62 made those
    // names carry a digest of the drawing. Naming them literally here would have to be
    // rewritten every time the mark changes — and would then be asserting the digest
    // rather than the property, which is that every icon written is an icon cached.
    for (const icon of icons()) {
      assert.ok(precached.has(`/${icon.output}`), `${icon.output} is served but not precached`);
    }
  });

  it("build_RealSite_ManifestNamesIconsThatWereActuallyWritten", async () => {
    // Arrange — the agreement, not either side of it. #57 shipped with two counts of one
    // store that disagreed, and this is the same shape: the manifest declares icon URLs,
    // the build writes icon files, and nothing until now made the two answer together. A
    // manifest naming a path that 404s is an app that cannot be installed, and
    // installation is what makes storage durable (docs/decisions/0008).
    const DIGEST_LENGTH = 8;
    const out = await mkdtemp(path.join(tmpdir(), "life-compass-manifest-"));
    temporary.push(out);

    // Act
    await build({ root: ROOT, out });
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.webmanifest"), "utf8"));

    // Assert
    assert.ok(manifest.icons.length > 0, "the manifest declares no icons at all");
    for (const declared of manifest.icons) {
      const written = await readFile(path.join(out, declared.src));
      const digest = createHash("sha256").update(written).digest("hex").slice(0, DIGEST_LENGTH);
      // Not merely that the file exists: that the name it was given describes the bytes
      // sitting at it. A stale name that happened to still resolve is exactly #62.
      assert.ok(declared.src.includes(digest), `${declared.src} does not match its own bytes`);
    }
  });

  it("build_RealSite_FaviconLinkNamesAWrittenIcon", async () => {
    // Arrange — a tab's favicon is cached separately from an installed app's icon and goes
    // stale on its own schedule, so it wants the same digest. It is also the one icon URL
    // that lives in the layout rather than the manifest, which is how it would be missed.
    const out = await mkdtemp(path.join(tmpdir(), "life-compass-favicon-"));
    temporary.push(out);

    // Act
    await build({ root: ROOT, out });
    const home = await readFile(path.join(out, "index.html"), "utf8");
    const href = /<link rel="icon" href="([^"]+)"/.exec(home)?.[1];

    // Assert
    assert.ok(href !== undefined, "no favicon link in the rendered page");
    await assert.doesNotReject(
      () => readFile(path.join(out, href)),
      `the favicon link names ${href}, which was never written`,
    );
  });

  it("build_RealSite_NeverPrecachesAFileCloudflareConsumes", async () => {
    // Arrange — negative case. addAll is atomic, so one such entry 404s, the install
    // rejects, and the site ends up with no service worker at all.
    const out = await mkdtemp(path.join(tmpdir(), "life-compass-sw-"));
    temporary.push(out);

    // Act
    await build({ root: ROOT, out });
    const worker = await readFile(path.join(out, "sw.js"), "utf8");
    const match = /const PRECACHE = (\[[\s\S]*?\]);/.exec(worker);
    assert.ok(match?.[1] !== undefined);
    const precached = JSON.parse(match[1]) as string[];

    // Assert
    assert.deepEqual(precached.filter((url) => /(^|\/)_/.test(url)), []);
  });
});

describe("what ships", () => {
  it("buildPages_Assets_AreExactlyTheFilesMeantToBePublished", async () => {
    // Arrange — discovery treats anything that is not Markdown as an asset, which is
    // permissive by default. tsconfig.client.json reached the live site and every
    // visitor's precache that way, because SKIP_FILES matched exact names and the new
    // file was a variant of a listed one.
    //
    // This list is the safety net: a new root-level file fails here until someone
    // decides, deliberately, whether it belongs on a public site.
    // Client modules are no longer here: they are emitted from src/client rather than
    // copied, so they are not discovered assets. dist/assets/js is asserted separately.
    // Nor is the manifest, since #62: it is generated from icons() so that it names the
    // drawing that actually shipped, which a committed file cannot do.
    const expected = ["LICENSE", "_headers", "assets/css/style.css"];

    // Act
    const result = await site();

    // Assert
    assert.deepEqual([...result.assets].sort(), expected);
  });
});
