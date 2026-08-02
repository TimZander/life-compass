/**
 * The storage key format, pinned.
 *
 * This is the one thing in the project that cannot be changed once a reader has answers,
 * so these tests exist less to catch a bug today than to make a future change to the
 * format loud. A key that silently shifts shape is answers that silently disappear.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerKey, newInstanceId, orderKey, readOrder, writeOrder } from "./keys.ts";

describe("answerKey", () => {
  it("answerKey_GroupInstanceAndField_JoinsThemInThatOrder", () => {
    // Arrange
    const GROUP = "day1.chapters";
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const FIELD = "title";

    // Act & Assert — the format future readers will have to parse.
    assert.equal(answerKey(GROUP, INSTANCE, FIELD), `${GROUP}.${INSTANCE}.${FIELD}`);
  });

  it("answerKey_TwoInstancesOfOneField_DoNotCollide", () => {
    // Arrange — the whole reason instances exist: five chapters each have a `title`, and
    // before this they shared one key and overwrote each other.
    const GROUP = "day1.chapters";
    const FIELD = "title";

    // Act
    const first = answerKey(GROUP, newInstanceId(), FIELD);
    const second = answerKey(GROUP, newInstanceId(), FIELD);

    // Assert
    assert.notEqual(first, second);
  });

  it("answerKey_InstanceContainingTheSeparator_IsRefused", () => {
    // Arrange — negative case. Escaping instead would let two different instances produce
    // one key, and this format must stay readable by something simpler than this code.
    const GROUP = "day1.chapters";
    const AMBIGUOUS = "5f1c.ba21";

    // Act & Assert
    assert.throws(() => answerKey(GROUP, AMBIGUOUS, "title"), /not usable in a key/);
  });

  it("answerKey_EmptyInstance_IsRefused", () => {
    // Arrange & Act & Assert — negative case: an empty identifier would make the answer
    // key indistinguishable from a single-valued question's key.
    assert.throws(() => answerKey("day1.chapters", "", "title"), /not usable in a key/);
  });

  it("answerKey_NeverEqualsAnOrderKey", () => {
    // Arrange — an answer key always has segments after the group, so it can never be
    // mistaken for the bare group identifier that holds the order.
    const GROUP = "day1.chapters";

    // Act & Assert
    assert.notEqual(answerKey(GROUP, newInstanceId(), "title"), orderKey(GROUP));
  });
});

describe("instance order", () => {
  it("writeOrder_ThenReadOrder_RoundTrips", () => {
    // Arrange
    const INSTANCES = [newInstanceId(), newInstanceId(), newInstanceId()];

    // Act & Assert — order is the whole point; it is what display position comes from.
    assert.deepEqual(readOrder(writeOrder(INSTANCES)), INSTANCES);
  });

  it("readOrder_NeverWritten_IsEmpty", () => {
    // Arrange & Act & Assert — a group nobody has answered yet.
    assert.deepEqual(readOrder(undefined), []);
  });

  it("readOrder_NotJson_IsEmptyRatherThanAThrow", () => {
    // Arrange — negative case: one corrupt group must not take down a page of answers.
    // The stored value is left alone, so nothing is destroyed by being unreadable today.
    // Act & Assert
    assert.deepEqual(readOrder("a chapter title, written here by an older version"), []);
  });

  it("readOrder_JsonButNotAnArray_IsEmpty", () => {
    // Arrange & Act & Assert — negative case.
    assert.deepEqual(readOrder('{"instance":"5f1c"}'), []);
  });

  it("readOrder_ArrayWithNonStrings_KeepsOnlyUsableIdentifiers", () => {
    // Arrange — negative case: a partially corrupt list should still restore the
    // instances it can rather than losing every chapter on the page.
    const GOOD = newInstanceId();

    // Act & Assert
    assert.deepEqual(readOrder(JSON.stringify([GOOD, 7, null, ""])), [GOOD]);
  });
});

describe("newInstanceId", () => {
  it("newInstanceId_EachCall_IsDistinctAndKeySafe", () => {
    // Arrange
    const HOW_MANY = 200;

    // Act
    const ids = new Set(Array.from({ length: HOW_MANY }, () => newInstanceId()));

    // Assert
    assert.equal(ids.size, HOW_MANY);
    for (const id of ids) {
      assert.ok(!id.includes("."), `${id} contains the key separator`);
    }
  });
});
