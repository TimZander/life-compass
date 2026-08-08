/**
 * Whether the bridge is on — the one question that decides whether anything else loads.
 *
 * This module had no tests. A mutation sweep found every branch deletable, including the two
 * that matter most: `bridgeIsOn(null)` returning true switches the feature on for every reader
 * whose browser blocks site data, which inverts the "off by default, never nudged" argument
 * the whole design rests on; and `setBridge` reporting success with nowhere to write makes the
 * page announce a setting it did not save.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bridgeIsOn, preferences, setBridge } from "./bridge.ts";

/** Storage that behaves. */
function working(initial?: string): Storage {
  const held = new Map<string, string>(
    initial === undefined ? [] : [["life-compass:assistant", initial]],
  );
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  } as unknown as Storage;
}

/** Storage that refuses, the way a browser blocking site data does. */
function refusing(): Storage {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  } as unknown as Storage;
}

describe("preferences", () => {
  it("preferences_AWindowWithStorage_HandsItBack", () => {
    // Arrange
    const storage = working();

    // Act & Assert
    assert.equal(preferences({ localStorage: storage } as unknown as Window), storage);
  });

  it("preferences_AWindowThatThrowsOnTheProperty_IsNothing", () => {
    // Arrange — negative case, and the actual bug this function exists for. Reaching for
    // `window.localStorage` is what throws when a browser blocks site data, not the `getItem`
    // beneath it, so guarding the method call would not have helped: unguarded, this aborted
    // `start` before the fields were bound and disabled the whole application for exactly the
    // privacy-minded readers most likely to block storage.
    const hostile = {
      get localStorage(): Storage {
        throw new Error("SecurityError: site data is blocked");
      },
    } as unknown as Window;

    // Act & Assert
    assert.doesNotThrow(() => preferences(hostile));
    assert.equal(preferences(hostile), null);
  });
});

describe("bridgeIsOn", () => {
  it("bridgeIsOn_NoStorageAtAll_IsOff", () => {
    // Arrange — the one that matters most. Returning true here would switch the feature on
    // for every reader whose browser blocks site data — the opposite of "off by default, and
    // never nudged toward handing your reflections to a third party", which is the argument
    // docs/decisions/0007 rests on.
    // Act & Assert
    assert.equal(bridgeIsOn(null), false);
  });

  it("bridgeIsOn_StorageThatThrows_IsOff", () => {
    // Arrange — negative case. A bridge that cannot remember its setting fails to off.
    // Act & Assert
    assert.equal(bridgeIsOn(refusing()), false);
  });

  it("bridgeIsOn_TheExactStoredValue_IsWhatCounts", () => {
    // Arrange — reading the key as "present" rather than "equal to on" made the feature
    // one-way: unticking wrote "off", which is not null, so it stayed on.
    // Act & Assert
    assert.equal(bridgeIsOn(working("on")), true);
    assert.equal(bridgeIsOn(working("off")), false);
    assert.equal(bridgeIsOn(working("yes")), false);
    assert.equal(bridgeIsOn(working()), false);
  });
});

describe("setBridge", () => {
  it("setBridge_NoStorage_ReportsThatNothingWasRecorded", () => {
    // Arrange — the caller announces "Copy buttons are on" on a true return. Reporting success
    // with nowhere to write makes the page state the opposite of what happened.
    // Act & Assert
    assert.equal(setBridge(null, true), false);
  });

  it("setBridge_StorageThatThrows_ReportsThatNothingWasRecorded", () => {
    // Arrange — negative case, same consequence by a different route.
    // Act & Assert
    assert.equal(setBridge(refusing(), true), false);
  });

  it("setBridge_BothDirections_AreRecordedAndReadBack", () => {
    // Arrange — a write that always recorded "on" survived every test, because nothing ever
    // turned it off and read it back.
    const storage = working();

    // Act & Assert
    assert.equal(setBridge(storage, true), true);
    assert.equal(bridgeIsOn(storage), true);
    assert.equal(setBridge(storage, false), true);
    assert.equal(bridgeIsOn(storage), false);
  });
});
