/**
 * The generator that puts the question definitions where the client can read them.
 *
 * This file had no tests at all, which a mutation sweep found the hard way: removing the
 * schema validation, removing the guard on where it writes, and reporting drift while exiting
 * zero all passed a green suite. It is a build step that WRITES INTO THE SOURCE TREE, at a
 * git-ignored path where a destroyed file is not recoverable, so the guards are the part worth
 * pinning rather than the happy path.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  collectAsks,
  collectMaterial,
  materialIn,
  schemaSource,
  writeSchemaModule,
  SCHEMA_MODULE,
} from "./schema.ts";
import { CLIENT_DIR } from "./client.ts";
import { WORKSHEETS } from "../src/questions/index.ts";
import { ROOT } from "./build.ts";

const temporary: string[] = [];
after(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A tree the generator will agree to write into. */
async function writableRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "life-compass-schema-"));
  temporary.push(root);
  await mkdir(path.join(root, CLIENT_DIR), { recursive: true });
  return root;
}

/** Read WORKSHEETS back out of generated source, the way an importer would. */
function worksheetsIn(code: string): unknown {
  const found = /^export const WORKSHEETS[^=]*= ([\s\S]*?);\n\n/m.exec(code);
  assert.ok(found?.[1] !== undefined, "the module does not export WORKSHEETS");
  return JSON.parse(found[1]);
}

/**
 * Read a generated map back out, the way an importer would.
 *
 * Non-greedy and bounded by the blank line between exports, like `worksheetsIn`. `ASKS` had its
 * own pattern running to the end of the file, which was true only while it was the last export
 * — adding `MATERIAL` after it made the helper swallow both and fail on the JSON rather than on
 * anything the test was about.
 */
function mapIn(code: string, name: string): Record<string, string> {
  const found = new RegExp(`^export const ${name}[^=]*= ([\\s\\S]*?);\\n(?:\\n|$)`, "m").exec(code);
  assert.ok(found?.[1] !== undefined, `the module does not export ${name}`);
  return JSON.parse(found[1]) as Record<string, string>;
}

function asksIn(code: string): Record<string, string> {
  return mapIn(code, "ASKS");
}

describe("schemaSource", () => {
  it("schemaSource_Always_ExportsBothBindingsTheClientImports", () => {
    // Arrange — `export` specifically. A loosened check once accepted a module-local binding,
    // and a module that exports nothing is one the browser cannot import at all.
    // Act
    const code = schemaSource(WORKSHEETS, new Map([["day1.chapters", "Divide your life"]]));

    // Assert
    assert.match(code, /^export const WORKSHEETS/m);
    assert.match(code, /^export const ASKS/m);
  });

  it("schemaSource_Always_ImportsItsTypeAsATypeOnly", () => {
    // Arrange — `build/client.ts` rewrites relative specifiers to `.js`, and
    // `../questions/index.js` is not a file the browser is ever served. A value import would
    // 404 the whole module; `import type` is erased before it ships.
    // Act
    const code = schemaSource(WORKSHEETS, new Map());

    // Assert
    assert.match(code, /^import type \{ Worksheet \}/m);
  });

  it("schemaSource_TheWorksheetsGiven_AreTheWorksheetsCarried", () => {
    // Arrange — a module that parsed but carried half the workbook would satisfy a
    // "does it export something" check.
    // Act
    const carried = worksheetsIn(schemaSource(WORKSHEETS, new Map())) as { source: string }[];

    // Assert
    assert.deepEqual(
      carried.map((worksheet) => worksheet.source).sort(),
      WORKSHEETS.map((worksheet) => worksheet.source).sort(),
    );
  });

  it("schemaSource_TheAsksGiven_AreTheAsksCarried", () => {
    // Arrange — the asks are the whole reason the client needs this rather than a label
    // (docs/decisions/0004 · C8).
    const ASK = "Imagine someone who knows you well speaking at your funeral.";

    // Act
    const carried = asksIn(schemaSource(WORKSHEETS, new Map([["day4.eulogy", ASK]])));

    // Assert
    assert.equal(carried["day4.eulogy"], ASK);
  });

  it("schemaSource_NothingAtAll_StillProducesAModuleThatParses", () => {
    // Arrange — negative case. An empty set is no reason to write something unloadable:
    // build/client.ts notes that a syntax error here is a harder failure to trace than a
    // thrown one, because every export becomes undefined at the import site.
    // Act
    const code = schemaSource([], new Map());

    // Assert
    assert.deepEqual(worksheetsIn(code), []);
    assert.deepEqual(asksIn(code), {});
  });
});

describe("collectAsks", () => {
  it("collectAsks_TheRealWorksheets_GiveEveryQuestionItsAsk", async () => {
    // Arrange — the same property `buildPages` asserts, checked here because this is the path
    // that reaches the CLIENT. The two read the Markdown by different routes, and a question
    // with no ask is a question nothing outside its own page can state.
    // Act
    const asks = await collectAsks(ROOT);

    // Assert
    const empty = [...asks].filter(([, ask]) => ask.trim() === "").map(([id]) => id);
    assert.deepEqual(empty, []);
    assert.ok(asks.size > 100, `only ${asks.size} asks were collected`);
  });
});

describe("writeSchemaModule", () => {
  it("writeSchemaModule_ARootWithoutTheWorksheets_RefusesAndWritesNothing", async () => {
    // Arrange — negative case, and the only guard this step needs. The asks are read from the
    // root's own Markdown before anything is written, so a wrong root fails naming the file it
    // wanted rather than writing a module built from prose that is not there.
    //
    // It replaced a guard that could not fail: it checked the destination ended in
    // `src/client/schema.ts`, which it always does, because that is appended to whatever root
    // it is handed. Found by writing this test.
    const root = await writableRoot();
    const destination = path.join(root, SCHEMA_MODULE);
    await writeFile(destination, "// untouched\n", "utf8");

    // Act & Assert
    await assert.rejects(() => writeSchemaModule(root), /day-1-excavation\.md/);
    assert.equal(await readFile(destination, "utf8"), "// untouched\n");
  });

  it("writeSchemaModule_Always_WritesWhereBuildClientLooks", () => {
    // Arrange — two copies of one path would let the generator write where nothing reads, and
    // because the file is git-ignored the symptom is a build that emits no schema module at
    // all. Derived rather than repeated, and asserted so it stays derived.
    // Act & Assert
    assert.equal(SCHEMA_MODULE, `${CLIENT_DIR}/schema.ts`);
  });

  it("writeSchemaModule_BrokenDefinitions_AreRefusedBeforeAnythingIsWritten", async () => {
    // Arrange — `build()` runs `checkSchema` before it writes. This runs FIRST, from the
    // pretest and pretypecheck hooks, so without the same check it could hand the client a
    // schema the build would have rejected — and that copy is the one every later check then
    // agrees with. A duplicate identifier is what `checkSchema` exists to catch.
    const broken = [...WORKSHEETS, WORKSHEETS[0]].filter((one) => one !== undefined);

    // Act & Assert — refused on the definitions, before the root is even read. `loadSchema`
    // happens to catch a duplicate before `checkSchema` is reached; the property being pinned
    // is that broken definitions do not become the client's copy, not which guard says so.
    await assert.rejects(() => writeSchemaModule(ROOT, broken), /duplicate question id/);
  });
});

describe("the material an ask sends the reader to", () => {
  it("materialIn_ThePageOfValues_TakesTheWordsAndNotItsFurniture", () => {
    // Arrange — the words are the exercise; the title, the sentence saying what to do with
    // them, and the question anchor at the foot of the page are not. Carrying the whole file
    // would put a heading and an instruction to "mark every word" into a prompt that already
    // gives its own instructions, and an anchor comment that means nothing outside the build.
    const PAGE = [
      "# Values starter list",
      "",
      "Used on [Day 2](../days/day-2-values.md). Mark every word that feels like **you**.",
      "",
      "Adventure · Authenticity · Autonomy",
      "",
      "---",
      "",
      "**My own additions:**",
      "",
      "<!-- questions: values.additions -->",
    ].join("\n");

    // Act
    const list = materialIn(PAGE);

    // Assert
    assert.equal(list, "Adventure · Authenticity · Autonomy");
  });

  it("materialIn_APageWithNoListInIt_TakesNothingRatherThanGuessing", () => {
    // Arrange — negative case, and the one that makes the refusal below reachable. The list is
    // recognised by the separator it is written with, so a page rewritten without it yields
    // nothing — which has to fail loudly rather than ship a prompt that quietly lost the list,
    // since that is the defect #96 exists to fix.
    // Act & Assert
    assert.equal(materialIn("# A page\n\nWith prose and no list at all.\n"), "");
  });

  it("collectMaterial_TheRealWorkbook_CarriesTheListToTheAskThatLinksToIt", async () => {
    // Arrange — derived from the link rather than from a question id, so moving the link moves
    // the material with it. Exactly one ask in the workbook points at that page; the other two
    // links are cross-references and must carry nothing.
    const ONE = 1;
    const asks = await collectAsks(ROOT);

    // Act
    const material = await collectMaterial(ROOT, asks);

    // Assert
    assert.equal(material.size, ONE, `${material.size} questions were given material`);
    const [id, list] = [...material][0] ?? [];
    assert.equal(id, "day2.brainstorm");
    assert.ok((list ?? "").includes("Adventure"), "the list did not travel");
    assert.ok(!(list ?? "").includes("Values starter list"), "the page's title travelled with it");
    assert.ok(!(list ?? "").includes("questions:"), "the page's question anchor travelled with it");
  });

  it("collectMaterial_NoAskLinkingToThePage_CarriesNothing", async () => {
    // Arrange — negative case. The material exists for the asks that reference it, so a
    // workbook that stopped referencing it should ship none rather than an orphaned copy.
    const NONE = 0;

    // Act
    const material = await collectMaterial(ROOT, new Map([["day4.eulogy", "an ask linking nowhere"]]));

    // Assert
    assert.equal(material.size, NONE);
  });

  it("collectMaterial_APageRewrittenWithoutItsList_IsRefusedRatherThanShippedEmpty", async () => {
    // Arrange — the list is recognised by the separator it is written with, so a page rewritten
    // into prose or a bullet list yields nothing. Shipping that as an empty entry would put the
    // prompt back where #96 found it — telling an assistant to work from a list it cannot see —
    // with no test failing and nothing said. `writeSchemaModule` refuses a broken schema for
    // the same reason: the build is the last place that can notice.
    const root = await mkdtemp(path.join(tmpdir(), "material-"));
    after(async () => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "reference"), { recursive: true });
    await writeFile(
      path.join(root, "reference/values-list.md"),
      "# Values starter list\n\nWe took the list out and wrote a paragraph instead.\n",
      "utf8",
    );

    // Act & Assert
    await assert.rejects(
      () => collectMaterial(root, new Map([["day2.brainstorm", "see reference/values-list.md"]])),
      /carries no list/,
      "a page with no list left in it was shipped as material anyway",
    );
  });

  it("collectMaterial_APageTooLongToCheckBeforeCopying_IsRefused", async () => {
    // Arrange — 0007 · 1 asks the reader to read the payload before they copy it, and nothing
    // in this application measures how long a payload is. The bound lives here because here is
    // where a page can grow without anyone looking at a prompt: a reference list that doubled
    // would make every prompt carrying it unreadable on a phone, and the build is the last
    // place that can say so.
    const root = await mkdtemp(path.join(tmpdir(), "material-"));
    after(async () => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "reference"), { recursive: true });
    const TOO_LONG = 2001;
    await writeFile(
      path.join(root, "reference/values-list.md"),
      `${"Word · ".repeat(Math.ceil(TOO_LONG / 7))}\n`,
      "utf8",
    );

    // Act & Assert
    await assert.rejects(
      () => collectMaterial(root, new Map([["day2.brainstorm", "see reference/values-list.md"]])),
      /characters/,
      "a list too long to read was shipped anyway",
    );
  });

  it("schemaSource_Material_IsExportedForTheClientToRead", () => {
    // Arrange — the client cannot fetch the page (0006), so the only way the list reaches a
    // prompt is as part of the module the schema ships as script.
    // Act
    const source = schemaSource(WORKSHEETS, new Map(), new Map([["day2.brainstorm", "A · B"]]));

    // Assert
    assert.match(source, /export const MATERIAL: Readonly<Record<string, string>>/);
    assert.ok(source.includes('"day2.brainstorm": "A · B"'), "the material is not in the module");
  });
});
