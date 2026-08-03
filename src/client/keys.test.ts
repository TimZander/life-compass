/**
 * The storage key format, which is the one thing here that cannot be changed later.
 *
 * Once a reader has answers, every rule below is load-bearing forever: a key that cannot
 * be taken apart again is an answer nobody can reach, and 0011 · C2 makes the migration
 * that would rescue it permanent code. So the tests are about the boundaries — what makes
 * a key readable back, and what a bad one does instead of being written.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerKey, newInstanceId, orderKey, parseAnswerKey, readOrder, writeOrder } from "./keys.ts";

describe("answerKey and parseAnswerKey", () => {
  it("answerKey_GroupInstanceAndField_JoinIntoAKeyThatParsesBack", () => {
    // Arrange — the round trip is the whole contract. 0011's rename-on-read cannot reach
    // an answer inside a repeat without it, and an orphan cannot be told from a live one.
    const GROUP = "day1.chapters";
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const FIELD = "title";

    // Act
    const key = answerKey(GROUP, INSTANCE, FIELD);

    // Assert
    assert.equal(key, `${GROUP}.${INSTANCE}.${FIELD}`);
    assert.deepEqual(parseAnswerKey(key, [GROUP]), { group: GROUP, instance: INSTANCE, field: FIELD });
  });

  it("answerKey_GroupThatPrefixesAnother_ParsesAsTheGroupItWasWrittenFor", () => {
    // Arrange — the ambiguity 0013 · Q6 names. `day1.chapters` and `day1.chapters.notes`
    // could both be groups, and a decoder that took the first prefix match would read an
    // answer under the wrong question.
    const SHORT = "day1.chapters";
    const LONG = "day1.chapters.notes";
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";

    // Act
    const parsed = parseAnswerKey(answerKey(LONG, INSTANCE, "body"), [SHORT, LONG]);

    // Assert — SHORT is offered first and still loses, because its remainder
    // ("notes.<instance>.body") has too many segments to be an instance and a field.
    assert.deepEqual(parsed, { group: LONG, instance: INSTANCE, field: "body" });
  });

  it("answerKey_DottedOrEmptyPart_ThrowsRatherThanWritingAnUnreadableKey", () => {
    // Arrange — negative case. A dot in any part moves the boundary a decoder finds, and
    // the damage is silent: the key stores fine and stops being readable years later.
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";

    // Act & Assert
    assert.throws(() => answerKey("", INSTANCE, "title"), /group identifier/);
    assert.throws(() => answerKey("day1.chapters", "5f1c.ba21", "title"), /not usable/);
    assert.throws(() => answerKey("day1.chapters", "", "title"), /not usable/);
    assert.throws(() => answerKey("day1.chapters", INSTANCE, "sub.title"), /not usable/);
    assert.throws(() => answerKey("day1.chapters", INSTANCE, ""), /not usable/);
  });

  it("parseAnswerKey_KeyNamingNoKnownGroup_IsUndefinedRatherThanAnError", () => {
    // Arrange — negative case. This is what an answer left behind by a retired question
    // looks like, and 0011 · C3 makes that an orphan to surface rather than a failure.
    const KEY = "day9.retired.5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55.title";

    // Act & Assert
    assert.equal(parseAnswerKey(KEY, ["day1.chapters"]), undefined);
  });

  it("parseAnswerKey_GroupIdentifierWithNothingAfterIt_IsNotAnAnswer", () => {
    // Arrange — negative case. A bare group identifier is the ORDER key, and reading it
    // as an answer would hand a reader their own instance list as prose.
    const GROUP = "day1.chapters";

    // Act & Assert
    assert.equal(parseAnswerKey(GROUP, [GROUP]), undefined);
    assert.equal(parseAnswerKey(`${GROUP}.`, [GROUP]), undefined);
    assert.equal(parseAnswerKey(`${GROUP}.5f1c`, [GROUP]), undefined);
    assert.equal(parseAnswerKey(`${GROUP}.5f1c.`, [GROUP]), undefined);
  });

  it("orderKey_Group_IsTheGroupIdentifierItself", () => {
    // Arrange & Act & Assert — stated as a test because the two key shapes are told apart
    // by exactly this, and an order key that gained a prefix or suffix would orphan every
    // group already materialised.
    assert.equal(orderKey("day1.chapters"), "day1.chapters");
  });
});

describe("readOrder and writeOrder", () => {
  it("readOrder_StoredOrder_ReturnsItsInstancesInOrder", () => {
    // Arrange — 0013 · C3: the array decides which slot shows which answer, so position
    // must survive the round trip exactly.
    const INSTANCES = ["5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55", "9a34cd77-1e2f-4b8d-8a01-3c9f7e5d2b66"];

    // Act
    const order = readOrder(writeOrder(INSTANCES));

    // Assert
    assert.deepEqual(order, { kind: "order", instances: INSTANCES });
  });

  it("readOrder_NothingStored_IsAbsentRatherThanUnreadable", () => {
    // Arrange & Act & Assert — the distinction 0013 · Q3 turns on. Only `absent` may
    // materialise, so collapsing these two into one answer is what would let a corrupt
    // order be minted over.
    assert.deepEqual(readOrder(undefined), { kind: "absent" });
  });

  it("readOrder_AnythingItCannotTrust_IsUnreadableAndKeepsTheStoredBytes", () => {
    // Arrange — negative case, and the one that destroys data if it goes the other way.
    // Each of these is a whole-order refusal rather than a filtered list: dropping an
    // entry shortens the array, every later instance moves up a slot, and the next write
    // makes that permanent.
    const NOT_JSON = "The garage-band years";
    const NOT_AN_ARRAY = '{"0":"5f1c"}';
    const DOTTED = '["5f1c.ba21","9a34"]';
    const EMPTY_ENTRY = '["","9a34"]';
    const NOT_A_STRING = '["5f1c",7]';
    const DUPLICATE = '["5f1c","5f1c"]';

    // Act & Assert
    for (const stored of [NOT_JSON, NOT_AN_ARRAY, DOTTED, EMPTY_ENTRY, NOT_A_STRING, DUPLICATE]) {
      assert.deepEqual(readOrder(stored), { kind: "unreadable", stored }, stored);
    }
  });

  it("readOrder_EmptyArray_IsAReadableOrderOfNoInstances", () => {
    // Arrange & Act & Assert — a group whose `min` is zero has no slots and no instances,
    // which is different from a group nobody has answered. Treating it as unreadable
    // would warn the reader about a group that is simply empty.
    assert.deepEqual(readOrder("[]"), { kind: "order", instances: [] });
  });

  it("writeOrder_InstanceItWouldRefuseToReadBack_ThrowsRatherThanStoringIt", () => {
    // Arrange — negative case. `readOrder` and this share one predicate precisely so an
    // order cannot pass the reader and then fail in the writer, or the reverse: a stored
    // order this module wrote and cannot read is the worst outcome available.
    // Act & Assert
    assert.throws(() => writeOrder(["5f1c.ba21"]), /not usable/);
    assert.throws(() => writeOrder([""]), /not usable/);
    assert.throws(() => writeOrder(["5f1c", "5f1c"]), /may not repeat/);
  });
});

describe("newInstanceId", () => {
  it("newInstanceId_CalledTwice_GivesTwoUsableAndDistinctIdentifiers", () => {
    // Arrange & Act
    const first = newInstanceId();
    const second = newInstanceId();

    // Assert — usable is the part that matters: a dot here would produce keys that cannot
    // be parsed back, and the collision check is the property the whole scheme exists for.
    assert.notEqual(first, second);
    assert.deepEqual(readOrder(writeOrder([first, second])), { kind: "order", instances: [first, second] });
  });

  it("newInstanceId_WithoutCryptoRandomUUID_ThrowsRatherThanKeyingAnAnswerBadly", () => {
    // Arrange — negative case. `crypto.randomUUID` is absent outside a secure context, and
    // an undefined identifier would be written into permanent storage as the string
    // "undefined" — every slot of every group colliding on one key, silently (0011 · C6).
    const original = globalThis.crypto;

    // Act & Assert
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      assert.throws(() => newInstanceId(), /unavailable/);
      Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
      assert.throws(() => newInstanceId(), /unavailable/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});
