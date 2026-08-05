/**
 * Reading a backup file back in, and replacing what is here with it.
 *
 * This is the destructive half of #25 and the only operation in the application that can
 * take answers away. Everything about its shape follows from that.
 *
 * **Nothing is written until the whole file has been read and accepted** (0009 · C4). A
 * partial import is worse than a refused one: the reader is left with some of the file and
 * some of what was here, no way to tell which is which, and no way back to either.
 *
 * **It replaces rather than merges** (0009 · C7). Merge would have to decide, per key,
 * whether the file or the device wins, and the two are not independent — an instance order
 * and the answers it addresses are one fact spread over several keys (0013). Picking
 * winners key by key can produce a group whose answers sit under identifiers its order does
 * not list, unreachable from the page and invisible to the reader who now believes they
 * merged. Replace has one meaning and it can be said in a sentence.
 *
 * **The reader confirms they hold a backup first** (0009 · C8). An earlier version of that
 * consequence said the import could simply export first and that this cost a function call.
 * It cannot: handing a file over is a synthetic click on an object URL and reports no
 * outcome at all, which is why the export says "Downloading" and not "Saved". An import
 * that trusted it would destroy the store believing a backup had landed. Until something
 * can confirm bytes are on disk, a person looking at their own files is the only thing that
 * actually knows.
 */

import { FORMAT, VERSION, type Envelope } from "./export.ts";
import { readOrder } from "./keys.ts";
import type { Answers } from "./answers.ts";
import type { Store } from "./store.ts";

/**
 * Why a file was refused, in terms a reader can act on.
 *
 * A refusal has to say which of these it is. "Could not import" tells somebody holding the
 * only copy of their own writing nothing about whether the file is wrong, the app is too
 * old, or they picked the wrong thing out of their downloads.
 */
export type Refusal =
  | { readonly kind: "not-json" }
  | { readonly kind: "not-an-envelope" }
  | { readonly kind: "wrong-format"; readonly found: string }
  | { readonly kind: "newer-version"; readonly found: number }
  | { readonly kind: "encrypted"; readonly found: string }
  | { readonly kind: "bad-payload" }
  | { readonly kind: "bad-order"; readonly group: string };

export type Reading =
  | { readonly ok: true; readonly envelope: Envelope }
  | { readonly ok: false; readonly refusal: Refusal };

/** Whether a parsed value is a plain object rather than an array, null, or a primitive. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a file's text as an envelope, or say why not.
 *
 * Every check runs before anything is returned as usable, and this function writes
 * nothing — it cannot, it has no store. That separation is what makes "never partially
 * imports" a property of the design rather than a promise about the order of statements.
 *
 * The version check refuses only what is NEWER. A file from an older envelope version is a
 * problem for the day a second version exists, and 0009's whole point is that the day
 * arrives with an envelope already in the wild to migrate from; refusing the future is the
 * part that has to be right now, because a file this build cannot understand is one it must
 * not guess at.
 */
export function readEnvelope(text: string): Reading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, refusal: { kind: "not-json" } };
  }
  if (!isObject(parsed)) {
    return { ok: false, refusal: { kind: "not-an-envelope" } };
  }
  if (parsed["format"] !== FORMAT) {
    return {
      ok: false,
      refusal: { kind: "wrong-format", found: String(parsed["format"] ?? "nothing") },
    };
  }
  const version = parsed["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, refusal: { kind: "not-an-envelope" } };
  }
  if (version > VERSION) {
    return { ok: false, refusal: { kind: "newer-version", found: version } };
  }
  // No build ever wrote one of these, so it is a damaged or hand-made file rather than an
  // old one. Refusing the future without refusing the impossible would let it through.
  if (version < 1) {
    return { ok: false, refusal: { kind: "not-an-envelope" } };
  }
  // Checked before the payload, and by name rather than by shape: an encrypted file has a
  // payload that will not look like answers, and "this file is encrypted" is a different
  // thing to tell somebody than "this file is damaged" (0009 · C4).
  //
  // A MISSING `encryption` is a malformed envelope, not an encrypted one. Treating absence
  // as encryption told the reader to find a version that could open a file which was simply
  // damaged — the one refusal 0009 · C4 singles out for needing a clear message, firing for
  // the wrong reason.
  const encryption = parsed["encryption"];
  if (typeof encryption !== "string") {
    return { ok: false, refusal: { kind: "not-an-envelope" } };
  }
  if (encryption !== "none") {
    return { ok: false, refusal: { kind: "encrypted", found: encryption } };
  }
  const payload = parsed["payload"];
  if (!isObject(payload)) {
    return { ok: false, refusal: { kind: "bad-payload" } };
  }
  // Every value, not a sample. A single non-string is the difference between a file that
  // restores and one that puts something into storage which `readAll` will later refuse to
  // read back — invisible until the next export drops it.
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (typeof value !== "string") {
      return { ok: false, refusal: { kind: "bad-payload" } };
    }
    // An empty value cannot have come from this application: `write` deletes rather than
    // storing blankness and `replaceAll` skips it, so a file carrying one would be counted
    // to the reader and then not land. Worse if it is an instance order — the order
    // disappears while the answers under it survive, and the next keystroke mints a fresh
    // set over the top, permanently orphaning them, which is what 0013 · Q3 forbids.
    if (value === "") {
      return { ok: false, refusal: { kind: "bad-payload" } };
    }
    // Anything shaped like an instance order is held to the format's own rules. keys.ts
    // calls `writeOrder` "the only path into permanent storage for the format"; a file is a
    // second path, and without this it performs none of the checks — a duplicate or dotted
    // identifier would be stored, and the group would then render blank under a banner
    // telling the reader their earlier answers were untouched.
    //
    // Identified by shape rather than by schema, deliberately: the client has no copy of the
    // question set (0009 · C6), so "is this key a group identifier" is not answerable here.
    // A value that parses as a JSON array is an order or it is nothing; dictated prose is
    // not a JSON array.
    if (value.startsWith("[") && readOrder(value).kind !== "order") {
      return { ok: false, refusal: { kind: "bad-order", group: key } };
    }
  }
  // Kept only if it is genuinely a timestamp. It is shown to the reader as "saved on …"
  // immediately before an irreversible choice, and an unparseable string sliced to ten
  // characters puts garbage there stated as fact.
  const claimed = parsed["exportedAt"];
  const exportedAt =
    typeof claimed === "string" && !Number.isNaN(Date.parse(claimed)) ? claimed : "";
  return {
    ok: true,
    envelope: {
      format: FORMAT,
      version,
      encryption: "none",
      exportedAt,
      payload: payload as Record<string, string>,
    },
  };
}

/** How many answers a file holds, for telling the reader what they are about to trade. */
export function countIn(envelope: Envelope): number {
  return Object.keys(envelope.payload).length;
}

/**
 * Replace everything stored with the file's contents.
 *
 * One call into the store, which does it in a single transaction. Writing key by key would
 * mean a failure halfway leaves a store that is neither what the file said nor what was
 * here, and no record of which keys had already been replaced — the partial import 0009 · C4
 * forbids, arrived at through the back door.
 */
export async function restore(store: Store, envelope: Envelope): Promise<void> {
  await store.replaceAll(new Map(Object.entries(envelope.payload)));
}

/** What a refusal should say to somebody who may be holding their only copy. */
export function explain(refusal: Refusal): string {
  switch (refusal.kind) {
    case "not-json":
      return "That file is not a Life Compass backup — it could not be read as one at all. Nothing on this device has changed.";
    case "not-an-envelope":
      // Reached by a file that is valid JSON but not this shape at all — an array, a
      // number, a bare string. Calling that "damaged" would tell somebody their backup had
      // rotted when they had simply picked the wrong file out of a folder.
      return "That file is not a Life Compass backup — it is some other kind of file. Nothing on this device has changed.";
    case "bad-payload":
      return "That file is a Life Compass backup but its contents are damaged, so it was not used. Nothing on this device has changed.";
    case "wrong-format":
      return `That file is not a Life Compass backup — it says it is ${refusal.found}. Nothing on this device has changed.`;
    case "newer-version":
      return "That backup was written by a newer version of Life Compass than this one, so it was not opened. Update, then try again. Nothing on this device has changed.";
    case "encrypted":
      return "That backup is encrypted and this version cannot open it. Nothing on this device has changed.";
    case "bad-order":
      return `That backup describes the “${refusal.group}” section in a way this version cannot use, so it was not opened. Nothing on this device has changed.`;
  }
}

export type RestoreOptions = {
  /** Told why a file was refused. Nothing has been written when this runs. */
  readonly onRefused: (refusal: Refusal) => void;
  /** Told how many answers landed, once they have. Must not throw. */
  readonly onRestored: (count: number) => void;
  /** Told when reading the file or writing the store failed outright. */
  readonly onFailure: (error: unknown) => void;
  /** Save a backup of what is here, offered at the moment of asking (0009 · C8). */
  readonly onBackupFirst: () => void;
  /** Start the page again, so what is on screen is what is now stored. */
  readonly reload: () => void;
};

/**
 * How many of a payload's entries are answers rather than addresses.
 *
 * An instance order is stored under a bare group identifier alongside the answers it
 * addresses (0013), so counting every key called them all answers — and 334 of the 447
 * blanks sit inside repeats, so the number a reader was shown before an irreversible
 * choice was inflated for every real file.
 *
 * Told apart by shape, because the client has no copy of the question set (0009 · C6). A
 * value that parses as an instance order is one; dictated prose is not a JSON array. The
 * same test `readEnvelope` uses to validate them, so the two cannot disagree.
 */
export function countAnswers(envelope: Envelope): number {
  return Object.values(envelope.payload).filter(
    (value) => !(value.startsWith("[") && readOrder(value).kind === "order"),
  ).length;
}

/** `3 answers`, `1 answer` — so the sentence a reader weighs is not "1 answers". */
function tally(count: number): string {
  return `${count} ${count === 1 ? "answer" : "answers"}`;
}

/**
 * Wire the restore control: pick a file, be told what it will cost, then confirm.
 *
 * The confirmation is not a formality. It names the file, states what it holds and what is
 * about to go, offers to back this device up first, and is gated on the reader ticking that
 * they have a copy. 0009 · C8 requires both halves — offer the export AND require the
 * confirmation — because an import cannot verify that an export reached disk: handing a
 * file over is a synthetic click that reports no outcome. A person looking at their own
 * files is the only thing that knows.
 *
 * Every choice starts from nothing. An earlier version left the previous file's state
 * standing while the next one was read, so a reader who changed their mind mid-read could
 * press Replace and get the file they had just rejected, and a tick made for one file
 * silently authorised another. `generation` makes a superseded read unable to land at all.
 *
 * The page is reloaded afterwards rather than the fields being re-populated. Binding
 * restores from the store on load and never writes into a field that already holds
 * something (0001), so after a replace every answer on screen is the old one and the next
 * keystroke would save it back over what was just restored.
 */
export function wireRestore(
  document: Document,
  answers: Answers,
  store: Store,
  options: RestoreOptions,
): void {
  const view = document.defaultView;
  const section = document.getElementById("restore");
  const file = document.getElementById("restore-file");
  const confirm = document.getElementById("restore-confirm");
  const chosen = document.getElementById("restore-chosen");
  const summary = document.getElementById("restore-summary");
  const acknowledge = document.getElementById("restore-ack");
  const backupFirst = document.getElementById("restore-backup-first");
  const go = document.getElementById("restore-go");
  const cancel = document.getElementById("restore-cancel");
  if (
    view === null ||
    section === null ||
    !(file instanceof view.HTMLInputElement) ||
    confirm === null ||
    chosen === null ||
    summary === null ||
    !(acknowledge instanceof view.HTMLInputElement) ||
    backupFirst === null ||
    go === null ||
    cancel === null
  ) {
    // The build emits all of these together, so a missing one means the markup and this
    // module have drifted — and the symptom is a restore control that quietly is not there.
    // Said out loud rather than absorbed, as banner.ts does for its own region.
    console.error("life-compass: the restore control is missing from this page");
    return;
  }
  section.hidden = false;

  /** Reset everything except the picked file, which `change` may be midway through. */
  const standDownKeepingFile = (): void => {
    confirm.hidden = true;
    acknowledge.checked = false;
    go.setAttribute("aria-disabled", "true");
  };

  /** Nothing is pending; the confirmation is put away and cannot be acted on. */
  const standDown = (): void => {
    standDownKeepingFile();
    // Cleared so choosing the same file again still fires `change`, which it otherwise
    // would not — leaving somebody who cancelled unable to pick that file a second time.
    file.value = "";
  };

  let pending: Envelope | undefined;
  /** Bumped on every choice, so a slower earlier read cannot land after a later one. */
  let generation = 0;
  let running = false;

  file.addEventListener("change", () => {
    // Reset FIRST, before anything is read. Leaving the previous confirmation standing
    // while the next file loads is what let a reader replace everything with a file they
    // had visibly rejected.
    pending = undefined;
    standDownKeepingFile();
    const picked = file.files?.[0];
    if (picked === undefined) {
      return;
    }
    const mine = (generation += 1);
    picked
      .text()
      .then(async (text) => {
        const reading = readEnvelope(text);
        if (!reading.ok) {
          options.onRefused(reading.refusal);
          return;
        }
        // Counted at the moment of asking, not at page load: the reader may have written
        // more since, and the number they are shown is the number they are giving up.
        const here = await store.readAll();
        // Checked once, here, immediately before anything is installed — not after each
        // await. Two reads can be in flight, and it is the WRITE that must be gated: an
        // earlier check would let a superseded read pass and then install its envelope
        // behind a confirmation describing the other file. One guard on the last line
        // before the state changes is the whole property, and a second earlier one only
        // makes it look like there are two.
        if (mine !== generation) {
          return;
        }
        pending = reading.envelope;
        chosen.textContent = `From ${picked.name}`;
        const saved = reading.envelope.exportedAt;
        summary.textContent =
          `It holds ${tally(countAnswers(reading.envelope))}` +
          `${saved === "" ? "" : `, saved ${new Date(saved).toLocaleDateString()}`}. ` +
          `Replacing will discard the ${tally(here.size)} on this device.`;
        confirm.hidden = false;
        // Focus moves to the heading of the thing that just appeared, so a screen-reader
        // reader is taken to it and hears what it says. Unhiding a div announces nothing.
        const heading = document.getElementById("restore-confirm-heading");
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
    const envelope = pending;
    pending = undefined;
    running = true;
    go.setAttribute("aria-disabled", "true");
    // Autosave is stopped and drained BEFORE the replace. It debounces 800ms with a 5s
    // ceiling, and `reload()` fires `pagehide`, which app.ts flushes on — so a phrase
    // dictated shortly before pressing Replace was written on TOP of the freshly restored
    // store. The result was neither the file nor what was here: the merge 0009 · C7 forbids,
    // manufactured by the operation chosen because it cannot do that.
    //
    // `stop` after the flush, so nothing queued afterwards can land either. Whatever the
    // reader wrote in the last moments is theirs to keep — it goes to storage first and is
    // then included in the count they are about to see replaced.
    answers
      .flush()
      .then(() => {
        answers.stop();
        return restore(store, envelope);
      })
      .then(() => countAnswers(envelope))
      .catch((error: unknown) => {
        running = false;
        standDown();
        options.onFailure(error);
        return undefined;
      })
      .then((count) => {
        if (count === undefined) {
          return;
        }
        // Outside the chain that reports failure. When this lived inside the `.then`, a
        // throw from either call landed in the `.catch` and told the reader "nothing on
        // this device has changed" AFTER the store had been replaced — the one sentence
        // that must never be false, false exactly when it mattered.
        try {
          options.onRestored(count);
        } catch (error) {
          console.error("life-compass: the restore could not be announced", error);
        }
        options.reload();
      });
  });
}
