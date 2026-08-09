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
  /**
   * Whether the current transaction can still take requests.
   *
   * IndexedDB commits a transaction as soon as its microtask queue drains, and every
   * request issued afterwards throws `TransactionInactiveError`. A fake without that rule
   * accepts requests forever, so "these writes were atomic" and "these writes happened at
   * some point" look identical — which is how the atomicity test below first came to pass
   * against an implementation that awaited a macrotask in the middle.
   */
  let active = false;
  const guard = (op: string): void => {
    if (!active) {
      throw new Error(`TransactionInactiveError: ${op} was issued after the transaction closed`);
    }
  };
  const store = {
    getAllKeys: () => request(entries.map(([key]) => key)),
    getAll: () => request(entries.map(([, value]) => value)),
    get: (key: unknown) => {
      guard("get");
      calls.push({ op: "get", args: [key] });
      return request(entries.find(([stored]) => stored === key)?.[1]);
    },
    clear: () => {
      guard("clear");
      calls.push({ op: "clear", args: [] });
      return request(undefined);
    },
    put: (value: unknown, key: unknown) => {
      guard("put");
      calls.push({ op: "put", args: [key, value] });
      return request(key);
    },
    delete: (key: unknown) => {
      guard("delete");
      calls.push({ op: "delete", args: [key] });
      return request(undefined);
    },
  };
  const fake = {
    calls,
    /** How many transactions were opened. `claim` is only atomic if it opens one. */
    transactions: 0,
    transaction: () => {
      fake.transactions += 1;
      active = true;
      const transaction = { objectStore: () => store, oncomplete: () => {}, onabort: () => {}, onerror: () => {}, error: null };
      // A macrotask, so anything the implementation awaits beyond the microtask queue
      // finds the transaction closed, exactly as a browser would.
      setTimeout(() => {
        active = false;
        transaction.oncomplete();
      }, 0);
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

describe("claim", () => {
  it("claim_GuardNotYetSet_WritesEveryEntryAndReportsTheWin", async () => {
    // Arrange — materialising a repeat group: the order and the answer that triggered it
    // go in together, because the answer's key does not exist until the identifiers do
    // (0013 · Q1).
    const GUARD = "day1.chapters";
    const ORDER = '["5f1c","9a34"]';
    const ANSWER = "day1.chapters.5f1c.title";
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    const won = await store.claim(GUARD, new Map([[GUARD, ORDER], [ANSWER, "The garage-band years"]]));

    // Assert
    assert.equal(won, true);
    assert.deepEqual(fake.calls, [
      { op: "get", args: [GUARD] },
      { op: "put", args: [GUARD, ORDER] },
      { op: "put", args: [ANSWER, "The garage-band years"] },
    ]);
  });

  it("claim_GuardAlreadySet_WritesNothingAndReportsTheLoss", async () => {
    // Arrange — negative case, and the two-tab race this operation exists for. Another
    // tab materialised the same group first; overwriting its order would strand every
    // answer already written under the identifiers it minted.
    const GUARD = "day1.chapters";
    const ORDER = '["5f1c","9a34"]';
    const fake = database([[GUARD, ORDER]]);
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    const won = await store.claim(GUARD, new Map([[GUARD, '["ffff","eeee"]'], ["day1.chapters.ffff.title", "mine"]]));

    // Assert
    assert.equal(won, false);
    assert.deepEqual(fake.calls, [{ op: "get", args: [GUARD] }]);
  });

  it("claim_ReadAndWrite_ShareOneTransaction", async () => {
    // Arrange — the whole point. Reading the guard in one transaction and writing in the
    // next leaves a gap between them, and that gap is exactly where the other tab lands:
    // both would read "absent" and both would then write.
    const GUARD = "day1.chapters";
    const ORDER = '["5f1c","9a34"]';
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.claim(GUARD, new Map([[GUARD, ORDER]]));

    // Assert
    assert.equal(fake.transactions, 1);
  });

  it("claim_EmptyValueAmongTheEntries_DeletesRatherThanStoringBlankness", async () => {
    // Arrange — negative case. The triggering answer can be empty by the time the claim
    // is issued, because the reader may have deleted what they said while it was in
    // flight, and `write` already treats "" as absent rather than answered.
    const GUARD = "day1.chapters";
    const ORDER = '["5f1c","9a34"]';
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.claim(GUARD, new Map([[GUARD, ORDER], ["day1.chapters.5f1c.title", ""]]));

    // Assert
    assert.deepEqual(fake.calls, [
      { op: "get", args: [GUARD] },
      { op: "put", args: [GUARD, ORDER] },
      { op: "delete", args: ["day1.chapters.5f1c.title"] },
    ]);
  });
});

describe("merge", () => {
  it("merge_SeveralEntries_AreWrittenInOneTransaction", async () => {
    // Arrange — the entire justification for this method existing. Assistant output (0015)
    // touches a handful of keys across one or more groups, and writing them one at a time
    // leaves a window where a failure produces a store that is neither what the reader had
    // nor what they accepted, with nothing recording how far it got. That is the window
    // `replaceAll` was written to close, reached by the merge path instead of the restore
    // path — so "one transaction" is the property, not an implementation detail.
    const ORDER = '["5f1c","9a34"]';
    const TITLE = "The garage-band years";
    const ONE_TRANSACTION = 1;
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.merge(
      new Map([
        ["day1.chapters", ORDER],
        ["day1.chapters.5f1c.title", TITLE],
      ]),
    );

    // Assert
    assert.equal(fake.transactions, ONE_TRANSACTION);
    assert.deepEqual(fake.calls, [
      { op: "put", args: ["day1.chapters", ORDER] },
      { op: "put", args: ["day1.chapters.5f1c.title", TITLE] },
    ]);
  });

  it("merge_KeysItWasNotGiven_AreLeftAlone", async () => {
    // Arrange — the one property that distinguishes this from `replaceAll`, and the one
    // whose absence would be catastrophic: a merge that cleared would destroy the reader's
    // whole workbook, and until this test nothing would have failed. 0007 · C3 forbids an
    // absent field from removing a stored one, because assistant output is partial by
    // construction.
    const KEPT = "day4.eulogy";
    const fake = database([[KEPT, "something I wrote myself"]]);
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.merge(new Map([["day5.career.change", "a new answer"]]));

    // Assert
    assert.ok(
      !fake.calls.some((call) => call.op === "clear"),
      "a merge cleared the store",
    );
    assert.ok(
      !fake.calls.some((call) => call.args[0] === KEPT),
      "a merge touched a key it was not given",
    );
  });

  it("merge_AnEmptyValue_DeletesRatherThanStoringBlankness", async () => {
    // Arrange — negative case, and the branch whose own comment calls it "the second line of
    // that defence" while nothing exercised it. `write`, `claim` and `replaceAll` each have
    // this test; merge did not. The first line — 0015 refusing an empty value in a block so
    // an assistant cannot express a delete — is tested in agent-answers.test.ts.
    const KEY = "day1.chapters.5f1c.title";
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.merge(new Map([[KEY, ""]]));

    // Assert
    assert.deepEqual(fake.calls, [{ op: "delete", args: [KEY] }]);
  });

  it("merge_NothingToWrite_DoesNotFail", async () => {
    // Arrange — negative case. A plan whose every value matched what was already stored has
    // nothing to write, and that is a successful import of an answer already given rather
    // than an error.
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act & Assert
    await assert.doesNotReject(() => store.merge(new Map()));
    assert.deepEqual(fake.calls, []);
  });
});

describe("replaceAll", () => {
  it("replaceAll_Entries_ClearsAndWritesInOneTransaction", async () => {
    // Arrange — the destructive operation, and the one place "never partially imports"
    // (0009 · C4) is either true or not. Clearing in one transaction and writing in the
    // next leaves a window where a failure empties the store completely.
    const GUARD = "day1.chapters";
    const ORDER = '["5f1c"]';
    const fake = database([["day1.gone", "an answer the file does not have"]]);
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.replaceAll(new Map([[GUARD, ORDER], ["day1.patterns", "from the file"]]));

    // Assert
    assert.equal(fake.transactions, 1, "the clear and the writes were not atomic");
    assert.deepEqual(fake.calls, [
      { op: "clear", args: [] },
      { op: "put", args: [GUARD, ORDER] },
      { op: "put", args: ["day1.patterns", "from the file"] },
    ]);
  });

  it("replaceAll_AnEmptyValueInTheFile_IsNotStoredAsBlankness", async () => {
    // Arrange — negative case, matching `write`. A file carrying "" would otherwise restore
    // a store claiming every blank on the page had been answered.
    const fake = database();
    const store = fromDatabase(fake as unknown as IDBDatabase);

    // Act
    await store.replaceAll(new Map([["day1.patterns", "real"], ["day1.threads", ""]]));

    // Assert
    assert.deepEqual(fake.calls, [
      { op: "clear", args: [] },
      { op: "put", args: ["day1.patterns", "real"] },
    ]);
  });

  it("replaceAll_NoEntries_StillClearsWhatWasThere", async () => {
    // Arrange & Act — negative case. Importing a file exported before anything was written
    // is destructive and is exactly what the reader asked for; the confirmation gate is
    // where that gets questioned, not here.
    const fake = database([["day1.patterns", "will be discarded"]]);
    const store = fromDatabase(fake as unknown as IDBDatabase);
    await store.replaceAll(new Map());

    // Assert
    assert.deepEqual(fake.calls, [{ op: "clear", args: [] }]);
  });
});
