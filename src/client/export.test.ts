/**
 * The backup file, which is the only copy that survives eviction or uninstall.
 *
 * The tests that matter here are about what must NOT be dropped. An export that quietly
 * omits a key produces a file that looks complete, restores wrong, and is discovered to
 * have been wrong only once the original is gone — which is the whole scenario this
 * feature exists for.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { layout } from "../../build/layout.ts";
import { after, before, describe, it } from "node:test";
import {
  needsStore,
  download,
  envelopeOf,
  filenameFor,
  saveBackup,
  serialise,
  wireBackup,
  FORMAT,
  VERSION,
} from "./export.ts";
import { orderKey, writeOrder } from "./keys.ts";
import type { Store } from "./store.ts";

/** A store holding exactly what it is given. */
function stored(entries: ReadonlyMap<string, string>): Store {
  return {
    async readAll() {
      return entries;
    },
    async write() {
      throw new Error("an export must not write");
    },
    async claim() {
      throw new Error("an export must not write");
    },
    async merge() {
      throw new Error("nothing here merges");
    },
    async replaceAll() {
      throw new Error("an export must not write");
    },
  };
}

/** An `Answers` that records whether it was flushed before the store was read. */
function noAnswers(flushed: { yes: boolean } = { yes: false }) {
  return {
    async load() {
      return new Map<string, string>();
    },
    set() {},
    async flush() {
      flushed.yes = true;
    },
    stop() {},
  };
}

const WHEN = new Date("2026-08-04T14:12:37.000Z");
/** Long enough for a click handler's promise chain to settle. */
const SETTLE_MS = 20;
/** Comfortably past the deferral `download` uses before releasing a handed-over URL. */
const REVOKE_WAIT_MS = 1300;

describe("what the envelope carries", () => {
  it("envelopeOf_EveryKindOfStoredKey_IsCarriedVerbatim", async () => {
    // Arrange — the three kinds that exist, one of which is not prose. An instance order
    // (0013) holds JSON and is an answer's address, so a backup without it restores text
    // that nothing can place; an orphan belongs in the envelope by 0011 · C3, because a
    // retired question is not a deleted answer and this file is the only place that
    // distinction survives.
    const INSTANCE = "5f1cba21-0d3e-4a7c-9f10-2b8e6d4c1a55";
    const ANSWER = "what recurs when I am not performing";
    const ORDER = writeOrder([INSTANCE]);
    const ORPHAN = "written under a question that has since been retired";
    const store = stored(
      new Map([
        ["day1.patterns", ANSWER],
        [orderKey("day1.chapters"), ORDER],
        [`day1.chapters.${INSTANCE}.title`, "The garage-band years"],
        ["day9.retired", ORPHAN],
      ]),
    );

    // Act
    const envelope = await envelopeOf(store, WHEN);

    // Assert
    assert.deepEqual(envelope.payload, {
      "day1.patterns": ANSWER,
      "day1.chapters": ORDER,
      [`day1.chapters.${INSTANCE}.title`]: "The garage-band years",
      "day9.retired": ORPHAN,
    });
  });

  it("envelopeOf_AKeyNamedLikeObjectMachinery_SurvivesIntoTheFileAndBackOut", async () => {
    // Arrange — negative case, and the one drop path that existed in the function whose
    // whole contract is that nothing is dropped. `payload[key] = value` on a plain object
    // runs Object.prototype's `__proto__` setter instead of creating a property: the key
    // and the answer under it vanished, with no error and a file that looked complete.
    // Reachable through an orphan, whose identifier is whatever some past build allowed.
    const PRIVATE = "the answer under a key nobody expected";
    const store = stored(
      new Map([
        ["__proto__", PRIVATE],
        ["constructor", "also awkward"],
        ["", "an empty key"],
        ["day1.patterns", "ordinary"],
      ]),
    );

    // Act — through the file and back, because the format has to survive both directions.
    const envelope = await envelopeOf(store, WHEN);
    const reread = JSON.parse(serialise(envelope)) as { payload: Record<string, string> };

    // Assert
    const own = (payload: object, key: string): boolean =>
      Object.prototype.hasOwnProperty.call(payload, key);
    assert.equal(Object.keys(envelope.payload).length, 4, "a key was dropped on the way in");
    assert.ok(own(envelope.payload, "__proto__"), "__proto__ was swallowed on the way in");
    assert.ok(own(reread.payload, "__proto__"), "__proto__ was swallowed on the way back");
    assert.equal(reread.payload["__proto__"], PRIVATE);
    assert.equal(Object.keys(reread.payload).length, 4);
  });

  it("envelopeOf_TheEnvelopeItself_IsTheShape0009Froze", async () => {
    // Arrange — the fields an importer branches on before reading a byte of the payload.
    // This shape is permanent once a file exists in the wild.
    const store = stored(new Map([["day1.patterns", "an answer"]]));

    // Act
    const envelope = await envelopeOf(store, WHEN);

    // Assert
    assert.equal(envelope.format, FORMAT);
    assert.equal(envelope.version, VERSION);
    assert.equal(envelope.encryption, "none");
    assert.equal(envelope.exportedAt, "2026-08-04T14:12:37.000Z");
    assert.deepEqual(Object.keys(envelope).sort(), [
      "encryption",
      "exportedAt",
      "format",
      "payload",
      "version",
    ]);
  });

  it("envelopeOf_AnEmptyStore_IsStillAValidEnvelope", async () => {
    // Arrange & Act — negative case. Someone who has written nothing and exports anyway
    // gets a file that imports cleanly, rather than one an importer rejects as malformed.
    const envelope = await envelopeOf(stored(new Map()), WHEN);

    // Assert
    assert.deepEqual(envelope.payload, {});
    assert.equal(envelope.format, FORMAT);
  });

  it("envelopeOf_TheSameAnswersTwice_ProducesTheSameBytes", async () => {
    // Arrange — key order carries no meaning, which is the reason to fix it: successive
    // backups of unchanged answers then differ only where the answers differ, so a reader
    // can diff two files and see their own edits rather than a reshuffle.
    const entries: [string, string][] = [
      ["day2.values", "second"],
      ["anchor.theme", "first"],
      ["day1.patterns", "third"],
    ];
    const forwards = stored(new Map(entries));
    const backwards = stored(new Map([...entries].reverse()));

    // Act
    const one = serialise(await envelopeOf(forwards, WHEN));
    const two = serialise(await envelopeOf(backwards, WHEN));

    // Assert
    assert.equal(one, two);
    assert.deepEqual(Object.keys(JSON.parse(one).payload), [
      "anchor.theme",
      "day1.patterns",
      "day2.values",
    ]);
  });
});

describe("the file itself", () => {
  it("serialise_AnEnvelope_IsIndentedJsonEndingInANewline", async () => {
    // Arrange — a file the reader is told to look after themselves (0009 · C1), so it is
    // written to be opened and read rather than treated as opaque machine output.
    const envelope = await envelopeOf(stored(new Map([["day1.patterns", "an answer"]])), WHEN);

    // Act
    const text = serialise(envelope);

    // Assert
    assert.ok(text.includes('\n  "format"'), "the file is not indented");
    assert.ok(text.endsWith("}\n"), "the file does not end in a newline");
    assert.deepEqual(JSON.parse(text), envelope);
  });

  it("serialise_AnAnswerContainingJsonPunctuation_SurvivesTheRoundTrip", async () => {
    // Arrange — negative case. These are dictated paragraphs: quotation marks, backslashes
    // and newlines are ordinary content, not edge cases, and a file that mangles them
    // loses the reader's words silently.
    const AWKWARD = 'She said "no" — then\\nwrote:\n\t{"not": "json"} and an emoji 🌱';
    const store = stored(new Map([["day1.patterns", AWKWARD]]));

    // Act
    const text = serialise(await envelopeOf(store, WHEN));

    // Assert
    assert.equal(JSON.parse(text).payload["day1.patterns"], AWKWARD);
  });

  it("filenameFor_AMoment_NamesItInTheReadersOwnTimeNotUtc", async () => {
    // Arrange — built from local components, so this asserts the same thing in every
    // timezone the suite might run in. UTC here would be a small lie in the one artifact
    // the reader is asked to look after themselves: an evening export in Denver would be
    // named for tomorrow, in a folder they are scanning by date.
    const LOCAL = new Date(2026, 7, 4, 19, 5, 3);

    // Act & Assert
    assert.equal(filenameFor(LOCAL), "life-compass-2026-08-04-19-05-03.json");
  });

  it("filenameFor_SingleDigitPartsOfADate_ArePaddedSoNamesSort", async () => {
    // Arrange — negative case. Unpadded, "2026-1-9" sorts after "2026-10-1" in the folder
    // listing this name exists to be readable in.
    const EARLY = new Date(2026, 0, 9, 3, 7, 5);

    // Act & Assert
    assert.equal(filenameFor(EARLY), "life-compass-2026-01-09-03-07-05.json");
  });

  it("filenameFor_TwoExportsMomentsApart_DoNotShareAName", async () => {
    // Arrange — negative case, and a correction. An earlier version used the date alone,
    // reasoning that a same-day overwrite was safe because "the newer file is a superset
    // of unchanged answers". It is not: a reader who cleared an answer between the two
    // has a newer file that is strictly lossier, and the overwrite would destroy the only
    // copy of what they removed — in the feature whose whole job is to prevent that.
    // Seconds, not minutes: the likeliest second export is an immediate retry after the
    // first appeared to do nothing, and minute granularity collides exactly there.
    const FIRST = new Date(2026, 7, 4, 9, 15, 0);
    const RETRY = new Date(2026, 7, 4, 9, 15, 6);

    // Act & Assert
    assert.notEqual(filenameFor(FIRST), filenameFor(RETRY));
  });

  it("filenameFor_AnyMoment_IsLegalOnEveryPlatform", async () => {
    // Arrange & Act & Assert — negative case. A colon is not a legal filename character
    // everywhere, and an ISO timestamp is full of them.
    const name = filenameFor(WHEN);
    assert.ok(!/[:*?"<>|\\/]/.test(name), `${name} contains a character some platforms refuse`);
    assert.ok(name.endsWith(".json"));
  });
});

let window: Window;

before(() => {
  window = new Window();
});

after(() => {
  void window.close();
});

/** A page as the build emits it, with or without the schema stamp. */
function page(body: string = ""): Document {
  window.document.head.innerHTML = "";
  window.document.body.innerHTML = body;
  return window.document as unknown as Document;
}

describe("handing the file over", () => {
  it("download_SomeText_OffersItUnderTheGivenNameAndReleasesTheUrl", () => {
    // Arrange — an object URL and a synthetic click is the only way to hand somebody a
    // file with no server, and there may not be one: connect-src 'none' forbids this app
    // from sending their answers anywhere at all.
    const NAME = "life-compass-2026-08-04-14-12.json";
    const TEXT = '{"format":"life-compass/answers"}';
    const document = page();
    const created: string[] = [];
    const revoked: string[] = [];
    window.URL.createObjectURL = ((): string => {
      const url = `blob:test-${created.length}`;
      created.push(url);
      return url;
    }) as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = ((url: string) => revoked.push(url)) as typeof window.URL.revokeObjectURL;
    let clickedHref = "";
    let clickedName = "";
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const element = create(tag);
      if (tag === "a") {
        element.addEventListener("click", () => {
          clickedHref = (element as HTMLAnchorElement).href;
          clickedName = (element as HTMLAnchorElement).download;
        });
      }
      return element;
    }) as typeof document.createElement;

    // Act
    download(document, TEXT, NAME);

    // Assert
    assert.equal(created.length, 1, "no object URL was made");
    assert.equal(clickedName, NAME, "the file was offered under the wrong name");
    assert.equal(clickedHref, created[0], "the click did not point at the blob");
    assert.equal(document.querySelectorAll("a").length, 0, "the anchor was left in the page");
  });

  it("download_AClickThatThrows_StillReleasesTheUrl", async () => {
    // Arrange — negative case. Without a `finally`, a throwing click left a live
    // same-origin URL to the reader's entire workbook alive for the life of the document —
    // the exact exposure the code's own comment says it is avoiding.
    const MINE = "blob:the-one-that-failed";
    const document = page();
    const revoked: string[] = [];
    window.URL.createObjectURL = (() => MINE) as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = ((url: string) => revoked.push(url)) as typeof window.URL.revokeObjectURL;
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const element = create(tag);
      if (tag === "a") {
        (element as HTMLAnchorElement).click = () => {
          throw new Error("this browser refused the download");
        };
      }
      return element;
    }) as typeof document.createElement;

    // Act — restored immediately: a spy left installed here made every later test in this
    // file fail, which is the same pollution the shared `window` already invites.
    try {
      assert.throws(() => download(document, "{}", "x.json"), /refused/);
    } finally {
      document.createElement = create;
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.ok(revoked.includes(MINE), "a URL to every answer was left alive after a failure");
  });

  it("download_AfterTheClick_HoldsTheUrlOpenPastTheCurrentTurn", async () => {
    // Arrange — negative case. Revoking before the browser has read the blob cancels the
    // very download it names, and the reader gets a truncated or empty file that still
    // lands in their downloads looking like a backup.
    const MINE = "blob:the-one-this-test-made";
    const document = page();
    const revoked: string[] = [];
    window.URL.createObjectURL = (() => MINE) as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = ((url: string) => revoked.push(url)) as typeof window.URL.revokeObjectURL;

    // Act
    download(document, "{}", "x.json");
    const synchronously = revoked.includes(MINE);
    // Draining microtasks is the half a sleep cannot see: a revoke on a resolved promise
    // still fires inside this same turn, before control ever returns to the browser, and an
    // earlier version of this test passed against exactly that.
    await Promise.resolve();
    await Promise.resolve();
    const afterMicrotasks = revoked.includes(MINE);
    await new Promise((resolve) => setTimeout(resolve, REVOKE_WAIT_MS));

    // Assert — by identity, not by count: a revoke scheduled by an earlier test lands in
    // whatever spy is installed when its timer fires, so counting is not this test's job.
    assert.equal(synchronously, false, "the URL was revoked in the same statement");
    assert.equal(afterMicrotasks, false, "the URL was revoked before the browser got a turn");
    assert.ok(revoked.includes(MINE), "the URL was never released");
  });
});

describe("the whole control", () => {
  it("saveBackup_APageWithAnswers_WritesEverythingAndReportsTheFilename", async () => {
    // Arrange
    const ANSWER = "what recurs when I am not performing";
    const document = page();
    // Read the bytes back out of the blob the code actually made, rather than intercepting
    // the string on its way in — this is what a browser would be handed.
    let handed: { text(): Promise<string> } | undefined;
    window.URL.createObjectURL = ((blob: { text(): Promise<string> }) => {
      handed = blob;
      return "blob:test";
    }) as unknown as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = (() => {}) as typeof window.URL.revokeObjectURL;

    // Act
    const filename = await saveBackup(noAnswers(), stored(new Map([["day1.patterns", ANSWER]])), document, WHEN);

    // Assert — the file handed over is the envelope, stamped with this page's schema and
    // named for the moment it was taken.
    // Named from the same moment, in the reader's own time — asserted against `filenameFor`
    // rather than a literal, so this test says nothing about which timezone it runs in.
    assert.equal(filename, filenameFor(WHEN));
    assert.ok(handed !== undefined, "nothing was handed to the browser");
    const envelope = JSON.parse(await handed.text());
    assert.equal(envelope.payload["day1.patterns"], ANSWER);
    assert.equal(envelope.format, FORMAT);
  });
});

describe("flushing before the file is built", () => {
  it("saveBackup_AnswersStillQueued_AreWrittenBeforeTheStoreIsRead", async () => {
    // Arrange — the defect this exists to prevent, and the worst one this feature could
    // have. Autosave debounces, so reading the store directly gave a reader who had just
    // finished dictating a file without that paragraph — and an EMPTY file if it was all
    // they had written. The reader likeliest to press this is the one just told their
    // answers are not saving, whose entire unwritten set is what `flush` is holding. With
    // import replacing the store, that gap becomes permanent loss.
    const SPOKEN = "the paragraph I finished a moment before pressing the button";
    const kept = new Map<string, string>();
    const store: Store = {
      async readAll() {
        return new Map(kept);
      },
      async write(field, value) {
        kept.set(field, value);
      },
      async claim() {
        return true;
      },
      async merge() {
        throw new Error("nothing here merges");
      },
      async replaceAll() {
        throw new Error("an export must not write");
      },
    };
    // An `Answers` that has not written yet, exactly as a debounce leaves it.
    const answers = {
      async load() {
        return new Map<string, string>();
      },
      set() {},
      async flush() {
        kept.set("day1.patterns", SPOKEN);
      },
      stop() {},
    };
    const document = page();
    let handed: { text(): Promise<string> } | undefined;
    window.URL.createObjectURL = ((blob: { text(): Promise<string> }) => {
      handed = blob;
      return "blob:test";
    }) as unknown as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = (() => {}) as typeof window.URL.revokeObjectURL;

    // Act
    await saveBackup(answers, store, document, WHEN);

    // Assert
    assert.ok(handed !== undefined, "nothing was handed to the browser");
    assert.equal(JSON.parse(await handed.text()).payload["day1.patterns"], SPOKEN);
  });
});

describe("the control on the page", () => {
  const MARKUP =
    '<section id="backup" hidden><button type="button" id="backup-save">Download</button></section>';

  it("wireBackup_AWorkingStore_RevealsTheControlAndSavesOnPress", async () => {
    // Arrange — every line of this was invisible to the suite while it lived in app.ts,
    // which has no tests: nine mutations of it passed, including deleting it outright.
    const document = page(MARKUP);
    const handed: string[] = [];
    window.URL.createObjectURL = (() => "blob:test") as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = (() => {}) as typeof window.URL.revokeObjectURL;

    // Act
    wireBackup(document, noAnswers(), stored(new Map([["day1.patterns", "an answer"]])), {
      onHandedOver: (filename) => handed.push(filename),
      onFailure: () => handed.push("FAILED"),
    });
    const section = document.getElementById("backup");
    document.getElementById("backup-save")?.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.equal(section?.hidden, false, "the control was never revealed");
    assert.equal(handed.length, 1, "the press did not produce exactly one outcome");
    assert.ok(handed[0]?.startsWith("life-compass-"), `unexpected filename ${handed[0]}`);
  });

  it("wireBackup_TheStoreFails_ReportsItRatherThanClaimingAFile", async () => {
    // Arrange — negative case. A failure that reported nothing would leave the reader
    // believing they hold a backup they do not.
    const document = page(MARKUP);
    const failures: unknown[] = [];
    const broken: Store = {
      async readAll() {
        throw new Error("storage is unavailable");
      },
      async write() {},
      async claim() {
        return true;
      },
      async merge() {
        throw new Error("nothing here merges");
      },
      async replaceAll() {
        throw new Error("an export must not write");
      },
    };

    // Act
    wireBackup(document, noAnswers(), broken, {
      onHandedOver: () => failures.push("CLAIMED A FILE"),
      onFailure: (error) => failures.push(error),
    });
    document.getElementById("backup-save")?.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.equal(failures.length, 1);
    assert.ok(failures[0] instanceof Error, "the failure was reported as something else");
    assert.ok(!document.getElementById("backup-save")?.hasAttribute("aria-disabled"), "the control was left dead");
  });

  it("wireBackup_PressedTwiceQuickly_RunsOnceAndKeepsTheButtonFocusable", async () => {
    // Arrange — negative case, twice over. A second press must not start a second export
    // over the first; and the guard must not be the `disabled` attribute, which makes the
    // element unfocusable and so drops a keyboard or screen-reader reader to the document
    // body in the middle of the one flow they were told to use (0001).
    const document = page(MARKUP);
    const handed: string[] = [];
    window.URL.createObjectURL = (() => "blob:test") as typeof window.URL.createObjectURL;
    window.URL.revokeObjectURL = (() => {}) as typeof window.URL.revokeObjectURL;
    wireBackup(document, noAnswers(), stored(new Map()), {
      onHandedOver: (filename) => handed.push(filename),
      onFailure: () => handed.push("FAILED"),
    });
    const button = document.getElementById("backup-save");

    // Act
    button?.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    const disabledMidFlight = button?.hasAttribute("disabled") ?? false;
    button?.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // Assert
    assert.equal(disabledMidFlight, false, "the button was made unfocusable mid-operation");
    assert.equal(handed.length, 1, "a second press started a second export");
  });

  it("wireBackup_APageWithoutTheControl_SaysSoRatherThanReturningQuietly", () => {
    // Arrange — negative case. The build emits the control on every page that reaches this
    // code, so absent means the markup and this module have drifted, and the symptom is a
    // mandatory feature that is simply not there.
    const document = page("<p>no control here</p>");
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    // Act
    try {
      wireBackup(document, noAnswers(), stored(new Map()), {
        onHandedOver: () => {},
        onFailure: () => {},
      });
    } finally {
      console.error = original;
    }

    // Assert
    assert.equal(logged.length, 1, "a missing control was absorbed silently");
  });
});

describe("deciding whether a page needs the store at all", () => {
  it("needsStore_TheBackupPage_SaysYesEvenThoughItHasNoBlanks", () => {
    // Arrange — the defect a device found within an hour of the controls moving. The rule
    // was "does this page have blanks", which was true while the tools lived on the pages
    // that had them. The backup page has none, so the entry module returned before opening
    // anything and both controls stayed hidden — a page whose only purpose is those
    // controls, offering neither.
    window.document.body.innerHTML = layout("<p>prose</p>", "Backup", "backup");

    // Act & Assert
    assert.equal(needsStore(window.document as unknown as Document), true);
  });

  it("needsStore_AWorksheet_SaysYesForItsBlanks", () => {
    // Arrange
    window.document.body.innerHTML = layout(
      '<p><span class="fill" data-field="t.a" data-label="A">___</span></p>',
      "A worksheet",
      null,
    );

    // Act & Assert
    assert.equal(needsStore(window.document as unknown as Document), true);
  });

  it("needsStore_APageOfProseOnly_SaysNo", () => {
    // Arrange — negative case, and the reason the check exists: a decision record should
    // not prompt anybody about storage, and 0010 keeps it readable and printable with no
    // script having run.
    window.document.body.innerHTML = layout("<p>Just prose.</p>", "A record", null);

    // Act & Assert
    assert.equal(needsStore(window.document as unknown as Document), false);
  });
});
