/**
 * What the browser will actually promise about these answers, said out loud.
 *
 * 0008 · C5 asks for storage state shown honestly somewhere durable — installed or not,
 * persisted or not, when you last exported — as "one quiet line, not a dashboard". This is
 * that line. It reports; it does not ask for anything. The prompt 0008 · C1 describes is a
 * separate surface with a separate obligation, and mixing them would make a page somebody
 * visits deliberately into a page that nags.
 *
 * The reason it exists at all is 0008's opening: this workbook holds writing that exists
 * nowhere else, so silent eviction is the worst failure available to the project — worse
 * than a crash, because it is unrecoverable and the reader finds out weeks later. An
 * application that cannot prevent that can at least stop being quiet about it.
 *
 * Everything that decides WHAT to say is pure and takes its inputs as values. Only the three
 * questions the browser answers are impure, and each is guarded: `matchMedia` and
 * `navigator.storage` are both absent or throwing somewhere, and a page that cannot report
 * its storage state must still render.
 */

const LAST_BACKUP = "life-compass:last-backup";

/** What is known about these answers surviving. `persisted` is null when nothing will say. */
export type Durability = {
  readonly installed: boolean;
  /**
   * Whether the origin is exempt from eviction.
   *
   * Three states rather than two, because "the browser has not granted it" and "this browser
   * will not tell us" are different facts and 0008 turns on not overstating either. Reporting
   * an unknown as a no would warn about a risk we cannot see, which is the habit 0008's
   * Decision says is expensive to instil.
   */
  readonly persisted: boolean | null;
  readonly lastBackup: Date | null;
};

/**
 * Whether this is running as an installed app.
 *
 * `display-mode: standalone` is the standard signal. `navigator.standalone` is iOS's
 * non-standard one, and iOS is where this matters most: Safari purges storage for origins
 * left unused for seven days (0008), so a reader who added to the home screen there is
 * exactly who needs to know their state.
 */
export function installed(from: Window): boolean {
  try {
    if (from.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
  } catch {
    // A window without matchMedia tells us nothing, which is not the same as "no".
  }
  const legacy = (from.navigator as Navigator & { standalone?: boolean }).standalone;
  return legacy === true;
}

/** Whether the browser has exempted this origin from eviction, or will not say. */
export async function persisted(from: Navigator): Promise<boolean | null> {
  try {
    const storage = from.storage;
    if (storage === undefined || typeof storage.persisted !== "function") {
      return null;
    }
    return await storage.persisted();
  } catch {
    // Reaching `navigator.storage` throws where site data is blocked, the same way
    // `localStorage` does (bridge.ts records that lesson). Unknown, not false.
    return null;
  }
}

/**
 * Ask the browser to exempt this origin from eviction.
 *
 * 0008's amendment of 2026-08-09 is why this exists: `persisted()` reads the state and
 * `persist()` requests it, the record only ever specified the first, and a device duly
 * reported itself **installed and not protected** — because nothing had ever asked.
 * Installation is what makes the request likely to be granted; it is not the request.
 *
 * Returns what the browser decided, or null when it will not say — the same three states
 * `persisted` reports, for the same reason.
 *
 * Callers must NOT await this. Firefox prompts, and a prompt awaited on the load path holds
 * the field binding behind a dialog, which is the dictation surface 0001 makes primary.
 */
export async function requestPersistence(from: Navigator): Promise<boolean | null> {
  try {
    const storage = from.storage;
    if (storage === undefined || typeof storage.persist !== "function") {
      return null;
    }
    return await storage.persist();
  } catch {
    return null;
  }
}

/** When a backup was last saved FROM THIS DEVICE, which is all this can honestly know. */
export function lastBackup(storage: Storage | null): Date | null {
  if (storage === null) {
    return null;
  }
  try {
    const stored = storage.getItem(LAST_BACKUP);
    if (stored === null) {
      return null;
    }
    const when = new Date(stored);
    // A stored value that will not parse is not a date, and showing "Invalid Date" beside a
    // claim about the reader's answers is worse than showing nothing.
    return Number.isNaN(when.getTime()) ? null : when;
  } catch {
    return null;
  }
}

/** Record that a backup was saved. Failure is silent: this is a note, not the backup. */
/**
 * Forget when the last backup was taken.
 *
 * Called when the answers themselves are erased (#63). The date is not a setting and not
 * something the reader chose — it is a fact ABOUT answers, so it outliving them puts a
 * true-looking sentence on the page that removed them: "Last backup saved from this device
 * on <date>", printed by `showDurability` above a store with nothing in it.
 */
export function forgetBackup(storage: Storage | null): void {
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(LAST_BACKUP);
  } catch {
    // Same reason the writer swallows: storage access throws where site data is blocked,
    // and the erase itself has already succeeded.
  }
}

export function recordBackup(storage: Storage | null, when: Date): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(LAST_BACKUP, when.toISOString());
  } catch {
    // A browser that will not store this still let the file download, and telling somebody
    // their backup failed when it did not is the worse error.
  }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A date a reader can read, formatted explicitly rather than by locale.
 *
 * `toLocaleDateString` gives a different string per environment, which makes it untestable
 * without pinning a locale and makes the shipped text depend on something nobody chose.
 */
function on(when: Date): string {
  return `${when.getDate()} ${MONTHS[when.getMonth()] ?? ""} ${when.getFullYear()}`;
}

/**
 * The line itself.
 *
 * Two sentences: what the browser promises, and when a copy last left the device. They are
 * the two halves of 0008 — installation protects against eviction, and export is the only
 * thing that survives both eviction and uninstall (0008 · C3), so a reader who is told the
 * first without the second has been told half of what decides whether their writing lasts.
 *
 * Deliberately not written as advice. This page already carries the button; a line that
 * reported state and then instructed would be the nagging 0008 · C2 rules out.
 */
export function describe(state: Durability): string {
  const where = state.installed ? "Installed on this device" : "Not installed";
  const protection =
    state.persisted === true
      ? `${where}, and this browser has marked these answers as protected from being cleared.`
      : state.persisted === false
        ? `${where}, and this browser has not marked these answers as protected — it can clear them if it runs short of space.`
        : `${where}. This browser will not say whether these answers are protected from being cleared.`;

  const backup =
    state.lastBackup === null
      ? "No backup has been saved from this device."
      : `Last backup saved from this device on ${on(state.lastBackup)}.`;

  return `${protection} ${backup}`;
}

/** Put the line on the page, if the page has somewhere for it. */
export function showDurability(document: Document, state: Durability): void {
  const line = document.getElementById("storage-state");
  if (line === null) {
    return;
  }
  line.textContent = describe(state);
  line.hidden = false;
}
