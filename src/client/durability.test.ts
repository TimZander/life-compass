/**
 * What the browser will promise about these answers, said out loud.
 *
 * The line is the whole feature, so the tests are mostly about what it says. 0008 opens by
 * calling silent eviction "the worst failure available to the project — worse than a crash,
 * because it is unrecoverable and the user finds out weeks later"; a line that overstates
 * protection is that failure with reassurance in front of it.
 *
 * `describe` takes values rather than reading the browser, which is what makes the wording
 * testable at all. The three impure readers are tested against hostile objects, because each
 * of them is absent or throwing somewhere real.
 */

import assert from "node:assert/strict";
import { describe as group, it } from "node:test";
import {
  describe as line,
  installed,
  lastBackup,
  persisted,
  recordBackup,
  requestPersistence,
  showDurability,
  type Durability,
} from "./durability.ts";
import { Window } from "happy-dom";

/** Storage that behaves. */
function working(initial?: string): Storage {
  const held = new Map<string, string>(
    initial === undefined ? [] : [["life-compass:last-backup", initial]],
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

const SAVED = new Date("2026-08-09T14:30:00.000Z");

function state(over: Partial<Durability> = {}): Durability {
  return { installed: false, persisted: null, lastBackup: null, ...over };
}

group("describe", () => {
  it("describe_ProtectedAndInstalled_SaysBothPlainly", () => {
    // Arrange — the good case, and it still has to name the backup. 0008 · C3 makes export
    // the only thing that survives BOTH eviction and uninstall, so a reader told they are
    // protected and nothing else has been told half of what decides whether their writing
    // lasts.
    // Act
    const said = line(state({ installed: true, persisted: true, lastBackup: SAVED }));

    // Assert
    assert.match(said, /Installed on this device/);
    assert.match(said, /protected from being cleared/);
    assert.match(said, /Last backup saved from this device on 9 August 2026/);
  });

  it("describe_NotProtected_SaysTheBrowserCanClearThem", () => {
    // Arrange — the case the whole line exists for. It must say what can happen, in words
    // that do not require knowing what "persisted" means.
    // Act
    const said = line(state({ installed: false, persisted: false }));

    // Assert
    assert.match(said, /Not installed/);
    assert.match(said, /can clear them if it runs short of space/);
    assert.match(said, /No backup has been saved from this device/);
  });

  it("describe_TheBrowserWillNotSay_IsNotReportedAsUnprotected", () => {
    // Arrange — negative case, and the distinction 0008's Decision turns on. Reporting an
    // unknown as a "no" warns about a risk we cannot see, and "an app that warns about a
    // risk the browser has already removed teaches people to ignore its warnings".
    // Act
    const unknown = line(state({ installed: true, persisted: null }));
    const denied = line(state({ installed: true, persisted: false }));

    // Assert
    assert.match(unknown, /will not say whether/);
    assert.ok(!/can clear them/.test(unknown), "an unknown was reported as unprotected");
    assert.notEqual(unknown, denied, "unknown and refused read identically");
  });

  it("describe_EveryCombination_NamesInstallProtectionAndBackup", () => {
    // Arrange — 0008 · C5 asks for three facts: installed or not, persisted or not, when you
    // last exported. Each of the eight states has to carry all three, and none may leave a
    // reader to infer one from another.
    const BOTH = 2;
    const STATES = 8;

    // Act & Assert
    let seen = 0;
    for (const isInstalled of [true, false]) {
      for (const isPersisted of [true, false, null]) {
        for (const backup of [SAVED, null]) {
          if (isPersisted === null && backup === null && seen >= STATES) {
            continue;
          }
          const said = line(state({ installed: isInstalled, persisted: isPersisted, lastBackup: backup }));
          seen += 1;
          assert.match(said, isInstalled ? /Installed on this device/ : /Not installed/);
          assert.match(said, backup === null ? /No backup has been saved/ : /Last backup saved/);
          assert.ok(said.split(". ").length >= BOTH, `only one sentence: ${said}`);
        }
      }
    }
  });

  it("describe_TheLine_DoesNotInstructTheReader", () => {
    // Arrange — negative case. 0008 · C2 says somebody who arrives only to read is never
    // nagged, and C1 keeps the prompt a separate surface. This page already carries the
    // button; a line that reported state and then told the reader what to do would make a
    // page they chose to visit into one that badgers them.
    const NAGS = /you should|please |make sure|we recommend|don't forget|be sure to/i;

    // Act & Assert
    for (const isPersisted of [true, false, null]) {
      const said = line(state({ persisted: isPersisted }));
      assert.ok(!NAGS.test(said), `the line instructs rather than reports: ${said}`);
    }
  });
});

group("installed", () => {
  it("installed_DisplayModeStandalone_IsInstalled", () => {
    // Arrange
    const standalone = { matchMedia: () => ({ matches: true }), navigator: {} } as unknown as Window;

    // Act & Assert
    assert.equal(installed(standalone as unknown as globalThis.Window), true);
  });

  it("installed_IosStandaloneFlag_IsAlsoInstalled", () => {
    // Arrange — iOS has no `display-mode` signal and is where this matters most: Safari
    // purges storage for origins left unused for seven days (0008), so a reader who added
    // this to their home screen there is exactly who needs to know their state.
    const ios = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    } as unknown as globalThis.Window;

    // Act & Assert
    assert.equal(installed(ios), true);
  });

  it("installed_ABrowserTabOrNoMatchMedia_IsNotInstalled", () => {
    // Arrange — negative case, both ways. A window without `matchMedia` tells us nothing,
    // and nothing must not become "yes".
    const tab = { matchMedia: () => ({ matches: false }), navigator: {} } as unknown as globalThis.Window;
    const hostile = {
      matchMedia: () => {
        throw new Error("SecurityError");
      },
      navigator: {},
    } as unknown as globalThis.Window;

    // Act & Assert
    assert.equal(installed(tab), false);
    assert.equal(installed(hostile), false);
  });
});

group("persisted", () => {
  it("persisted_TheBrowserGrantsIt_IsTrue", async () => {
    // Arrange
    const nav = { storage: { persisted: () => Promise.resolve(true) } } as unknown as Navigator;

    // Act & Assert
    assert.equal(await persisted(nav), true);
  });

  it("persisted_NoStorageApiAtAll_IsUnknownRatherThanFalse", async () => {
    // Arrange — negative case, and the one that must not collapse. A browser without the API
    // has not refused; it has not answered, and 0008 forbids reporting the two as one.
    const bare = {} as unknown as Navigator;
    const partial = { storage: {} } as unknown as Navigator;

    // Act & Assert
    assert.equal(await persisted(bare), null);
    assert.equal(await persisted(partial), null);
  });

  it("persisted_ReachingForStorageThrows_IsUnknownRatherThanAFailure", async () => {
    // Arrange — negative case. Reaching for the property throws where site data is blocked,
    // which is the lesson bridge.ts records about `localStorage` — and the readers most
    // likely to block site data are the ones this application is built for.
    const hostile = {
      get storage(): StorageManager {
        throw new Error("SecurityError");
      },
    } as unknown as Navigator;

    // Act & Assert
    await assert.doesNotReject(() => persisted(hostile));
    assert.equal(await persisted(hostile), null);
  });
});

group("requestPersistence", () => {
  it("requestPersistence_ABrowserThatGrantsIt_ReportsTheGrant", async () => {
    // Arrange — the whole reason this exists. 0008 said "installation is the mechanism" and
    // specified only `persisted()`, which READS; nothing ever called `persist()`, which
    // REQUESTS. A device then reported itself installed and unprotected, because nothing had
    // asked. Installation makes the request likely to be granted; it is not the request.
    const nav = { storage: { persist: () => Promise.resolve(true) } } as unknown as Navigator;

    // Act & Assert
    assert.equal(await requestPersistence(nav), true);
  });

  it("requestPersistence_ABrowserThatRefuses_ReportsTheRefusal", async () => {
    // Arrange — negative case. A refusal is a real answer and must not read as an error.
    const nav = { storage: { persist: () => Promise.resolve(false) } } as unknown as Navigator;

    // Act & Assert
    assert.equal(await requestPersistence(nav), false);
  });

  it("requestPersistence_NoApiOrAThrowingOne_IsUnknownAndDoesNotReject", async () => {
    // Arrange — negative case, and the one that must not escape: this is called on the load
    // path without being awaited, so a rejection here becomes an unhandled rejection on every
    // page carrying blanks.
    const bare = {} as unknown as Navigator;
    const partial = { storage: {} } as unknown as Navigator;
    const hostile = {
      get storage(): StorageManager {
        throw new Error("SecurityError");
      },
    } as unknown as Navigator;

    // Act & Assert
    for (const nav of [bare, partial, hostile]) {
      await assert.doesNotReject(() => requestPersistence(nav));
      assert.equal(await requestPersistence(nav), null);
    }
  });

  it("requestPersistence_ABrowserThatRejects_IsUnknownRatherThanAnEscapedFailure", async () => {
    // Arrange — negative case. Firefox prompts here, so a reader dismissing the dialog can
    // produce a rejected promise rather than a false.
    const dismissed = {
      storage: { persist: () => Promise.reject(new Error("NotAllowedError")) },
    } as unknown as Navigator;

    // Act & Assert
    await assert.doesNotReject(() => requestPersistence(dismissed));
    assert.equal(await requestPersistence(dismissed), null);
  });
});

group("lastBackup and recordBackup", () => {
  it("recordBackup_ThenLastBackup_RoundTripsTheDate", () => {
    // Arrange
    const storage = working();

    // Act
    recordBackup(storage, SAVED);

    // Assert
    assert.equal(lastBackup(storage)?.toISOString(), SAVED.toISOString());
  });

  it("lastBackup_NothingStored_IsNothing", () => {
    // Arrange & Act & Assert — a first visit, before any backup.
    assert.equal(lastBackup(working()), null);
    assert.equal(lastBackup(null), null);
  });

  it("lastBackup_AStoredValueThatIsNotADate_IsNothingRatherThanGarbage", () => {
    // Arrange — negative case. Showing "Invalid Date" beside a claim about somebody's
    // answers is worse than showing nothing, and the value is reachable: any other tool
    // writing this key, or a half-written string, lands here.
    // Act & Assert
    assert.equal(lastBackup(working("not a date at all")), null);
    assert.equal(lastBackup(working("")), null);
  });

  it("recordBackup_StorageThatRefuses_DoesNotThrow", () => {
    // Arrange — negative case. The file has already been handed to the browser by this
    // point, so telling somebody their backup failed when it did not is the worse error.
    // Act & Assert
    assert.doesNotThrow(() => recordBackup(refusing(), SAVED));
    assert.equal(lastBackup(refusing()), null);
  });
});

group("showDurability", () => {
  it("showDurability_ThePageWithTheLine_FillsItInAndRevealsIt", () => {
    // Arrange — it ships hidden and empty, because a line asserting anything before the
    // browser has been asked is a guess about the one thing this page exists to be straight
    // about.
    const window = new Window();
    window.document.body.innerHTML = '<p id="storage-state" hidden></p>';
    const document = window.document as unknown as Document;

    // Act
    showDurability(document, state({ installed: true, persisted: true, lastBackup: SAVED }));

    // Assert
    const shown = document.getElementById("storage-state") as HTMLElement;
    assert.equal(shown.hidden, false);
    assert.match(shown.textContent ?? "", /protected from being cleared/);
    void window.close();
  });

  it("showDurability_AnyOtherPage_DoesNothing", () => {
    // Arrange — negative case. Every page but the backup page lacks the element, and that is
    // not an error.
    const window = new Window();
    window.document.body.innerHTML = "<p>a worksheet</p>";
    const document = window.document as unknown as Document;

    // Act & Assert
    assert.doesNotThrow(() => showDurability(document, state()));
    void window.close();
  });
});
