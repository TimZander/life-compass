/**
 * Where answers live: one IndexedDB object store, keyed by field identifier.
 *
 * The identifiers are the ones frozen in docs/decisions/0011 and rendered into every
 * blank as `data-field`. A flat key/value map is what survives a worksheet being
 * reordered, and reordering prose is expected while identifiers are not.
 *
 * Repeat groups are covered too, and that is 334 of the 447 blanks. 0011 stored a repeat
 * as one ordered array of instances per group — a shape 0013 supersedes (0011 · C8): the
 * order lives under the group identifier and each answer under its own key, so one field
 * can be saved without rewriting its neighbours. That needs a write which can set a
 * group's instance order and its first answer together, which is what `claim` is for;
 * `src/client/keys.ts` holds the key format itself.
 *
 * IndexedDB rather than localStorage: localStorage is synchronous, so a write blocks the
 * main thread mid-keystroke, which is precisely what docs/decisions/0001 forbids. It also
 * caps at a few megabytes and stores strings only.
 *
 * This file is deliberately thin. Everything with a decision in it lives above the
 * `Store` interface in answers.ts, where it can be tested in Node — there is no
 * IndexedDB here, and a fake of it would only test the fake.
 */

/**
 * The storage contract, small enough to fake in a test and to reimplement if IndexedDB
 * ever needs replacing (an encrypted store is already anticipated — 0009).
 */
export type Store = {
  /** Every answer, for restoring a page — instance orders included. */
  readAll(): Promise<ReadonlyMap<string, string>>;
  /** One field. Writing an empty string removes it rather than storing blankness. */
  write(field: string, value: string): Promise<void>;
  /**
   * Write several keys together, but only if `guard` is still absent.
   *
   * This exists for one job: materialising a repeat group mints identifiers for every slot
   * and stores the order alongside the first answer, and 0013 makes that all-or-nothing.
   * Two tabs both first-writing the same group would otherwise each mint a full set, and
   * whichever order landed second would strand the other tab's answers under identifiers
   * nothing references.
   *
   * The guard is read and the writes are made inside ONE IndexedDB transaction, which is
   * what makes it a real check-and-set rather than a hopeful one. Resolves `true` if the
   * writes landed, `false` if `guard` already had a value — in which case nothing was
   * written and the caller should re-read rather than assume its own identifiers won.
   */
  claim(guard: string, entries: ReadonlyMap<string, string>): Promise<boolean>;
  /**
   * Write several keys together in one transaction, leaving everything else alone.
   *
   * The merging counterpart to `replaceAll`, and it exists for the same reason that one
   * gives: "never partially imports" is a property of the OPERATION or it is not a property
   * at all. Assistant output (0015) touches a handful of keys across one or more groups, and
   * writing them one at a time leaves a window where a failure produces a store that is
   * neither what the reader had nor what they accepted — with nothing recording how far it
   * got. That is the same window `replaceAll` was written to close, arriving by the merge
   * path instead of the restore path.
   *
   * Unlike `claim` there is no guard: this is a deliberate act on answers the reader has just
   * been shown and confirmed, not a first-write race between tabs. Unlike `replaceAll` it
   * clears nothing, because assistant output is partial by construction and 0007 · C3 forbids
   * an absent field from removing a stored one.
   *
   * What that leaves open, deliberately and worth knowing: the plan is built from a `readAll`
   * and applied here, so an answer written in another tab between the two is overwritten
   * without having appeared in what the reader agreed to. `claim` exists because that gap is
   * real in this app. The trade is that the alternative — re-reading and re-planning inside
   * the transaction — would show the reader one set of changes and apply another, which is
   * the same guarantee broken from the other end. The honest reading of 0007 · C3 here is "no
   * overwrite the app knew about when it asked", and a second tab editing the same question
   * mid-confirmation is not a case the preview can speak for.
   */
  merge(entries: ReadonlyMap<string, string>): Promise<void>;
  /**
   * Discard everything stored and put `entries` in its place, all in one transaction.
   *
   * The destructive half of #25. An import replaces rather than merges (0009 · C7), and
   * "never partially imports" (0009 · C4) is a property of THIS operation or it is not a
   * property at all: clearing and then writing key by key leaves a window where a failure
   * produces a store that is neither the file nor what was there, with nothing recording
   * how far it got. One transaction means the reader ends up with exactly one of the two.
   *
   * Nothing else may use this. It is the only call in the application that can take a
   * reader's answers away, and it is the reason the import asks them to confirm they hold
   * a backup first.
   */
  replaceAll(entries: ReadonlyMap<string, string>): Promise<void>;
};

const DATABASE = "life-compass";
const STORE = "answers";
const VERSION = 1;

/** Promisify a request, which is the only shape IndexedDB offers. */
function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Open the database, creating the object store on first use.
 *
 * Rejects rather than returning a null store: the caller decides what a reader is told,
 * and the honest answer differs by cause. Private browsing and disabled storage both
 * land here, and 0008 makes that a thing the app has to say out loud rather than absorb.
 */
export function openStore(): Promise<Store> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        // No keyPath: the key is the field identifier, passed in explicitly. An inline
        // key would put the identifier inside the value and make the two able to disagree.
        database.createObjectStore(STORE);
      }
    };

    // Fired when another tab holds an open connection to an older version. Without a
    // handler this hangs forever with no error, which reads to the reader as a page that
    // simply never loads their answers.
    let abandoned = false;
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("another tab is holding the database open"));
    };

    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));

    request.onsuccess = () => {
      const database = request.result;
      // A blocked open can still succeed later, once the other tab closes. Resolving is a
      // no-op by then, so without this the connection stays open forever — and an open
      // connection is what blocks the NEXT upgrade, which is the failure just reported.
      if (abandoned) {
        database.close();
        return;
      }
      // Closes this connection when another tab wants to upgrade the schema. Without it,
      // a future version bump waits on every tab still holding this one, which is a hang
      // rather than an error and cannot be fixed from the tab doing the waiting.
      database.onversionchange = () => database.close();
      resolve(fromDatabase(database));
    };
  });
}

/**
 * The Store over an open database.
 *
 * Exported for tests: the request-to-promise plumbing needs a real IndexedDB, but the
 * decisions layered on top of it — pairing keys to values, refusing to store blankness,
 * surfacing what cannot be read — are this file's own, and a handful of fake requests is
 * enough to hold them still.
 */
export function fromDatabase(database: IDBDatabase): Store {
  /**
   * Run one transaction to completion.
   *
   * `run` must issue every request it needs before awaiting anything that is not an
   * IndexedDB request. A transaction commits as soon as the event loop turns with none
   * outstanding, so awaiting a fetch or a timer in the middle silently closes it and the
   * next request throws `TransactionInactiveError`.
   */
  function transact<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const transaction = database.transaction(STORE, mode);
    // The request resolving is not the write landing. A transaction can still abort —
    // on quota, most importantly — after every request inside it has succeeded, so the
    // caller has to wait for the transaction as well as for the requests.
    const landed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("transaction failed"));
    });
    // Both awaited together, and both attached to now. Awaiting the requests first left
    // a turn where a rejected request had no handler, which surfaces as an unhandled
    // rejection rather than as the error the caller is about to be given.
    return Promise.all([run(transaction.objectStore(STORE)), landed]).then(([value]) => value);
  }

  return {
    async readAll() {
      return transact("readonly", async (store) => {
        // Both requests are issued before either is awaited, so they share this
        // transaction. Pairing them by index is safe because IndexedDB returns both in
        // key order — the nth key belongs to the nth value by definition, not by luck.
        const [keys, values] = await Promise.all([
          settled(store.getAllKeys()),
          settled(store.getAll()),
        ]);
        const answers = new Map<string, string>();
        const unreadable: string[] = [];
        keys.forEach((key, index) => {
          const value = values[index];
          if (typeof key === "string" && typeof value === "string") {
            answers.set(key, value);
            return;
          }
          // Not dropped quietly. 0011 requires an orphan to be retained AND surfaced, and
          // an entry this cannot read is still occupying its key — invisible here would
          // mean invisible in an export too, which is the failure that record names.
          unreadable.push(String(key));
        });
        if (unreadable.length > 0) {
          console.warn("life-compass: stored answers this version cannot read", unreadable);
        }
        return answers;
      });
    },

    async claim(guard, entries) {
      return transact("readwrite", async (store) => {
        // Read inside the transaction. Reading first and writing after would be two
        // transactions with a gap between them, which is exactly the window another tab
        // materialises in.
        const existing = await settled(store.get(guard));
        if (existing !== undefined) {
          return false;
        }
        for (const [key, value] of entries) {
          // Requests are issued without awaiting between them, so they all belong to this
          // transaction — see the note on `transact`. An empty value is still an absent
          // answer, so it deletes rather than storing blankness.
          if (value === "") {
            store.delete(key);
          } else {
            store.put(value, key);
          }
        }
        return true;
      });
    },

    async merge(entries) {
      await transact("readwrite", async (store) => {
        for (const [key, value] of entries) {
          // Same rule as everywhere else: an empty value is an absent answer, not an empty
          // one. Nothing should reach here carrying one — 0015 refuses empty values in a
          // block precisely so an assistant cannot express a delete through a format that
          // says it has none — so this is the second line of that defence rather than the
          // first, and it deletes rather than storing blankness if it is ever wrong.
          if (value === "") {
            store.delete(key);
          } else {
            store.put(value, key);
          }
        }
      });
    },

    async replaceAll(entries) {
      await transact("readwrite", async (store) => {
        // Issued without awaiting between them, so they plainly all belong to this
        // transaction — the same rule `claim` relies on, and the note on `transact`
        // explains it. Awaiting the clear first would also work, because a request's
        // continuation runs while the transaction is still active, but that leans on a
        // subtler rule for nothing: there is no reason to read the clear's result.
        store.clear();
        for (const [key, value] of entries) {
          // An empty value is an absent answer, not a blank one, exactly as `write` has it.
          // A file carrying "" would otherwise restore a store that claims every blank was
          // answered.
          if (value !== "") {
            store.put(value, key);
          }
        }
      });
    },

    async write(field, value) {
      await transact("readwrite", async (store) => {
        // An empty field is an absent answer, not an empty one. Storing "" would make an
        // export claim the reader answered every blank on the page.
        if (value === "") {
          await settled(store.delete(field));
        } else {
          await settled(store.put(value, field));
        }
      });
    },
  };
}
