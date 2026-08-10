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
 * reason to change: `Reading` is a list of `Block` or a `Refusal`, `Planning` is a `Plan` or a
 * `Refusal`, and every one of them exists to say what the exported functions here return. Splitting them
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
  EXAMPLE_GROUP,
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
  /** Every block in the paste still named the example group, so none of them could be read. */
  | { readonly kind: "example-only" }
  | { readonly kind: "cut-off" }
  | { readonly kind: "repeated-group"; readonly group: string }
  | { readonly kind: "repeated-instance"; readonly group: string }
  | { readonly kind: "unknown-group"; readonly group: string }
  | { readonly kind: "checklist"; readonly group: string }
  | { readonly kind: "newer-version"; readonly group: string; readonly found: number }
  | { readonly kind: "bad-version"; readonly group: string }
  | { readonly kind: "no-answers"; readonly group: string }
  | { readonly kind: "empty-instance"; readonly group: string }
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
      /** How many the page renders — the ceiling. */
      readonly slots: number;
      /** How many are already stored. */
      readonly existing: number;
      /** How many the REPLY asked to add, which is not the same number. */
      readonly adding: number;
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
  | {
      readonly ok: true;
      readonly blocks: readonly Block[];
      /**
       * How many blocks were left out for still naming the example group.
       *
       * Not a refusal and not a detail: it is the difference between "your reply landed" and
       * "three of your four questions landed". The confirmation surface says so, because a
       * missing group is otherwise visible only to a reader who counts the tally.
       */
      readonly skipped: number;
    }
  | { readonly ok: false; readonly refusal: Refusal };

/** One field an import would write, with what is there now. */
export type Change = {
  /** Which question it belongs to, so the review surface can say where a block went. */
  readonly group: string;
  /** What the reader sees this field called. */
  readonly label: string;
  /**
   * Which slot of a repeat this belongs to, counting from 1. Absent for everything else.
   *
   * Display only, and it never touches a key — 0011 and 0013 · O1 both refuse position AS
   * identity, and this is the opposite: the identifier stays the identity, and the reader is
   * shown the number the page already prints beside the slot. Without it a reply rewriting
   * three chapters produces three rows all reading "Title", which are byte-identical when the
   * old values were blank. 0007 · C3 asks the reader to approve each overwrite; approving
   * three things you cannot tell apart is not that.
   */
  readonly slot?: number;
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

/** Every balanced JSON object in the text, and whether one of them ran off the end. */
type Scan = { readonly sources: readonly string[]; readonly truncated: boolean };

/**
 * Find the objects themselves, wherever they sit.
 *
 * 0015 says blocks are "found by their content, not by their fence", and the first version of
 * this read that as "any fence label will do" — asked for ```life-compass an assistant writes
 * ```json, so the info string cannot be relied on. That was the smaller half of the problem.
 * The larger half is that a fence is MARKDOWN SOURCE: copying a rendered chat message gives
 * you the JSON without the backticks, because the backticks were never on screen. The
 * ordinary way a reader copies a reply therefore produced "there is nothing from an assistant
 * in that" — found on a device, on the first real attempt.
 *
 * So this scans for balanced `{…}` regions and lets the fences be whatever they are. Strings
 * are respected, so a brace inside a dictated answer does not throw the count off, and a
 * fenced block is found for free because the backticks sit outside the braces.
 *
 * One pass, linear in the length of the paste.
 */
function scanObjects(text: string): Scan {
  const sources: string[] = [];
  let at = 0;
  while (at < text.length) {
    if (text[at] !== "{") {
      at += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;
    for (let cursor = at; cursor < text.length; cursor += 1) {
      const ch = text[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          sources.push(text.slice(at, cursor + 1));
          at = cursor + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) {
      // Ran to the end of the paste with an object still open. Only worth reporting if it was
      // going to be one of ours — an unclosed brace in prose is not the reader's problem.
      return { sources, truncated: text.slice(at).includes(FORMAT) };
    }
  }
  return { sources, truncated: false };
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
  const scan = scanObjects(text);
  if (scan.truncated) {
    // Refused even when earlier objects parsed. A reply cut off mid-answer cannot be
    // recovered, and reporting success on the part that survived would tell the reader their
    // whole reply arrived.
    return { ok: false, refusal: { kind: "cut-off" } };
  }
  const candidates: Record<string, unknown>[] = [];
  for (const source of scan.sources) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    if (isObject(parsed) && own(parsed, "format") === FORMAT) {
      candidates.push(parsed);
    }
  }
  const blocks: Block[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const parsed of candidates) {
    // The worked example from the prompt, repeated back. 0015 · C8a put a group the schema
    // does not contain into the example precisely so it can never be imported, and refusing
    // the whole paste because an assistant helpfully restated the shape would make a verbose
    // reply unusable. Ignored when there is something real beside it; still refused loudly
    // when it is all there is, which is the mis-paste C8a actually describes.
    //
    // COUNTED rather than merely skipped, since #82 made a prompt ask for one block per
    // question of a numbered item. Every example it shows names this group, so an assistant
    // that substitutes three of four and leaves the fourth produces a paste that imports
    // three questions and drops one — and ignoring it silently told the reader their whole
    // reply had landed. That is the loss 0008 calls the worst available to this application,
    // arriving through the machinery that exists to make a verbose reply usable. The count
    // travels so the confirmation surface can say a block was left out; refusing instead
    // would take the three good answers away with it.
    if (own(parsed, "group") === EXAMPLE_GROUP && candidates.length > 1) {
      skipped += 1;
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
    // Two pastes arrive here and they are indistinguishable from the text alone: the prompt
    // itself, mis-tapped back into the box seconds after copying (0015 · C8a), and a reply
    // that substituted none of the example groups. One sentence has to serve both, so it
    // names what is actually in the paste rather than guessing which happened.
    return { ok: false, refusal: skipped > 0 ? { kind: "example-only" } : { kind: "no-blocks" } };
  }
  return { ok: true, blocks, skipped };
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
      return { ok: false, refusal: { kind: "bad-value", group, field: labelFor(question, group) } };
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
        // reader did not ask for, taken out of the count the page renders. Its own refusal:
        // saying the block "carries no answers" when it carries three sends the reader
        // looking for an empty block that is not there.
        return { ok: false, refusal: { kind: "empty-instance", group } };
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
 * Plan one repeat block's instances against the order that already exists.
 *
 * Separated so the branch that calls it reads as one decision rather than forty lines. It
 * mutates `writes` through `record` and directly, and returns a refusal or nothing — the
 * caller's `try` is what turns a key it cannot build into a refusal.
 */
function planInstances(
  block: Extract<Block, { for: "instances" }>,
  existing: readonly string[],
  record: (group: string, key: string, label: string, after: string, slot?: number) => void,
  writes: Map<string, string>,
): Refusal | null {
  const { group, question } = block;
  // An id naming an instance in THIS group's order answers that instance. Anything else —
  // unknown, another group's, malformed, or absent — is a new instance, and what the block
  // supplied is never written (0015). Minting rather than adopting is what makes a hostile
  // or reused identifier a case that cannot arise rather than one to validate.
  const minted: string[] = [];
  const targets: { readonly target: string; readonly fields: ReadonlyMap<string, string> }[] = [];
  for (const instance of block.instances) {
    if (instance.id !== undefined && existing.includes(instance.id)) {
      targets.push({ target: instance.id, fields: instance.fields });
      continue;
    }
    const fresh = newInstanceId();
    minted.push(fresh);
    targets.push({ target: fresh, fields: instance.fields });
  }

  const slots = ceilingFor(question, existing.length);
  if (existing.length + minted.length > slots) {
    // Refused, not truncated. Truncating is the silent loss this bound exists to prevent —
    // the reader would be told it worked and lose whichever instances fell off the end.
    return { kind: "too-many-instances", group, slots, existing: existing.length, adding: minted.length };
  }

  const finalOrder = [...existing, ...minted];
  for (const { target, fields } of targets) {
    // Counted against the order as it will stand once this is applied, so a new instance is
    // numbered where the reader will find it rather than where it sat in the reply.
    const slot = finalOrder.indexOf(target) + 1;
    for (const [field, value] of fields) {
      record(group, answerKey(group, target, field), labelFor(question, field), value, slot);
    }
  }

  if (minted.length > 0) {
    // New instances append after everything that exists, in the order the block gave them.
    // A block never reorders what is already there — the order is the reader's (0015).
    writes.set(orderKey(group), writeOrder(finalOrder));
  }
  return null;
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
  // Checked here as well as in `readBlocks`, because this function is exported and every one
  // of the four defects above is still latent inside it: each block reads the stored order
  // from `entries`, so two naming one group would each plan from the same starting point and
  // the second's order write would strand the first's answers. `readBlocks` happens to be the
  // only caller today, which is exactly the condition under which a precondition gets
  // forgotten — and the next slice adds the second caller.
  const named = new Set<string>();
  for (const block of blocks) {
    if (named.has(block.group)) {
      return { ok: false, refusal: { kind: "repeated-group", group: block.group } };
    }
    named.add(block.group);
  }

  const writes = new Map<string, string>();
  const changes: Change[] = [];
  const additions: Change[] = [];
  const groups: string[] = [];
  let unchanged = 0;

  const record = (
    group: string,
    key: string,
    label: string,
    after: string,
    slot?: number,
  ): void => {
    const before = entries.get(key) ?? "";
    if (before === after) {
      // Counted rather than written. An assistant echoing back an answer unchanged is the
      // ordinary case when the reader asked it to review what they already had, and a write
      // that changes nothing still costs a transaction and still reads as activity.
      unchanged += 1;
      return;
    }
    writes.set(key, after);
    const change: Change = slot === undefined ? { group, label, before, after } : { group, label, slot, before, after };
    (before === "" ? additions : changes).push(change);
  };

  for (const block of blocks) {
    const { group, question } = block;
    groups.push(group);

    // One guard around EVERY branch, not the repeat one alone. `fieldKey` throwing from the
    // `fields` branch escaped `planFor` entirely — breaking the contract the repeat branch's
    // catch exists to keep, in the branch beside it. keys.ts refuses to build a key from an
    // identifier it will not store, and build/questions.ts records that an interior dot in a
    // field id "passes through unremarked", so a schema edit is the way this is reached.
    let refused: Refusal | null = null;
    try {
      if (block.for === "answer") {
        // A single is stored under the question identifier itself — no field segment.
        record(group, question.id, labelFor(question, question.id), block.answer);
      } else if (block.for === "fields") {
        for (const [field, value] of block.fields) {
          record(group, fieldKey(group, field), labelFor(question, field), value);
        }
      } else {
        const stored = readOrder(entries.get(orderKey(group)));
        // `unreadable` is deliberately not `absent` (0013 · Q3): materialising over an order
        // that merely failed to parse would mint fresh identifiers on top of the reader's
        // answers and orphan every one. Treating it as empty here would do that by another
        // name, so it refuses — and as its own refusal, because a damaged store is not
        // something the reader's assistant can fix.
        if (stored.kind === "unreadable") {
          refused = { kind: "bad-order", group };
        } else {
          const existing = stored.kind === "order" ? stored.instances : [];
          const loose =
            existing.length === 0 &&
            [...entries.keys()].some((key) => key.startsWith(`${group}.`));
          if (loose) {
            // Answers under this group with no order to reference them. Either the store is
            // damaged or `entries` is a filtered view — and both end the same way if this
            // proceeds, because minting a fresh order is what makes those answers unreachable.
            refused = { kind: "orphaned-answers", group };
          } else {
            refused = planInstances(block, existing, record, writes);
          }
        }
      }
    } catch {
      // keys.ts asks callers to treat a refusal-to-make-a-key as something to tell the reader
      // about "rather than letting it escape an input handler (0011 · C6)", and this function
      // is documented as returning a refusal — a throw escaping it becomes an unhandled
      // rejection in a paste handler that had no reason to guard.
      refused = { kind: "cannot-key", group };
    }
    if (refused !== null) {
      return { ok: false, refusal: refused };
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
    case "example-only":
      return `Every block in that still names the example question, which is the placeholder the message you copied asks to be replaced. If that was the message itself, paste your assistant's reply instead; if it was the reply, ask for each question's own name in its block.${UNTOUCHED}`;
    case "cut-off":
      return `That reply looks cut off — an answer starts and never finishes, so the rest of it cannot be read. Copy the whole reply and paste it again.${UNTOUCHED}`;
    case "repeated-group":
      return `That reply answers ${named(refusal.group)} twice, and there is no safe way to choose between them. Ask your assistant to send just the one you want, on its own.${UNTOUCHED}`;
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
    case "empty-instance":
      return `One of the entries for ${named(refusal.group)} carries no answers, so it cannot be added.${UNTOUCHED}`;
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
      return `The answers for ${named(refusal.group)} could not be worked out on this device, so the reply was not applied. Reloading the page may fix it.${UNTOUCHED}`;
    case "too-many-instances":
      return refusal.existing === 0
        ? `That returns ${refusal.adding} entries for ${named(refusal.group)}, and the page has room for ${refusal.slots}. Ask for ${refusal.slots} and paste it again.${UNTOUCHED}`
        : `${named(refusal.group)} already holds ${refusal.existing} of the ${refusal.slots} the page shows, so ${refusal.adding} more cannot be added. Ask your assistant to answer the entries it was given, keeping the ids from the message you copied.${UNTOUCHED}`;
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
