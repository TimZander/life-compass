/**
 * Reading an assistant's reply, and working out what it would change.
 *
 * The shape is `import.ts`'s, for the reason that file gives: the function that validates
 * holds no store, so a refusal cannot reach storage because it has nothing to reach it with.
 * "Never partially imports" stays a property of the design rather than a promise about the
 * order of statements.
 *
 * Split in two, because the two halves answer different questions and fail for different
 * reasons. `readBlocks` asks whether the text says something this application understands —
 * every check it makes is against the schema. `planFor` asks what that would do to what is
 * already stored, which needs the store's current contents and produces the numbers the
 * reader is shown before anything is written (0007 · C3).
 *
 * Nothing here writes. `planFor` returns the writes; a caller passes them to `store.merge`
 * once the reader has said yes.
 *
 * A paste may hold several blocks — 0015 · C1 makes a whole day an ordinary use of version 1.
 * The first version of this file read each block as if it were alone, which was wrong in four
 * ways at once and all of them silent: two blocks naming one group each recomputed the stored
 * instance order from the ORIGINAL store, so the second overwrote the first and left its
 * answers under identifiers nothing referenced; the slot ceiling was applied per block rather
 * than per paste, so repetition walked straight through it; and any key written twice made
 * `changes` disagree with `writes`, so the reader was shown an overwrite that never happened
 * and one of their answers vanished. A group named twice in one paste is two different
 * answers to one question, which is not a choice this can make on the reader's behalf — the
 * same reasoning `several-shapes` already applies within a block — so it is refused, and that
 * makes the per-block bound the per-paste bound.
 *
 * ---
 *
 * Three of the team standards are C# idioms, and a review reads them literally against this
 * tier. The deviation is recorded here so it is decided once rather than re-argued.
 *
 * "Only one type per file" is a rule about C# classes. The types below are one unit with one
 * reason to change: `Reading` is `Block` or `Refusal`, `Planning` is `Plan` or `Refusal`, and
 * every one of them exists to say what the two functions in this file return. Splitting them
 * leaves a types-only module that cannot be reviewed against the code it describes, which is
 * the opposite of what the rule is for. `src/questions/types.ts` already takes this reading.
 *
 * "Do not use type aliases unless absolutely necessary" refers to C#'s `using X = Y;`, a
 * second name for a type that already exists. TypeScript's `type` is a different thing
 * wearing the same word, and for a discriminated union it is the only expression the language
 * has — `Refusal` being one is what makes `explain` exhaustive at compile time rather than at
 * the moment a reader meets a blank message.
 *
 * "Use `x` for simple lambda expressions" is the one that could be followed and is not: every
 * other module in this tier names the parameter for what it is, and one file spelling it
 * differently costs more than the rule gains.
 */

import type { RepeatQuestion } from "../questions/types.ts";
import { answerKey, fieldKey, newInstanceId, orderKey, readOrder, writeOrder } from "./keys.ts";
import {
  FORMAT,
  VERSION,
  findQuestion,
  labelFor,
  renderedSlots,
  type Answerable,
} from "./prompt.ts";

/**
 * Why a paste, or a block inside it, was refused.
 *
 * Named per block wherever a block is at fault, because a day's reply is several blocks and
 * "the paste is wrong" would leave the reader hunting through a page of an assistant's prose
 * for which part of it. 0015 · C6 lists the cases this has to cover; `bad-order`,
 * `orphaned-answers` and `cannot-key` are not on that list because they are not faults in the
 * block at all — they are the device saying it cannot do this right now, and telling the
 * reader to fix their paste would send them after a problem no reply can solve.
 */
export type Refusal =
  | { readonly kind: "no-blocks" }
  | { readonly kind: "unterminated-fence" }
  | { readonly kind: "repeated-group"; readonly group: string }
  | { readonly kind: "repeated-instance"; readonly group: string }
  | { readonly kind: "unknown-group"; readonly group: string }
  | { readonly kind: "checklist"; readonly group: string }
  | { readonly kind: "newer-version"; readonly group: string; readonly found: number }
  | { readonly kind: "bad-version"; readonly group: string }
  | { readonly kind: "no-answers"; readonly group: string }
  | { readonly kind: "several-shapes"; readonly group: string }
  | { readonly kind: "wrong-shape"; readonly group: string; readonly expected: string }
  | { readonly kind: "bad-value"; readonly group: string; readonly field: string }
  | { readonly kind: "unknown-field"; readonly group: string; readonly field: string }
  | { readonly kind: "bad-order"; readonly group: string }
  | { readonly kind: "orphaned-answers"; readonly group: string }
  | { readonly kind: "cannot-key"; readonly group: string }
  | {
      readonly kind: "too-many-instances";
      readonly group: string;
      readonly slots: number;
      readonly found: number;
    };

/** One instance an assistant answered. `id` is what it claimed, and is never written. */
export type BlockInstance = {
  readonly id: string | undefined;
  readonly fields: ReadonlyMap<string, string>;
};

/**
 * One question group's answers, validated against the schema and nothing else.
 *
 * A union rather than three optional keys, discriminated the way the question is — the
 * argument `prompt.ts` makes for `Prior`, which this contradicted: three optional keys is
 * precisely a type that can carry more than one shape, while `readBlock` spends a
 * `several-shapes` refusal rejecting that very value. Making the type say what the refusal
 * says also removes an unreachable branch, an unreachable half of a guard, and a cast.
 */
export type Block =
  | { readonly for: "answer"; readonly group: string; readonly question: Answerable; readonly answer: string }
  | {
      readonly for: "fields";
      readonly group: string;
      readonly question: Answerable;
      readonly fields: ReadonlyMap<string, string>;
    }
  | {
      readonly for: "instances";
      readonly group: string;
      readonly question: RepeatQuestion;
      readonly instances: readonly BlockInstance[];
    };

export type Reading =
  | { readonly ok: true; readonly blocks: readonly Block[] }
  | { readonly ok: false; readonly refusal: Refusal };

/** One field an import would write, with what is there now. */
export type Change = {
  /** Which question it belongs to, so the review surface can say where a block went. */
  readonly group: string;
  /** What the reader sees this field called. */
  readonly label: string;
  /** Empty when nothing is stored — an addition rather than an overwrite. */
  readonly before: string;
  readonly after: string;
};

export type Plan = {
  /**
   * Every key to write, ready for `store.merge`.
   *
   * Instance orders are in here too, so `writes.size` is NOT an answer count — `import.ts`
   * keeps `countStored` for the same reason, noting that an order "is an address, not
   * something the reader wrote, and counting it would inflate the number shown before an
   * irreversible action". The count to show a reader is `changes.length + additions.length`.
   */
  readonly writes: ReadonlyMap<string, string>;
  /** Fields that would replace something the reader wrote. These are what needs review. */
  readonly changes: readonly Change[];
  /** Fields with nothing stored under them yet. */
  readonly additions: readonly Change[];
  /** Fields the block repeats back identically, which are neither. */
  readonly unchanged: number;
  /** The groups touched, in the order the blocks appeared, so the reader is told where. */
  readonly groups: readonly string[];
};

export type Planning =
  | { readonly ok: true; readonly plan: Plan }
  | { readonly ok: false; readonly refusal: Refusal };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property only. Nothing here should ever resolve through the prototype chain. */
function own(from: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(from, key) ? from[key] : undefined;
}

/** Every fenced block in the text, and whether one of them never closed. */
type Scan = { readonly bodies: readonly string[]; readonly unterminated: boolean };

/**
 * Scan the text for fenced blocks, line by line.
 *
 * Found by content rather than by fence label (0015): asked for ```life-compass an assistant
 * writes ```json, so requiring an info string would be requiring them to be reliable about
 * something they demonstrably are not.
 *
 * A line scanner rather than one regex over the whole paste, after the regex turned out to be
 * wrong in three ways. It silently swallowed every block AFTER an unterminated fence — the
 * lazy body ran on to pair with some later block's closing fence — so a truncated streamed
 * reply returned `ok` having quietly dropped half of it, which is the silence 0015 forbids
 * with a partial success in front of it. It was quadratic on unmatched fences: a 1 MB paste
 * froze the main thread for six seconds, on the device where 0001 makes responsiveness the
 * point. And its comment claimed longer closing fences let a nested example survive, which was
 * false — that case returned no blocks at all.
 *
 * Closing requires the same character, at least the opening length, and nothing else on the
 * line, so a four-backtick wrapper really does carry a three-backtick block through. Tildes
 * are accepted because CommonMark allows them and assistants occasionally emit them.
 */
function scanFences(text: string): Scan {
  const bodies: string[] = [];
  let fence: string | null = null;
  let body: string[] = [];
  // Splitting on both handles a paste from a Windows clipboard without a second code path.
  for (const line of text.split(/\r?\n/)) {
    const marks = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    const run = marks?.[1];
    const rest = marks?.[2] ?? "";
    if (fence === null) {
      // An info string containing the fence character is not an opener — that is a run of
      // inline code, not a block.
      if (run !== undefined && !rest.includes(run[0] ?? "")) {
        fence = run;
        body = [];
      }
      continue;
    }
    const closes =
      run !== undefined && run[0] === fence[0] && run.length >= fence.length && rest.trim() === "";
    if (closes) {
      bodies.push(body.join("\n"));
      fence = null;
      continue;
    }
    body.push(line);
  }
  return { bodies, unterminated: fence !== null };
}

/** A field map, or the refusal that stopped it. Shared by every shape that carries fields. */
function fieldsFrom(
  group: string,
  allowed: readonly { readonly id: string }[],
  raw: unknown,
  expected: string,
): { readonly fields: ReadonlyMap<string, string> } | { readonly refusal: Refusal } {
  if (!isObject(raw)) {
    return { refusal: { kind: "wrong-shape", group, expected } };
  }
  const fields = new Map<string, string>();
  for (const name of Object.keys(raw)) {
    if (!allowed.some((one) => one.id === name)) {
      // Not ignored. Keys the CONTRACT does not name are ignored so a later version is cheap
      // to add (0015), but a field identifier this group does not have is a different thing:
      // it is an assistant answering a question that does not exist, and silently dropping it
      // loses words the reader believes travelled.
      return { refusal: { kind: "unknown-field", group, field: name } };
    }
    const value = own(raw, name);
    // Every value, not a sample — `import.ts`'s reason, and 0015 repeats it: one good value
    // proves nothing about the rest. An empty string is refused rather than stored, because
    // `store.ts` deletes on empty, which would hand an assistant a delete primitive through a
    // format that says it has none.
    if (typeof value !== "string" || value === "") {
      return { refusal: { kind: "bad-value", group, field: name } };
    }
    fields.set(name, value);
  }
  return { fields };
}

/**
 * Read pasted text as assistant output, or say why not.
 *
 * Anything that is not a matching block is ignored — assistants quote, illustrate and
 * explain, and a fence that will not parse is ordinary noise. A paste yielding NO matching
 * block is refused rather than reported as success, which is the silence 0015 forbids.
 *
 * A block that matches the format and is then malformed refuses the whole paste rather than
 * being skipped. Partial acceptance would mean telling the reader some of their reply landed
 * and leaving them to work out which, and `import.ts` already establishes all-or-nothing as
 * the property this application keeps.
 */
export function readBlocks(text: string): Reading {
  const scan = scanFences(text);
  if (scan.unterminated) {
    // Refused even when earlier blocks parsed. Everything after the unclosed fence was
    // consumed as its body, so those blocks cannot be recovered — and reporting success on
    // the ones that survived would tell the reader their whole reply arrived.
    return { ok: false, refusal: { kind: "unterminated-fence" } };
  }
  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const source of scan.bodies) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    if (!isObject(parsed) || own(parsed, "format") !== FORMAT) {
      continue;
    }
    const read = readBlock(parsed);
    if (!read.ok) {
      return { ok: false, refusal: read.refusal };
    }
    // Two answers to one question, with nothing to choose between them. Left to run, the
    // second block's writes silently replaced the first's and, for a repeat, stranded its
    // answers under identifiers the order no longer listed.
    if (seen.has(read.block.group)) {
      return { ok: false, refusal: { kind: "repeated-group", group: read.block.group } };
    }
    seen.add(read.block.group);
    blocks.push(read.block);
  }
  if (blocks.length === 0) {
    return { ok: false, refusal: { kind: "no-blocks" } };
  }
  return { ok: true, blocks };
}

/** One parsed object known to carry the right `format`. */
function readBlock(
  parsed: Record<string, unknown>,
): { ok: true; block: Block } | { ok: false; refusal: Refusal } {
  const named = own(parsed, "group");
  const group = typeof named === "string" ? named : "";
  const version = own(parsed, "version");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    // The impossible refused alongside the future, for `readEnvelope`'s stated reason:
    // refusing one without the other lets the other through.
    return { ok: false, refusal: { kind: "bad-version", group } };
  }
  if (version > VERSION) {
    return { ok: false, refusal: { kind: "newer-version", group, found: version } };
  }
  const question = findQuestion(group);
  if (question === undefined) {
    // Named, not merely refused. A frozen identifier (0011) that this build does not have is
    // either a typo an assistant introduced or a question retired since — and those are
    // different problems for the reader.
    return { ok: false, refusal: { kind: "unknown-group", group } };
  }
  if (question.kind === "checklist") {
    // 0015 keeps these out of the contract: they are readiness ticks the reader works
    // through, not questions an assistant answers on their behalf.
    return { ok: false, refusal: { kind: "checklist", group } };
  }

  const carried = ["answer", "fields", "instances"].filter(
    (name) => own(parsed, name) !== undefined,
  );
  if (carried.length === 0) {
    return { ok: false, refusal: { kind: "no-answers", group } };
  }
  if (carried.length > 1) {
    // Which one to believe is not a question with a defensible answer, and guessing at it is
    // how an assistant's stray key becomes the reader's stored words.
    return { ok: false, refusal: { kind: "several-shapes", group } };
  }

  // The block does not restate the kind (0015) — `schema.ts` already says it, and two copies
  // of one fact can disagree. The shape is checked against the group's kind instead.
  if (question.kind === "single") {
    const answer = own(parsed, "answer");
    if (answer === undefined) {
      return { ok: false, refusal: { kind: "wrong-shape", group, expected: "answer" } };
    }
    if (typeof answer !== "string" || answer === "") {
      // The empty string especially: `store.ts` deletes on empty, so accepting one here is
      // the delete primitive 0015 says the format does not have.
      return { ok: false, refusal: { kind: "bad-value", group, field: group } };
    }
    return { ok: true, block: { for: "answer", group, question, answer } };
  }

  if (question.kind === "repeat") {
    const instances = own(parsed, "instances");
    if (!Array.isArray(instances)) {
      return { ok: false, refusal: { kind: "wrong-shape", group, expected: "instances" } };
    }
    const read: BlockInstance[] = [];
    const claimed = new Set<string>();
    for (const entry of instances) {
      if (!isObject(entry)) {
        return { ok: false, refusal: { kind: "wrong-shape", group, expected: "instances" } };
      }
      const made = fieldsFrom(group, question.fields, own(entry, "fields"), "instances");
      if ("refusal" in made) {
        return { ok: false, refusal: made.refusal };
      }
      if (made.fields.size === 0) {
        // An entry answering nothing would mint an instance holding no words — a slot the
        // reader did not ask for, taken out of the count the page renders.
        return { ok: false, refusal: { kind: "no-answers", group } };
      }
      const id = own(entry, "id");
      const named = typeof id === "string" ? id : undefined;
      if (named !== undefined) {
        // Two entries claiming one instance is the same contradiction as two blocks claiming
        // one group. Left to run, the later entry's answers replaced the earlier's in the
        // writes while BOTH were listed to the reader as changes they were agreeing to.
        if (claimed.has(named)) {
          return { ok: false, refusal: { kind: "repeated-instance", group } };
        }
        claimed.add(named);
      }
      read.push({ id: named, fields: made.fields });
    }
    if (read.length === 0) {
      return { ok: false, refusal: { kind: "no-answers", group } };
    }
    return { ok: true, block: { for: "instances", group, question, instances: read } };
  }

  // `group` and `sentence`. A sentence's field identifiers are its gap names, so both read the
  // same way and the schema is the only thing that says which names are legal.
  const made = fieldsFrom(group, question.fields, own(parsed, "fields"), "fields");
  if ("refusal" in made) {
    return { ok: false, refusal: made.refusal };
  }
  if (made.fields.size === 0) {
    return { ok: false, refusal: { kind: "no-answers", group } };
  }
  return { ok: true, block: { for: "fields", group, question, fields: made.fields } };
}

/**
 * How many instances the page renders for a repeat — the ceiling on new ones (0015).
 *
 * `renderedSlots` is `prompt.ts`'s, imported rather than restated: the outbound half asks an
 * assistant for that many and this refuses more than that many, so two copies would let the
 * prompt ask for a count the reader is then refused. #74 changes it in one place.
 *
 * A stored order longer than the rendered count — which 0013 · Q2 says is accepted without
 * comment — raises the floor rather than the ceiling: those instances exist, so they are not
 * evidence that more may be added.
 */
function ceilingFor(question: RepeatQuestion, existing: number): number {
  return Math.max(renderedSlots(question), existing);
}

/**
 * Work out what a set of blocks would change, against what is stored now.
 *
 * Writes nothing and is given no store — only the entries. The numbers it returns are what
 * 0007 · C3 requires the reader to see before an overwrite, and returning them from the same
 * pass that builds the writes is what stops the preview and the write disagreeing.
 *
 * `entries` must be the WHOLE store, not a filtered view of it. A subset keyed to one group
 * looks like an obvious economy and is catastrophic: with the instance order filtered out, an
 * echoed identifier stops matching, a fresh instance is minted in its place, and the order
 * this writes replaces the reader's — orphaning every chapter they had while reporting no
 * changes at all. `readAll` returns the whole store and that is what belongs here; the guard
 * below catches the commonest way of getting it wrong, and cannot catch all of them.
 */
export function planFor(blocks: readonly Block[], entries: ReadonlyMap<string, string>): Planning {
  const writes = new Map<string, string>();
  const changes: Change[] = [];
  const additions: Change[] = [];
  const groups: string[] = [];
  let unchanged = 0;

  const record = (group: string, key: string, label: string, after: string): void => {
    const before = entries.get(key) ?? "";
    if (before === after) {
      // Counted rather than written. An assistant echoing back an answer unchanged is the
      // ordinary case when the reader asked it to review what they already had, and a write
      // that changes nothing still costs a transaction and still reads as activity.
      unchanged += 1;
      return;
    }
    writes.set(key, after);
    (before === "" ? additions : changes).push({ group, label, before, after });
  };

  for (const block of blocks) {
    const { group, question } = block;
    groups.push(group);

    if (block.for === "answer") {
      // A single is stored under the question identifier itself — no field segment.
      record(group, question.id, labelFor(question, question.id), block.answer);
      continue;
    }

    if (block.for === "fields") {
      for (const [field, value] of block.fields) {
        record(group, fieldKey(group, field), labelFor(question, field), value);
      }
      continue;
    }

    const stored = readOrder(entries.get(orderKey(group)));
    // `unreadable` is deliberately not `absent` (0013 · Q3): materialising over an order that
    // merely failed to parse would mint fresh identifiers on top of the reader's answers and
    // orphan every one of them. Treating it as empty here would do exactly that by another
    // name, so it refuses instead — and as its own refusal, because the reader's storage being
    // damaged is not something their assistant can fix.
    if (stored.kind === "unreadable") {
      return { ok: false, refusal: { kind: "bad-order", group } };
    }
    const existing = stored.kind === "order" ? stored.instances : [];
    if (existing.length === 0 && [...entries.keys()].some((key) => key.startsWith(`${group}.`))) {
      // Answers under this group with no order to reference them. Either the store is damaged
      // or `entries` is a filtered view — and both end the same way if this proceeds, because
      // minting a fresh order here is what makes those answers permanently unreachable.
      return { ok: false, refusal: { kind: "orphaned-answers", group } };
    }

    // An id naming an instance in THIS group's order answers that instance. Anything else —
    // unknown, another group's, malformed, or absent — is a new instance, and what the block
    // supplied is never written (0015). Minting rather than adopting is what makes a hostile
    // or reused identifier a case that cannot arise rather than one to validate.
    const minted: string[] = [];
    const planned: { readonly target: string; readonly fields: ReadonlyMap<string, string> }[] = [];
    try {
      for (const instance of block.instances) {
        if (instance.id !== undefined && existing.includes(instance.id)) {
          planned.push({ target: instance.id, fields: instance.fields });
          continue;
        }
        const fresh = newInstanceId();
        minted.push(fresh);
        planned.push({ target: fresh, fields: instance.fields });
      }

      // `block.question`, not the destructured `question`: destructuring before the
      // discriminant is read widens it back to the union, so the narrowing this branch has
      // already established is lost.
      const slots = ceilingFor(block.question, existing.length);
      if (existing.length + minted.length > slots) {
        // Refused, not truncated. Truncating is the silent loss this bound exists to prevent —
        // the reader would be told it worked and lose whichever instances fell off the end.
        return {
          ok: false,
          refusal: {
            kind: "too-many-instances",
            group,
            slots,
            found: existing.length + minted.length,
          },
        };
      }

      for (const { target, fields } of planned) {
        for (const [field, value] of fields) {
          record(group, answerKey(group, target, field), labelFor(question, field), value);
        }
      }

      if (minted.length > 0) {
        // New instances append after everything that exists, in the order the block gave them.
        // A block never reorders what is already there — the order is the reader's (0015).
        writes.set(orderKey(group), writeOrder([...existing, ...minted]));
      }
    } catch {
      // `newInstanceId` throws where `crypto.randomUUID` is missing, and `answerKey` and
      // `writeOrder` throw on an identifier they will not put in a key. keys.ts asks callers
      // to treat that as "storage is unavailable" and tell the reader "rather than letting it
      // escape an input handler (0011 · C6)" — and this function is documented as returning a
      // refusal, so a throw escaping it would become an unhandled rejection in a paste
      // handler that had no reason to guard.
      return { ok: false, refusal: { kind: "cannot-key", group } };
    }
  }

  return { ok: true, plan: { writes, changes, additions, unchanged, groups } };
}

/**
 * A refusal in terms a reader can act on, and never one that blames them.
 *
 * Every branch ends by saying the device is untouched. 0015 · C6 asks for it, `import.ts` does
 * it in all seven of its branches, and the moment it matters is exactly this one: somebody has
 * just pasted a reply about words they dictated, and the first thing they need to know is that
 * those words are still there.
 */
export function explain(refusal: Refusal): string {
  const UNTOUCHED = " Nothing on this device has changed.";
  switch (refusal.kind) {
    case "no-blocks":
      return `There is nothing from an assistant in that. Copy the whole reply, including the part in a code block, and paste it again.${UNTOUCHED}`;
    case "unterminated-fence":
      return `That reply looks cut off — a code block starts and never finishes, so the rest of it cannot be read. Copy the whole reply and paste it again.${UNTOUCHED}`;
    case "repeated-group":
      return `That reply answers ${named(refusal.group)} twice, and there is no safe way to choose between them. Keep the one you want and paste it again.${UNTOUCHED}`;
    case "repeated-instance":
      return `That reply answers the same entry of ${named(refusal.group)} twice, and there is no safe way to choose between them.${UNTOUCHED}`;
    case "unknown-group":
      return `That answers a question this workbook does not have (${named(refusal.group)}). It may be from a newer version, or the identifier may have been altered.${UNTOUCHED}`;
    case "checklist":
      return `${named(refusal.group)} is a checklist you work through yourself, so answers cannot be imported into it.${UNTOUCHED}`;
    case "newer-version":
      return `That was written for a newer version of the workbook (version ${refusal.found}). Update, then paste it again.${UNTOUCHED}`;
    case "bad-version":
      return `A block for ${named(refusal.group)} does not say which version it is, so it cannot be read safely.${UNTOUCHED}`;
    case "no-answers":
      return `A block for ${named(refusal.group)} carries no answers.${UNTOUCHED}`;
    case "several-shapes":
      return `A block for ${named(refusal.group)} answers in more than one way at once, and there is no safe way to choose between them.${UNTOUCHED}`;
    case "wrong-shape":
      return `A block for ${named(refusal.group)} is not the shape that question takes — it should carry ${refusal.expected}.${UNTOUCHED}`;
    case "unknown-field":
      return `A block for ${named(refusal.group)} answers something that question does not ask (${short(refusal.field)}).${UNTOUCHED}`;
    case "bad-value":
      return `A block for ${named(refusal.group)} has an answer for ${short(refusal.field)} that is not usable text.${UNTOUCHED}`;
    case "bad-order":
      return `The answers already saved for ${named(refusal.group)} cannot be read on this device, so nothing new can be added to them safely. This is not a problem with the reply.${UNTOUCHED}`;
    case "orphaned-answers":
      return `The answers already saved for ${named(refusal.group)} are not in a state this can add to safely. This is not a problem with the reply.${UNTOUCHED}`;
    case "cannot-key":
      return `This browser will not let new answers be saved for ${named(refusal.group)} right now, so the reply was not applied.${UNTOUCHED}`;
    case "too-many-instances":
      return `That returns ${refusal.found} answers for ${named(refusal.group)}, and the page has room for ${refusal.slots}. Ask for ${refusal.slots} and paste it again.${UNTOUCHED}`;
  }
}

/** Longest an assistant-supplied string may be inside a message meant to be read. */
const LONGEST = 60;

/**
 * A string from the block, cut to something a reader can take in.
 *
 * `group` and `field` are raw JSON values out of text an assistant relayed, and the assistant
 * may itself be relaying somebody else's. Uncapped, a 200,000-character `group` produced a
 * 200,128-character banner — not an attack so much as a message nobody can act on, which is
 * the thing every refusal here is trying not to be.
 */
function short(text: string): string {
  return text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text;
}

/** A group in a message, or a stand-in when the block never named one. */
function named(group: string): string {
  return group === "" ? "an unnamed question" : short(group);
}
