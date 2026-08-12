/**
 * Removing every answer from this device, from the page that exists for data.
 *
 * The application's whole proposition is that a values excavation stays on the machine it
 * was written on. Offering no way to act on that was asking to be trusted further than the
 * application had earned (#63): a shared or borrowed device, a work laptop, finishing the
 * workbook and wanting it gone, or simply changing your mind about having written it down.
 * Uninstalling is not the answer — it clears storage on some platforms and not others, and
 * does nothing at all for somebody still using the site in a browser tab.
 *
 * ANSWERS ONLY, and the scope is a decision rather than an omission. The assistant
 * preference in `localStorage` is left alone: it is the only setting there is, it holds
 * nothing personal, and clearing it would make the assistant controls vanish from every
 * worksheet as a side effect of a button about answers. The service worker and its cache
 * hold application assets rather than anything the reader wrote, so removing them would cost
 * offline use and buy no privacy. Both choices are stated on the page, because a reader who
 * presses "erase" and assumes an uninstall happened has been misled by omission.
 *
 * The shape is `wireRestore`'s, deliberately and almost line for line. 0009 · C8 asks for a
 * count taken at the moment of asking, the export offered first, an explicit acknowledgement,
 * and a destructive button held with `aria-disabled` rather than `disabled`. That pattern is
 * already built, already reviewed, and already carries fixes this would otherwise have to
 * rediscover — so the differences here are only the ones the operation forces.
 */

import type { Answers } from "./answers.ts";
import { countStored, tally } from "./import.ts";
import type { Store } from "./store.ts";

export type EraseOptions = {
  /** Told how many answers were removed, once they have been. Must not throw. */
  readonly onErased: (count: number) => void;
  /** Told when clearing the store failed outright. Nothing has been removed when this runs. */
  readonly onFailure: (error: unknown) => void;
  /** Save a copy of what is here, offered at the moment of asking (0009 · C8). */
  readonly onBackupFirst: () => void;
  /** Start the page again, so what is on screen is what is now stored. */
  readonly reload: () => void;
};

/**
 * Wire the erase control: ask, be told what it costs, acknowledge, then confirm.
 *
 * The page is reloaded afterwards for the reason `wireRestore` documents: binding restores
 * from the store on load and never writes into a field that already holds something, so
 * without a reload every erased answer stays on screen — and the reader's next keystroke
 * saves it straight back. An erase that leaves the answers visible has not obviously
 * happened, which for this operation is worse than not offering it.
 */
export function wireErase(
  document: Document,
  answers: Answers,
  store: Store,
  options: EraseOptions,
): void {
  const view = document.defaultView;
  const section = document.getElementById("erase");
  const start = document.getElementById("erase-start");
  const confirm = document.getElementById("erase-confirm");
  const summary = document.getElementById("erase-summary");
  const acknowledge = document.getElementById("erase-ack");
  const backupFirst = document.getElementById("erase-backup-first");
  const go = document.getElementById("erase-go");
  const cancel = document.getElementById("erase-cancel");
  if (
    view === null ||
    section === null ||
    start === null ||
    confirm === null ||
    summary === null ||
    !(acknowledge instanceof view.HTMLInputElement) ||
    backupFirst === null ||
    go === null ||
    cancel === null
  ) {
    // The build emits all of these together, so a missing one means the markup and this
    // module have drifted — and the symptom is a control that quietly is not there, on the
    // one page whose job is being straight about what is on the device.
    console.error("life-compass: the erase control is missing from this page");
    return;
  }
  section.hidden = false;

  /** Nothing is pending; the confirmation is put away and cannot be acted on. */
  const standDown = (): void => {
    confirm.hidden = true;
    acknowledge.checked = false;
    go.setAttribute("aria-disabled", "true");
  };

  /** How many answers the reader was told they were giving up, or absent if not asked. */
  let pending: number | undefined;
  /** Bumped on every ask, so a slower earlier read cannot land after a later one. */
  let generation = 0;
  let running = false;

  start.addEventListener("click", () => {
    // Reset FIRST, before anything is read, so a confirmation from a previous ask cannot
    // stand while the next count loads.
    pending = undefined;
    standDown();
    const mine = (generation += 1);
    store
      .readAll()
      .then((here) => {
        // Checked immediately before the state changes and nowhere earlier. Two reads can
        // be in flight and it is the WRITE — here, showing the number a reader will weigh —
        // that must be gated.
        if (mine !== generation) {
          return;
        }
        const count = countStored(here);
        pending = count;
        // `countStored` rather than a count of its own: import.ts records what it cost to
        // have two counts of one store disagreeing inside a single confirmation, and a
        // reader who exports a backup and then erases must be shown the same figure twice.
        summary.textContent =
          count === 0
            ? "There are no answers saved on this device."
            : `This will remove the ${tally(count)} saved on this device.`;
        confirm.hidden = false;
        // Focus moves to the heading of the thing that just appeared, so a screen-reader
        // reader is taken to it and hears what it says. Unhiding a div announces nothing.
        const heading = document.getElementById("erase-confirm-heading");
        heading?.setAttribute("tabindex", "-1");
        (heading as HTMLElement | null)?.focus();
      })
      .catch((error: unknown) => {
        if (mine === generation) {
          pending = undefined;
          standDown();
          options.onFailure(error);
        }
      });
  });

  acknowledge.addEventListener("change", () => {
    go.setAttribute("aria-disabled", acknowledge.checked ? "false" : "true");
  });

  backupFirst.addEventListener("click", () => options.onBackupFirst());

  cancel.addEventListener("click", () => {
    pending = undefined;
    generation += 1;
    standDown();
  });

  go.addEventListener("click", () => {
    // Every guard, not the visible one. `aria-disabled` does not stop a click the way
    // `disabled` would — deliberately, because a disabled element cannot hold focus and
    // dropping a keyboard reader to the body mid-operation is what export.ts already
    // rejected — so these are what actually make the destructive path unreachable.
    if (pending === undefined || !acknowledge.checked || running) {
      return;
    }
    const count = pending;
    pending = undefined;
    running = true;
    go.setAttribute("aria-disabled", "true");
    // Autosave is stopped and drained BEFORE the store is cleared, for the reason
    // `wireRestore` records: it debounces, and `reload()` fires `pagehide`, which app.ts
    // flushes on. Without this a phrase dictated shortly before pressing Erase is written
    // back on top of the emptied store — leaving one answer on a device the reader has just
    // been told is empty, which is the worst available outcome for this operation.
    answers
      .flush()
      .then(() => {
        answers.stop();
        return store.replaceAll(new Map());
      })
      // The count carried through as the success value, exactly as restore carries its own.
      // `replaceAll` resolves to nothing, so without this the two paths are indistinguishable
      // downstream and a failure would be announced as an erase.
      .then(() => count)
      .catch((error: unknown) => {
        running = false;
        standDown();
        options.onFailure(error);
        return undefined;
      })
      .then((erased) => {
        if (erased === undefined) {
          return;
        }
        // Outside the chain that reports failure, as import.ts had to learn: when the
        // announcement lived inside the `.then`, a throw from it landed in the `.catch` and
        // told the reader nothing had changed AFTER the store had been emptied — the one
        // sentence that must never be false, false exactly when it mattered.
        try {
          options.onErased(erased);
        } catch (error) {
          console.error("life-compass: the erase could not be announced", error);
        }
        options.reload();
      });
  });
}
