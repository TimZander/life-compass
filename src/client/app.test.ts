/**
 * The entry module's decisions, which nothing used to check.
 *
 * It was described in several comments as untestable, which was wrong — a claim this
 * project treats as a defect in its own right. What was true is that it did its work at
 * module scope, so the only way to observe it was to import and then sleep, guessing at how
 * long the work takes. That guess is the pattern that has already produced one flaky test
 * here, so `start()` is exported and these await it instead. Exact, and no cache-busting
 * import specifier is needed to run a second scenario.
 *
 * The cost of leaving it untested was not hypothetical. Moving the backup controls onto
 * their own page broke the one decision this module makes about whether to open a store at
 * all, and the page whose entire purpose was those controls shipped offering neither, past
 * a green suite.
 */

import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { before, describe, it } from "node:test";
import { layout, type Tools } from "../../build/layout.ts";

type Session = { throws?: boolean; seed?: Record<string, string> };

/**
 * `start`, resolved once before any test runs.
 *
 * The module calls `start()` itself on load, so importing it inside the first test would
 * run that test's scenario twice while every later test ran once — an asymmetry that could
 * hide a defect in whichever case happened to be first. Importing here, against a bare
 * window with nothing on it, means that free run does nothing and all five cases are alike.
 */
let start: () => Promise<void>;

before(async () => {
  install(new Window({ url: "https://example.test/" }), {});
  ({ start } = await import("./app.ts"));
});

/** Point the globals at a window, with a session store that behaves as asked. */
function install(window: Window, session: Session): Window {
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
  const refuse = (): never => {
    throw new Error("SecurityError: site data is blocked");
  };
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (session.throws === true ? refuse() : (store[key] ?? null)),
      setItem: (key: string, value: string) => {
        if (session.throws === true) {
          refuse();
        }
        store[key] = value;
      },
      removeItem: (key: string) => {
        if (session.throws === true) {
          refuse();
        }
        delete store[key];
      },
    },
  });
  (window as unknown as { seen: Record<string, string> }).seen = store;
  return window;
}

/**
 * Run `app.ts` against a page, and hand back what the reader would see.
 *
 * `indexedDB` is deliberately absent: the module's failure path is the one worth pinning,
 * because it is what a reader with storage switched off actually gets, and because a
 * throw escaping here used to take the whole application down with it.
 */
async function run(body: string, session: Session = {}): Promise<{
  readonly banner: string;
  readonly remaining: Record<string, string>;
  readonly agentVisible: boolean;
}> {
  const window = install(new Window({ url: "https://example.test/backup" }), session);
  window.document.body.innerHTML = body;
  const noise = console.error;
  console.error = () => {};
  try {
    // Awaited, not slept on. `start` is the same work the module runs on load, so when it
    // resolves there is nothing left in flight to observe.
    await start();
  } finally {
    console.error = noise;
  }
  const region = window.document.getElementById("banner-region");
  const result = {
    banner: region?.textContent?.trim() ?? "",
    remaining: { ...(window as unknown as { seen: Record<string, string> }).seen },
    // Read before the window closes: some decisions this module makes are visible only as
    // markup, and asserting on a banner cannot see them.
    agentVisible: window.document.querySelector("#agent:not([hidden])") !== null,
  };
  void window.close();
  return result;
}

/** The body of a real built page, so these run against what the build actually emits. */
function pageBody(tools: Tools, content = "<p>prose</p>"): string {
  const html = layout(content, "A page", tools);
  return html.slice(html.indexOf("<main"), html.indexOf("</body>"));
}

describe("deciding whether to open a store", () => {
  it("app_TheBackupPage_TriesToOpenAStoreAndSaysSoWhenItCannot", async () => {
    // Arrange — the defect a device found. The gate was "does this page have blanks", the
    // backup page has none, and so the page whose only purpose is the backup controls
    // returned before opening anything and revealed neither.
    // Act
    const result = await run(pageBody("backup"));

    // Assert — it got as far as storage, and told the reader when storage was not there.
    assert.ok(
      result.banner.includes("cannot be saved"),
      `the backup page never reached storage: ${JSON.stringify(result.banner)}`,
    );
  });

  it("app_TheAssistantPage_RevealsItsOptInWithoutNeedingAStore", async () => {
    // Arrange — the same defect as the one above, made a second time and found on a device
    // again: the page whose entire purpose is one switch shipped with the switch still
    // hidden. The opt-in reads a preference from localStorage and needs no answers, so
    // gating it on "does this page have blanks" put all of /agent behind a check for
    // something that page does not have.
    // Act
    const result = await run(pageBody("agent"));

    // Assert
    assert.equal(result.agentVisible, true, "the assistant page shipped with its switch hidden");
  });

  it("app_AWorksheetWithTheBridgeOn_GrowsAControlOnEveryQuestion", async () => {
    // Arrange — the decision, not the wiring. Deleting the `wireQuestionControls` call from
    // `start` left all 401 tests green: the eight tests for that module call it directly, so
    // none of them could notice that nothing calls it. That is the shape of the defect this
    // page already shipped once, one layer up — the wiring is tested, the decision to wire is
    // not.
    const window = install(new Window({ url: "https://example.test/days/day-1-excavation" }), {});
    window.localStorage.setItem("life-compass:assistant", "on");
    window.document.body.innerHTML = pageBody(null, '<p class="q-single" data-question="day4.eulogy">x</p>');
    const noise = console.error;
    console.error = () => {};
    try {
      await start();
    } finally {
      console.error = noise;
    }

    // Act
    const controls = window.document.querySelectorAll("button.agent-open").length;
    void window.close();

    // Assert
    assert.equal(controls, 1, "the question grew no copy control");
  });

  it("app_TheStoreRefusingToOpen_LeavesThePanelSayingSoRatherThanQuietlyDroppingTheAnswers", async () => {
    // Arrange — the `readEntries` callback had no test of any kind: flush-before-read, the
    // memoised handle and the failure path all survived mutation. This is the failure path,
    // and it is not hypothetical here — there is no IndexedDB in this environment, which is
    // the same thing a reader meets with site data blocked or in private browsing.
    //
    // It used to resolve to an empty Map. The panel cannot tell that apart from "nothing
    // written yet", so the reader ticked "include what I have already written", watched the
    // preview not change, and was told nothing. For a repeat it silently drops every instance
    // identifier as well, which 0015 · C3 forbids outright.
    const SETTLE = 8;
    const window = install(new Window({ url: "https://example.test/days/day-1-excavation" }), {});
    window.localStorage.setItem("life-compass:assistant", "on");
    window.document.body.innerHTML = pageBody(
      null,
      '<p class="q-single" data-question="day4.eulogy">x</p>',
    );
    const noise = console.error;
    console.error = (): void => {};
    try {
      await start();
      (window.document.querySelector("button.agent-open") as unknown as HTMLElement).click();
      for (let turn = 0; turn < SETTLE; turn += 1) {
        await Promise.resolve();
      }
    } finally {
      console.error = noise;
    }

    // Act
    const shown = window.document.querySelector(".agent-preview")?.textContent ?? "";
    void window.close();

    // Assert
    assert.match(shown, /could not be read/, `the store failure was hidden: ${shown}`);
  });

  it("app_APageOfProseOnly_DoesNothingAtAll", async () => {
    // Arrange — negative case, and the reason the gate exists. A decision record should not
    // prompt anybody about storage, and 0010 keeps it readable and printable with no script
    // having run.
    // Act
    const result = await run(pageBody(null));

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
    const result = await run(pageBody(null), { seed: { "life-compass:restored": "7" } });

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
    const result = await run(pageBody(null), { seed: { "life-compass:restored": "1" } });

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
    const result = await run(pageBody("backup"), { throws: true });

    // Assert — it carried on to the storage attempt rather than stopping at the flag.
    assert.ok(
      result.banner.includes("cannot be saved"),
      `evaluation stopped at the session flag: ${JSON.stringify(result.banner)}`,
    );
  });
});
