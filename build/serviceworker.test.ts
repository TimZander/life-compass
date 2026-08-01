import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { ROOT } from "./build.ts";
import { cacheVersion, precachable, renderServiceWorker } from "./serviceworker.ts";

const ENTRIES = [
  { url: "/", content: "<p>home</p>" },
  { url: "/days/day-1-excavation", content: "<p>day one</p>" },
  { url: "/assets/css/style.css", content: "body{}" },
];

/** Pull the generated constants back out, so the tests read what ships. */
function precacheOf(source: string): readonly string[] {
  const match = /const PRECACHE = (\[[\s\S]*?\]);/.exec(source);
  assert.ok(match?.[1] !== undefined, "PRECACHE not found in the generated worker");
  return JSON.parse(match[1]) as string[];
}

describe("precachable", () => {
  it("precachable_UnderscorePrefixedFile_IsExcluded", () => {
    // Arrange — Cloudflare consumes _headers rather than serving it. Because addAll is
    // atomic, precaching it would 404, reject, and leave the site with no worker at all.
    const entries = [...ENTRIES, { url: "/_headers", content: "/*" }];

    // Act
    const kept = precachable(entries).map((entry) => entry.url);

    // Assert
    assert.ok(!kept.includes("/_headers"));
    assert.equal(kept.length, ENTRIES.length);
  });

  it("precachable_NestedUnderscoreFile_IsAlsoExcluded", () => {
    // Arrange — negative case: the rule is about the filename, at any depth.
    const entries = [{ url: "/nested/_redirects", content: "x" }];

    // Act & Assert
    assert.deepEqual(precachable(entries), []);
  });

  it("precachable_OrdinaryUrlContainingUnderscore_IsKept", () => {
    // Arrange — negative case: `day_one` is a page, not a Pages control file.
    const entries = [{ url: "/days/day_one", content: "x" }];

    // Act & Assert
    assert.equal(precachable(entries).length, 1);
  });
});

describe("cacheVersion", () => {
  it("cacheVersion_SameContent_IsStable", () => {
    // Arrange — a rebuild with no change must not invalidate every client's cache.
    // Act & Assert
    assert.equal(cacheVersion(ENTRIES), cacheVersion(ENTRIES));
  });

  it("cacheVersion_ChangedContent_Differs", () => {
    // Arrange — an unchanged name means an unchanged cache, so a deploy would never
    // reach an installed client.
    const edited = ENTRIES.map((e) => (e.url === "/" ? { ...e, content: "<p>edited</p>" } : e));

    // Act & Assert
    assert.notEqual(cacheVersion(ENTRIES), cacheVersion(edited));
  });

  it("cacheVersion_RenamedPageWithIdenticalContent_Differs", () => {
    // Arrange — hashing content alone would miss this, and it is a real change:
    // the old URL stops existing.
    const renamed = ENTRIES.map((e) => (e.url === "/" ? { ...e, url: "/home" } : e));

    // Act & Assert
    assert.notEqual(cacheVersion(ENTRIES), cacheVersion(renamed));
  });

  it("cacheVersion_ReorderedEntries_IsUnchanged", () => {
    // Arrange — discovery order is not a change to the site.
    const shuffled = [...ENTRIES].reverse();

    // Act & Assert
    assert.equal(cacheVersion(ENTRIES), cacheVersion(shuffled));
  });
});

describe("renderServiceWorker", () => {
  it("renderServiceWorker_Output_IsSyntacticallyValidJavaScript", () => {
    // Arrange — the worker ships as generated text and is never typechecked, so a
    // syntax error would reach production silently. `new Function` parses without
    // running, which is all that can be checked outside a worker scope.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.doesNotThrow(() => new Function(source));
  });

  it("renderServiceWorker_PrecacheList_IsSortedAndComplete", () => {
    // Act
    const urls = precacheOf(renderServiceWorker(ENTRIES));

    // Assert — sorted so an unrelated reordering does not churn the generated file.
    assert.deepEqual(urls, [...urls].sort());
    assert.deepEqual([...urls].sort(), [...ENTRIES.map((e) => e.url)].sort());
  });

  it("renderServiceWorker_UnservedFile_NeverReachesThePrecacheList", () => {
    // Arrange — negative case, and the one that would break every install.
    const source = renderServiceWorker([...ENTRIES, { url: "/_headers", content: "/*" }]);

    // Act & Assert
    assert.ok(!precacheOf(source).includes("/_headers"));
  });

  it("renderServiceWorker_OfflineNavigation_FallsBackToTheCached404", () => {
    // Arrange — a navigation that misses the cache while offline must render something
    // rather than a browser error page.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.ok(source.includes('caches.match("/404")'));
    assert.ok(source.includes('request.mode === "navigate"'));
  });

  it("renderServiceWorker_NonGetRequest_IsNotIntercepted", () => {
    // Arrange — the worker has no business answering anything but GET.
    const source = renderServiceWorker(ENTRIES);

    // Act & Assert
    assert.ok(source.includes('request.method !== "GET"'));
  });
});

describe("shipped client scripts", () => {
  it("swRegister_ShippedFile_IsSyntacticallyValidJavaScript", async () => {
    // Arrange — assets/js/sw-register.js is outside every guard the build has: it is
    // not in tsconfig's `include` (build/**/*.ts), there is no linter, and it ships on
    // every page. A syntax error would reach production silently. This is the same
    // parse check the generated worker gets, for the same reason.
    const source = await readFile(path.join(ROOT, "assets", "js", "sw-register.js"), "utf8");

    // Act & Assert
    assert.doesNotThrow(() => new Function(source));
  });

  it("swRegister_ShippedFile_RegistersTheWorkerAndReportsFailure", async () => {
    // Arrange — a registration that fails silently removes offline support and storage
    // durability (0008) with no signal at all.
    const source = await readFile(path.join(ROOT, "assets", "js", "sw-register.js"), "utf8");

    // Act & Assert
    assert.ok(source.includes('navigator.serviceWorker.register("/sw.js")'));
    assert.ok(source.includes("console.error"));
  });
});
