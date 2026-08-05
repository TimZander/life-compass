/**
 * The entry module's decisions, which nothing used to check.
 *
 * Every other client module is tested by calling it. `app.ts` is different: it takes no
 * arguments, exports nothing, and does its work as side effects when it is imported. That
 * was described in several comments as making it untestable, and that was wrong — a claim
 * this project treats as a defect in its own right. Installing the globals before importing
 * is what every other suite here already does, and a query string on the specifier gives a
 * fresh module instance per case, so the side effects can run more than once in one file.
 *
 * The cost of leaving it untested was not hypothetical. Moving the backup controls onto
 * their own page broke the one decision this module makes about whether to open a store at
 * all, and the page whose entire purpose was those controls shipped offering neither, past
 * a green suite.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { describe, it } from "node:test";
import { layout } from "../../build/layout.ts";

/** How long to let the module's asynchronous work settle before observing it. */
const SETTLE_MS = 60;

type Session = { throws?: boolean; seed?: Record<string, string> };

/**
 * Run `app.ts` against a page, and hand back what the reader would see.
 *
 * `indexedDB` is deliberately absent: the module's failure path is the one worth pinning,
 * because it is what a reader with storage switched off actually gets, and because a
 * throw escaping here used to take the whole application down with it.
 */
async function run(body: string, session: Session = {}): Promise<{
  readonly banner: string;
  readonly revealed: (id: string) => boolean;
  readonly remaining: Record<string, string>;
}> {
  const window = new Window({ url: "https://example.test/backup" });
  const scope = globalThis as unknown as Record<string, unknown>;
  for (const name of ["document", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event"]) {
    scope[name] = (window as unknown as Record<string, unknown>)[name];
  }
  scope["window"] = window;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: (window as unknown as { navigator: unknown }).navigator,
  });

  const store: Record<string, string> = { ...session.seed };
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        if (session.throws === true) {
          throw new Error("SecurityError: site data is blocked");
        }
        return store[key] ?? null;
      },
      setItem(key: string, value: string) {
        if (session.throws === true) {
          throw new Error("SecurityError: site data is blocked");
        }
        store[key] = value;
      },
      removeItem(key: string) {
        if (session.throws === true) {
          throw new Error("SecurityError: site data is blocked");
        }
        delete store[key];
      },
    },
  });

  window.document.body.innerHTML = body;
  const noise = console.error;
  console.error = () => {};
  try {
    // A fresh instance per case: the module does its work on import, so the cache would
    // otherwise give every case after the first a module that had already run.
    await import(`./app.ts?case=${Math.random()}`);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  } finally {
    console.error = noise;
  }
  const region = window.document.getElementById("banner-region");
  const result = {
    banner: region?.textContent?.trim() ?? "",
    revealed: (id: string) =>
      (window.document.getElementById(id) as unknown as { hidden: boolean } | null)?.hidden ===
      false,
    remaining: { ...store },
  };
  void window.close();
  return result;
}

/** The body of a real built page, so these run against what the build actually emits. */
function pageBody(isBackupPage: boolean, content = "<p>prose</p>"): string {
  const html = layout(content, "A page", isBackupPage);
  return html.slice(html.indexOf("<main"), html.indexOf("</body>"));
}

describe("deciding whether to open a store", () => {
  it("app_TheBackupPage_TriesToOpenAStoreAndSaysSoWhenItCannot", async () => {
    // Arrange — the defect a device found. The gate was "does this page have blanks", the
    // backup page has none, and so the page whose only purpose is the backup controls
    // returned before opening anything and revealed neither.
    // Act
    const result = await run(pageBody(true));

    // Assert — it got as far as storage, and told the reader when storage was not there.
    assert.ok(
      result.banner.includes("cannot be saved"),
      `the backup page never reached storage: ${JSON.stringify(result.banner)}`,
    );
  });

  it("app_APageOfProseOnly_DoesNothingAtAll", async () => {
    // Arrange — negative case, and the reason the gate exists. A decision record should not
    // prompt anybody about storage, and 0010 keeps it readable and printable with no script
    // having run.
    // Act
    const result = await run(pageBody(false));

    // Assert
    assert.equal(result.banner, "", "a page of prose was given a storage message");
  });
});

describe("reporting a restore that happened before this load", () => {
  it("app_AJustCompletedRestore_IsConfirmedOnceAndThenForgotten", async () => {
    // Arrange — the restore reloads the page to make the screen match the store, which
    // takes the banner with it. Without this the one message confirming an irreversible
    // action would be the one nobody ever sees.
    // Act
    // A page with nothing to bind, so the confirmation is not immediately replaced by the
    // storage-failure message: this environment has no IndexedDB, and the banner region
    // shows the last message given to it. Which is itself worth knowing — a restore
    // confirmed and then followed by a storage failure shows only the failure.
    const result = await run(pageBody(false), { seed: { "life-compass:restored": "7" } });

    // Assert — said once, and cleared so it is not repeated on every later page.
    assert.ok(
      result.banner.includes("Restored 7 answers"),
      `the restore was never confirmed: ${JSON.stringify(result.banner)}`,
    );
    assert.deepEqual(result.remaining, {}, "the flag was left behind to repeat forever");
  });

  it("app_ASingleRestoredAnswer_IsCountedInTheSingular", async () => {
    // Arrange & Act — negative case for the pluralisation, which is in the sentence a
    // reader reads immediately after an irreversible action.
    const result = await run(pageBody(false), { seed: { "life-compass:restored": "1" } });

    // Assert
    assert.ok(result.banner.includes("Restored 1 answer "), result.banner);
  });

  it("app_SessionStorageThatThrows_StillStartsTheRestOfTheApplication", async () => {
    // Arrange — negative case, and the worst failure this module had. Reading the flag was
    // unguarded at module scope, so where site data is blocked the throw aborted evaluation
    // before anything else ran: no field binding, no autosave, no controls, and no banner
    // explaining any of it. A rare-event confirmation disabling the whole application for
    // the readers most likely to hit it.
    // Act
    const result = await run(pageBody(true), { throws: true });

    // Assert — it carried on to the storage attempt rather than stopping at the flag.
    assert.ok(
      result.banner.includes("cannot be saved"),
      `evaluation stopped at the session flag: ${JSON.stringify(result.banner)}`,
    );
  });
});
