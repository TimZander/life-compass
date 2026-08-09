/**
 * Everything the pages load.
 *
 * A module rather than a classic script: browsers resolve the imports natively, so this
 * needs no bundler (docs/decisions/0003), and the site's CSP allows same-origin modules
 * while forbidding anything inline.
 */

import { confirmRecentUpdate, watchForUpdates } from "./sw-update.ts";
import { createAnswers } from "./answers.ts";
import { bindAnswers } from "./fields.ts";
import { needsStore, saveBackup, wireBackup } from "./export.ts";
import { bridgeIsOn, preferences } from "./bridge.ts";
import { installed, lastBackup, persisted, recordBackup, showDurability } from "./durability.ts";

/** Where a just-completed restore leaves its count, to be reported after the reload. */
const RESTORED_KEY = "life-compass:restored";
import { explain, wireRestore } from "./import.ts";
import { openStore, type Store } from "./store.ts";
import { dismissBanner, showBanner } from "./banner.ts";

/**
 * Everything this page does, in one awaitable call.
 *
 * The work used to sit at module scope, which made the only way to observe it "import the
 * module and sleep" — a guess at how long it takes, and the timing-guess pattern that has
 * already produced a flaky test in this project once. Awaiting it is exact, and it also
 * means a test needs no cache-busting import specifier to run a second scenario.
 *
 * Nothing else changes: the module still calls this once on load, and everything inside
 * runs in the order it did.
 */
export async function start(): Promise<void> {
  // Runs before registration, because it reports on the load that already happened rather
  // than on anything the worker is about to do.
  confirmRecentUpdate();
  registerWorker();
  confirmRecentRestore();
  try {
    await bindAnswerFields();
  } catch (error) {
    console.error("life-compass: answers could not be bound to this page", error);
    showBanner({
      id: "storage",
      text: "Your answers cannot be saved on this device. The page still works for printing.",
      actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
    });
  }

  // AFTER the fields are bound, and outside the store path.
  //
  // Outside, because the assistant opt-in needs no answers at all: gating it on `needsStore`
  // put the whole of /agent behind a check for blanks that page does not have, and shipped a
  // page whose only purpose is a switch with the switch still hidden — the mistake this
  // file's own header records about the backup page, made again.
  //
  // After, because the bridge's import pulls the question schema with it, so going first made
  // an opted-in reader wait on some 16 kB gzipped before a single blank became a textarea —
  // the optional feature ahead of the dictation surface 0001 exists for. Still awaited, so
  // what this function has done is done by the time it resolves.
  await wireAssistantBridge();
}

/**
 * Load the assistant bridge, but only for a reader who has something to do with it.
 *
 * A dynamic import, because the bridge reaches the prompt generator and through it the whole
 * question schema — 94 kB raw, 19 kB gzipped. Statically imported, every reader paid that on
 * every page including the 404 and every decision record, to run a feature that is off by
 * default and that most of them will never turn on.
 *
 * Two reasons to load it: the reader has switched it on, or this is the page carrying the
 * switch. `bridge.ts` answers the first without pulling any of it in, which is the whole
 * reason that module exists separately.
 *
 * Outside the store path, like the opt-in it wires. Storage failing and needing to answer by
 * voice are uncorrelated, and 0001 makes the second primary — gating the control on a store
 * that opened would take the only non-typing route through the workbook away from precisely
 * the reader who cannot type.
 */
async function wireAssistantBridge(): Promise<void> {
  const storage = preferences(window);
  const carriesTheSwitch = document.getElementById("agent") !== null;
  if (!carriesTheSwitch && !bridgeIsOn(storage)) {
    return;
  }

  let bridge: typeof import("./agent.ts");
  try {
    // ONLY the import. Wrapping the wiring calls too meant a throw inside either of them was
    // swallowed and reported as a loading failure — which on /agent is a switchless page with
    // a console line blaming the loader, the exact defect this branch has now fixed twice.
    bridge = await import("./agent.ts");
  } catch (error) {
    // Said to the reader, not only to a console they will never open. Every other failure
    // path in this file raises a banner, and for somebody who cannot type comfortably this
    // was the route they came for — a worksheet with no buttons and no explanation is the
    // silence 0008's doctrine exists to forbid.
    console.error("life-compass: the assistant bridge could not be loaded", error);
    showBanner({
      id: "agent",
      text: "The assistant controls could not be loaded. Reloading the page may fix it.",
      actions: [{ label: "Dismiss", onSelect: () => dismissBanner("agent") }],
    });
    return;
  }

  try {
    const { wireAgentPage, wireQuestionControls } = bridge;
    wireAgentPage(document, storage);
    // The store is read when a panel OPENS, not now: a load-time snapshot misses everything
    // dictated this session, and misses the instance order a repeat mints on its first write.
    let opened: Promise<Store> | null = null;
    /** One handle for both halves of the bridge, opened on first use and retried on failure. */
    const store = async (): Promise<Store> => {
      try {
        opened ??= openStore();
        return await opened;
      } catch (error) {
        opened = null;
        throw error;
      }
    };

    // Only where the box exists, and by dynamic import: `paste.ts` pulls in the reader and the
    // planner, and a worksheet page has no use for either. The assistant page is the one place
    // answers come back, so it is the one place that pays for them.
    if (document.getElementById("paste") !== null) {
      void import("./paste.ts")
        .then(({ wirePaste }) => wirePaste(document, storage, store))
        .catch((error: unknown) => {
          console.error("life-compass: the paste box could not be loaded", error);
          showBanner({
            id: "paste",
            text: "The box for bringing answers back could not be loaded. Reloading the page may fix it.",
            actions: [{ label: "Dismiss", onSelect: () => dismissBanner("paste") }],
          });
        });
    }

    wireQuestionControls(document, storage, async () => {
      // Answers are written on a debounce (up to five seconds), so without this a reader who
      // dictates a chapter and taps straight away hands over the value from before their
      // last pause. `flushAnswers` is set once the fields are bound; before that there is
      // nothing pending to flush.
      await flushAnswers?.();
      try {
        return await (await store()).readAll();
      } catch (error) {
        // Dropped so the next read can retry — a rejected promise left in `opened` would cache
        // one bad moment for the rest of the session.
        opened = null;
        // Raised, not swallowed. This returned an empty Map, which the panel cannot tell apart
        // from "nothing written yet": the reader ticked the box, watched the preview not
        // change, and was told nothing. For a repeat it also drops every instance identifier,
        // which 0015 · C3 forbids outright. The panel is the only surface that can say so, so
        // the failure has to reach it.
        throw error;
      }
    });
  } catch (error) {
    // Its own message, distinct from the load failure above. Wrapping these calls in THAT
    // catch is what reported a wiring bug as a loading bug and left /agent switchless with a
    // console line blaming the loader. But leaving them bare — which is how that was fixed —
    // meant a throw here reached nothing at all: `start()` is invoked as `void start()`, so it
    // became an unhandled rejection with no banner and no console line, which is worse than
    // the wrong message it replaced.
    console.error("life-compass: the assistant controls could not be set up", error);
    showBanner({
      id: "agent",
      text: "The assistant controls could not be set up. Reloading the page may fix it.",
      actions: [{ label: "Dismiss", onSelect: () => dismissBanner("agent") }],
    });
  }
}

function registerWorker(): void {
  if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        try {
          watchForUpdates(registration);
        } catch (error) {
          // Separated from the registration failure below: registration succeeding and
          // update-watching throwing are different problems, and one message for both
          // sends whoever reads it to the wrong place.
          console.error("Watching for service worker updates failed:", error);
        }
      })
      .catch((error) => {
        // Survivable — every page still works from the network — but it silently removes
        // offline support and storage durability (0008), so say so rather than swallow it.
        console.error("Service worker registration failed:", error);
      });
  });
}
}

/**
 * Set once the fields are bound, so the assistant panels can settle pending writes before
 * reading. They run outside the store path and hold no reference to the `Answers` instance.
 */
let flushAnswers: (() => Promise<void>) | null = null;

/**
 * Bind the page's blanks to on-device storage.
 *
 * Deliberately not awaited by anything: a page with no blanks, or a browser with storage
 * switched off, still reads and prints exactly as before (0010). Failure is reported once,
 * through the same banner surface as everything else, rather than thrown into the console
 * where a reader would never see it (0008 makes what storage can and cannot promise
 * something the app has to say out loud).
 */
async function bindAnswerFields(): Promise<void> {
  if (!needsStore(document)) {
    return;
  }
  const store = await openStore();
  const answers = createAnswers(store, {
    onFailure: () =>
      showBanner({
        id: "storage",
        text: "Your answers are not being saved on this device right now.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
      }),
    // Without this the failure message outlives the failure: it is raised once and, with
    // nothing to clear it, stays on screen for the rest of the page even after the very
    // next write succeeds. By id, because clearing the whole region would also take down
    // sw-update's "a new version is ready" prompt — including one still queued behind a
    // reader who was mid-sentence.
    onRecovery: () => dismissBanner("storage"),
  });

  // The page-hide path, and the reason `flush` waits for the write rather than starting it.
  // `pagehide` rather than `beforeunload`: mobile browsers freeze a backgrounded tab and
  // may never fire the latter, which is exactly the session a dictating reader has.
  //
  // Registered before `bindAnswers` is awaited, not after: binding reads the whole store,
  // and a reader who backgrounds the tab during that read is the same reader this handler
  // exists for.
  flushAnswers = () => answers.flush();

  window.addEventListener("pagehide", () => {
    void answers.flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void answers.flush();
    }
  });


  // 0008 · C5. Asked for once the store is open, so the line reports what is true rather
  // than what was true at page load, and awaited here rather than raced: `persisted()` is a
  // promise, and a line that appears after the reader has already read the page is a line
  // they will not read.
  const held = preferences(window);
  /** Ask all three questions again and repaint. One function, so no caller can answer a
   *  question it did not ask — passing a placeholder for `persisted` after a backup would
   *  overwrite a known "protected" with "this browser will not say". */
  const refreshDurability = async (): Promise<void> => {
    showDurability(document, {
      installed: installed(window),
      persisted: await persisted(navigator),
      lastBackup: lastBackup(held),
    });
  };
  void refreshDurability();

  wireBackup(document, answers, store, {
    onHandedOver: (filename) => {
      // Recorded when the file is handed to the browser, which is the last moment this code
      // knows anything. `onHandedOver` is deliberately not "saved" — nothing here observes
      // whether the browser accepted it — so the line this feeds says "saved from this
      // device", which is the claim that survives that uncertainty.
      recordBackup(held, new Date());
      void refreshDurability();
      return showBanner({
        id: "backup",
        // "Downloading", not "saved". Nothing here observes whether the browser accepted
        // the file — a synthetic click reports no outcome — and claiming a backup exists
        // when it may not is the one thing 0008 says this app must not get wrong.
        text: `Downloading ${filename}. Check your files — and keep it somewhere you would keep a private notebook.`,
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner("backup") }],
      });
    },
    onFailure: (error: unknown) => {
      console.error("life-compass: the backup could not be saved", error);
      showBanner({
        id: "backup",
        text: "That backup could not be saved. Your answers are still on this device.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner("backup") }],
      });
    },
  });

  // After binding, not before. A restore that landed while binding was still reading the
  // store and materialising groups would race `claim` and the restore loop, both of which
  // write pre-restore state into the replaced store.
  await bindAnswers(document, answers, store, {
    // Says that writing has stopped, not just that reading failed. The earlier wording
    // mentioned only the answers already stored, so a reader could dictate a page of new
    // text into a refused group having been told nothing that applied to it.
    onUnwritable: (_group, reason) =>
      showBanner({
        id: "storage",
        text:
          reason === "unreadable"
            ? "Some answers here could not be read, so this section is not saving. Your earlier answers are untouched."
            : "This section has more blanks than it has saved answers to fill, so the extra ones are not saving. What you answered before is unchanged.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
      }),
    onFailure: (error: unknown) => {
      console.error("life-compass: a group could not be prepared for saving", error);
      showBanner({
        id: "storage",
        text: "Your answers are not being saved on this device right now.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner() }],
      });
    },
  });

  wireRestore(document, answers, store, {
    onRefused: (refusal) =>
      showBanner({
        id: "restore",
        text: explain(refusal),
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner("restore") }],
      }),
    onBackupFirst: () => {
      void saveBackup(answers, store, document, new Date())
        .then((filename) =>
          showBanner({
            id: "restore",
            text: `Downloading ${filename}. Check your files before replacing anything.`,
            actions: [{ label: "Dismiss", onSelect: () => dismissBanner("restore") }],
          }),
        )
        .catch((error: unknown) => {
          console.error("life-compass: the backup could not be saved", error);
          showBanner({
            id: "restore",
            text: "That backup could not be saved, so nothing has been replaced.",
            actions: [{ label: "Dismiss", onSelect: () => dismissBanner("restore") }],
          });
        });
    },
    onRestored: (count) => {
      // Guarded, because storage access throws where site data is blocked — which is a
      // privacy-minded reader, the exact audience here. sw-update.ts wraps the identical
      // call for the identical reason. Losing the confirmation is a small cost; letting a
      // throw escape once cost the reader a message saying nothing had changed after
      // everything had.
      try {
        window.sessionStorage.setItem(RESTORED_KEY, String(count));
      } catch {
        // The restore has already landed. Only the sentence afterwards is lost.
      }
    },
    onFailure: (error: unknown) => {
      console.error("life-compass: the backup could not be restored", error);
      showBanner({
        id: "restore",
        text: "That backup could not be restored. Nothing on this device has changed.",
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner("restore") }],
      });
    },
    reload: () => window.location.reload(),
  });
}

/**
 * Report a restore that happened just before this page loaded.
 *
 * The reload is what makes the screen match the store, and it takes the banner with it —
 * so the one message confirming an irreversible action would be the one message nobody
 * ever sees. Read and cleared immediately, so it is said once rather than on every
 * subsequent load.
 */
function confirmRecentRestore(): void {
  let count: string | null = null;
  // Guarded, and the getter itself can throw. Unguarded at module scope this aborted
  // evaluation before `bindAnswerFields` ran, so a reader whose browser blocks site data
  // got no field binding, no autosave, no controls and no banner explaining any of it —
  // a rare-event confirmation disabling the whole application for the readers most likely
  // to hit it. sw-update.ts guards both halves for the same reason.
  try {
    count = window.sessionStorage.getItem(RESTORED_KEY);
  } catch {
    return;
  }
  if (count === null) {
    return;
  }
  try {
    window.sessionStorage.removeItem(RESTORED_KEY);
  } catch {
    // Said once is the intent; said twice is better than the application not starting.
  }
  showBanner({
    id: "restore",
    text: `Restored ${count} ${count === "1" ? "answer" : "answers"} from your backup.`,
    actions: [{ label: "Dismiss", onSelect: () => dismissBanner("restore") }],
  });
}

void start();
