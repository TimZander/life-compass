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
import { collectAsks, schemaSource, writeSchemaModule, SCHEMA_MODULE } from "./schema.ts";
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

function asksIn(code: string): Record<string, string> {
  // Non-greedy, and anchored on the blank line that separates one export from the next. It was
  // `([\s\S]*);\n$`, which ran to the end of the file — correct only while ASKS happened to be
  // last, and silently broken by the export added after it.
  const found = /^export const ASKS[^=]*= ([\s\S]*?);\n\n/m.exec(code);
  assert.ok(found?.[1] !== undefined, "the module does not export ASKS");
  return JSON.parse(found[1]) as Record<string, string>;
}

/** Read READS back out of generated source, the way an importer would. */
function readsIn(code: string): Record<string, { target: string; group: string; field?: string }[]> {
  const found = /^export const READS[^=]*= ([\s\S]*);\n$/m.exec(code);
  assert.ok(found?.[1] !== undefined, "the module does not export READS");
  return JSON.parse(found[1]) as Record<string, { target: string; group: string; field?: string }[]>;
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
    assert.match(code, /^export const READS/m);
  });

  it("schemaSource_Always_ImportsItsTypeAsATypeOnly", () => {
    // Arrange — `build/client.ts` rewrites relative specifiers to `.js`, and
    // `../questions/index.js` is not a file the browser is ever served. A value import would
    // 404 the whole module; `import type` is erased before it ships.
    // Act
    const code = schemaSource(WORKSHEETS, new Map());

    // Assert
    assert.match(code, /^import type \{ Worksheet \}/m);
    assert.match(code, /^import type \{ ResolvedRead \}/m);
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
    assert.deepEqual(readsIn(code), {});
  });

  it("schemaSource_AQuestionThatReadsAField_CarriesTheTargetAlreadySplit", () => {
    // Arrange — the client never splits a target of its own, because only the schema knows
    // where a question id ends and a field id begins. `day5.career.change` is one field of
    // `day5.career`; read as a whole question it names nothing, and the answers are silently
    // never carried.
    // Act
    const carried = readsIn(schemaSource(WORKSHEETS, new Map()));

    // Assert
    assert.deepEqual(carried["day5.realignment"]?.[0], {
      target: "day5.career.change",
      group: "day5.career",
      field: "change",
    });
    assert.deepEqual(carried["day2.shortlist_ten"]?.[0], {
      target: "day2.brainstorm",
      group: "day2.brainstorm",
    });
  });

  it("schemaSource_AQuestionThatReadsNothing_IsLeftOutRatherThanCarriedEmpty", () => {
    // Arrange — negative case. 79 of the 113 questions declare nothing, and the client treats
    // a missing key and an empty list identically, so an entry per question would be bytes
    // shipped to every reader to say nothing.
    // Act
    const carried = readsIn(schemaSource(WORKSHEETS, new Map()));

    // Assert
    assert.equal(carried["day2.brainstorm"], undefined);
    assert.equal(carried["day1.chapters"], undefined);
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
