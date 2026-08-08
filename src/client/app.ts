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
import { wireAgentPage, wireQuestionControls } from "./agent.ts";

/** Where a just-completed restore leaves its count, to be reported after the reload. */
const RESTORED_KEY = "life-compass:restored";
import { explain, wireRestore } from "./import.ts";
import { openStore } from "./store.ts";
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
  window.addEventListener("pagehide", () => {
    void answers.flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void answers.flush();
    }
  });

  // The assistant bridge. Its page carries the opt-in; the worksheets carry the buttons, and
  // only when the reader has turned them on (docs/decisions/0007, #67). The store is read
  // once here and handed over, so a copy control never opens a second read on a page that
  // may be mid-dictation.
  wireAgentPage(document, window.localStorage);
  wireQuestionControls(document, window.localStorage, await store.readAll());

  wireBackup(document, answers, store, {
    onHandedOver: (filename) =>
      showBanner({
        id: "backup",
        // "Downloading", not "saved". Nothing here observes whether the browser accepted
        // the file — a synthetic click reports no outcome — and claiming a backup exists
        // when it may not is the one thing 0008 says this app must not get wrong.
        text: `Downloading ${filename}. Check your files — and keep it somewhere you would keep a private notebook.`,
        actions: [{ label: "Dismiss", onSelect: () => dismissBanner("backup") }],
      }),
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
