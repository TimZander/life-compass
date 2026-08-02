/**
 * Where answers live: one IndexedDB object store, keyed by field identifier.
 *
 * The identifiers are the ones frozen in docs/decisions/0011 and rendered into every
 * blank as `data-field`. That is the whole schema — no per-page grouping, no nesting —
 * because a flat key/value map is what survives a worksheet being reordered, and
 * reordering prose is expected while identifiers are not.
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
  /** Every answer, for restoring a page. */
  readAll(): Promise<ReadonlyMap<string, string>>;
  /** One field. Writing an empty string removes it rather than storing blankness. */
  write(field: string, value: string): Promise<void>;
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

function fromDatabase(database: IDBDatabase): Store {
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
        keys.forEach((key, index) => {
          const value = values[index];
          if (typeof key === "string" && typeof value === "string") {
            answers.set(key, value);
          }
        });
        return answers;
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
