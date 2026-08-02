/**
 * The decisions inside store.ts, held still by a fake database.
 *
 * Not a fake of IndexedDB — that would only test the fake. This fakes the four calls
 * `fromDatabase` makes and asserts what this file decides on top of them: that keys pair
 * to values, that an empty answer is deleted rather than stored, and that an entry this
 * version cannot read is surfaced rather than quietly skipped.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromDatabase } from "./store.ts";

type Call = { readonly op: string; readonly args: readonly unknown[] };

/** A request that succeeds on the next turn, which is the shape IndexedDB hands back. */
function request(result: unknown): unknown {
  const pending = { onsuccess: () => {}, onerror: () => {}, result, error: null };
  queueMicrotask(() => pending.onsuccess());
  return pending;
}

function database(entries: readonly (readonly [unknown, unknown])[] = []) {
  const calls: Call[] = [];
  const store = {
    getAllKeys: () => request(entries.map(([key]) => key)),
    getAll: () => request(entries.map(([, value]) => value)),
    put: (value: unknown, key: unknown) => {
      calls.push({ op: "put", args: [key, value] });
      return request(key);
    },
    delete: (key: unknown) => {
      calls.push({ op: "delete", args: [key] });
      return request(undefined);
    },
  };
  const fake = {
    calls,
    transaction: () => {
      const transaction = { objectStore: () => store, oncomplete: () => {}, onabort: () => {}, onerror: () => {}, error: null };
      queueMicrotask(() => queueMicrotask(() => transaction.oncomplete()));
      return transaction;
    },
  };
  return fake;
}

describe("readAll", () => {
  it("readAll_KeysAndValues_ArePairedByPosition", async () => {
    // Arrange — IndexedDB returns both in key order, so the nth key belongs to the nth
    // value. Pairing them wrongly would hand every answer to the wrong question.
    const store = fromDatabase(database([
      ["day1.patterns", "what recurs"],
      ["day1.threads", "what I loved at ten"],
    ]) as unknown as IDBDatabase);

    // Act & Assert
    assert.deepEqual([...(await store.readAll())], [
      ["day1.patterns", "what recurs"],
      ["day1.threads", "what I loved at ten"],
    ]);
  });

  it("readAll_EntryThisVersionCannotRead_IsSurfacedNotDropped", async () => {
    // Arrange — negative case: 0011 requires an orphan to be retained AND surfaced.
    // Skipping it silently makes it invisible to an export as well as to the page.
    const store = fromDatabase(database([
      ["day1.patterns", "readable"],
      ["day1.chapters", [{ instance: "5f1c", values: {} }]],
    ]) as unknown as IDBDatabase);
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);

    // Act
    let answers: ReadonlyMap<string, string>;
    try {
      answers = await store.readAll();
    } finally {
      console.warn = original;
    }

    // Assert
    assert.deepEqual([...answers], [["day1.patterns", "readable"]]);
    assert.equal(warnings.length, 1);
    assert.ok(JSON.stringify(warnings[0]).includes("day1.chapters"));
  });

  it("readAll_EmptyStore_IsAnEmptyMap", async () => {
    // Arrange & Act — negative case: a first visit, before anything is written.
    const store = fromDatabase(database() as unknown as IDBDatabase);

    // Assert
    assert.equal((await store.readAll()).size, 0);
  });
});

describe("write", () => {
  it("write_Value_IsStoredUnderTheFieldIdentifier", async () => {
    // Arrange
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.write("day1.threads", "a dictated paragraph");

    // Assert
    assert.deepEqual(fake.calls, [
      { op: "put", args: ["day1.threads", "a dictated paragraph"] },
    ]);
  });

  it("write_EmptyValue_DeletesRatherThanStoringBlankness", async () => {
    // Arrange — an empty field is an absent answer, not an empty one. Storing "" would
    // make an export claim the reader answered every blank on the page.
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.write("day1.threads", "");

    // Assert
    assert.deepEqual(fake.calls, [{ op: "delete", args: ["day1.threads"] }]);
  });
});
