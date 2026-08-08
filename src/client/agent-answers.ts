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
 */

import type { Question, RepeatQuestion } from "../questions/types.ts";
import { answerKey, newInstanceId, orderKey, readOrder, writeOrder } from "./keys.ts";
import { FORMAT, VERSION, findQuestion } from "./prompt.ts";

/**
 * Why a paste, or a block inside it, was refused.
 *
 * Named per block wherever a block is at fault, because a day's reply is several blocks and
 * "the paste is wrong" would leave the reader hunting through a page of an assistant's prose
 * for which part of it. 0015 · C6 lists the cases this has to cover.
 */
export type Refusal =
  | { readonly kind: "no-blocks" }
  | { readonly kind: "unknown-group"; readonly group: string }
  | { readonly kind: "checklist"; readonly group: string }
  | { readonly kind: "newer-version"; readonly group: string; readonly found: number }
  | { readonly kind: "bad-version"; readonly group: string }
  | { readonly kind: "no-answers"; readonly group: string }
  | { readonly kind: "several-shapes"; readonly group: string }
  | { readonly kind: "wrong-shape"; readonly group: string; readonly expected: string }
  | { readonly kind: "bad-value"; readonly group: string; readonly field: string }
  | { readonly kind: "unknown-field"; readonly group: string; readonly field: string }
  | {
      readonly kind: "too-many-instances";
      readonly group: string;
      readonly slots: number;
      readonly found: number;
    };

/** One question group's answers, validated against the schema and nothing else. */
export type Block = {
  readonly group: string;
  readonly question: Question;
  /** For a `single`. */
  readonly answer?: string;
  /** For a `group` or a `sentence`, and for each instance of a `repeat`. */
  readonly fields?: ReadonlyMap<string, string>;
  /** For a `repeat`. `id` is what the block claimed, and is never written as a key. */
  readonly instances?: readonly {
    readonly id: string | undefined;
    readonly fields: ReadonlyMap<string, string>;
  }[];
};

export type Reading =
  | { readonly ok: true; readonly blocks: readonly Block[] }
  | { readonly ok: false; readonly refusal: Refusal };

/** One field an import would write, with what is there now. */
export type Change = {
  readonly group: string;
  readonly key: string;
  /** What the reader sees this field called. */
  readonly label: string;
  /** Empty when nothing is stored — an addition rather than an overwrite. */
  readonly before: string;
  readonly after: string;
};

export type Plan = {
  /** Every key to write, instance orders included. Ready for `store.merge`. */
  readonly writes: ReadonlyMap<string, string>;
  /** Fields that would replace something the reader wrote. These are what needs review. */
  readonly changes: readonly Change[];
  /** Fields with nothing stored under them yet. */
  readonly additions: readonly Change[];
  /** Fields the block repeats back identically, which are neither. */
  readonly unchanged: number;
  /** The groups touched, in the order the blocks appeared. */
  readonly groups: readonly string[];
};

export type Planning =
  | { readonly ok: true; readonly plan: Plan }
  | { readonly ok: false; readonly refusal: Refusal };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every fenced block in the text, as raw source.
 *
 * Found by content rather than by fence label (0015): asked for ```life-compass an assistant
 * writes ```json, so requiring an info string would be requiring them to be reliable about
 * something they demonstrably are not. The scan is also what lets several blocks and the
 * prose between them arrive in one paste.
 */
function fencedIn(text: string): string[] {
  // The closing fence must be at least as long as the opening one, which is what lets a block
  // whose content contains ``` survive — an assistant showing the reader a nested example.
  const found: string[] = [];
  const pattern = /^([ \t]*)(`{3,})[^\n]*\n([\s\S]*?)^[ \t]*\2`*[ \t]*$/gm;
  for (const match of text.matchAll(pattern)) {
    const body = match[3];
    if (body !== undefined) {
      found.push(body);
    }
  }
  return found;
}

/** A field map, or the refusal that stopped it. Shared by every shape that carries fields. */
function fieldsFrom(
  group: string,
  allowed: readonly { readonly id: string }[],
  raw: unknown,
): { readonly fields: ReadonlyMap<string, string> } | { readonly refusal: Refusal } {
  if (!isObject(raw)) {
    return { refusal: { kind: "wrong-shape", group, expected: "fields" } };
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
    const value = raw[name];
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
  const blocks: Block[] = [];
  for (const source of fencedIn(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    if (!isObject(parsed) || parsed["format"] !== FORMAT) {
      continue;
    }
    const read = readBlock(parsed);
    if (!read.ok) {
      return read;
    }
    blocks.push(read.blocks[0] as Block);
  }
  if (blocks.length === 0) {
    return { ok: false, refusal: { kind: "no-blocks" } };
  }
  return { ok: true, blocks };
}

/** One parsed object known to carry the right `format`. */
function readBlock(parsed: Record<string, unknown>): Reading {
  const group = typeof parsed["group"] === "string" ? parsed["group"] : "";
  const version = parsed["version"];
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

  const carried = ["answer", "fields", "instances"].filter((name) => parsed[name] !== undefined);
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
    const answer = parsed["answer"];
    if (typeof answer !== "string" || answer === "") {
      return {
        ok: false,
        refusal:
          parsed["answer"] === undefined
            ? { kind: "wrong-shape", group, expected: "answer" }
            : { kind: "bad-value", group, field: group },
      };
    }
    return { ok: true, blocks: [{ group, question, answer }] };
  }

  if (question.kind === "repeat") {
    const instances = parsed["instances"];
    if (!Array.isArray(instances)) {
      return { ok: false, refusal: { kind: "wrong-shape", group, expected: "instances" } };
    }
    const read: { id: string | undefined; fields: ReadonlyMap<string, string> }[] = [];
    for (const entry of instances) {
      if (!isObject(entry)) {
        return { ok: false, refusal: { kind: "wrong-shape", group, expected: "instances" } };
      }
      const made = fieldsFrom(group, question.fields, entry["fields"]);
      if ("refusal" in made) {
        return { ok: false, refusal: made.refusal };
      }
      if (made.fields.size === 0) {
        // An entry answering nothing would mint an instance holding no words — a slot the
        // reader did not ask for, taken out of the count the page renders.
        return { ok: false, refusal: { kind: "no-answers", group } };
      }
      const id = entry["id"];
      read.push({ id: typeof id === "string" ? id : undefined, fields: made.fields });
    }
    if (read.length === 0) {
      return { ok: false, refusal: { kind: "no-answers", group } };
    }
    return { ok: true, blocks: [{ group, question, instances: read }] };
  }

  // `group` and `sentence`. A sentence's field identifiers are its gap names, so both read the
  // same way and the schema is the only thing that says which names are legal.
  const made = fieldsFrom(group, question.fields, parsed["fields"]);
  if ("refusal" in made) {
    return { ok: false, refusal: made.refusal };
  }
  if (made.fields.size === 0) {
    return { ok: false, refusal: { kind: "no-answers", group } };
  }
  return { ok: true, blocks: [{ group, question, fields: made.fields }] };
}

/** What the reader sees a field called, for the review surface. */
function labelFor(question: Question, field: string): string {
  if (question.kind === "single") {
    return question.label;
  }
  if (question.kind === "checklist") {
    return field;
  }
  return question.fields.find((one) => one.id === field)?.label ?? field;
}

/**
 * How many instances the page renders for a repeat — the ceiling on new ones (0015).
 *
 * `min`, not `max`. `max` is what a reader may add once an add-another control exists, and
 * 0013 · C6 records that it does not: bounding at `max` would let an assistant asked for
 * "5–8 chapters" return eight and store three chapters of dictated words that nothing on the
 * page will ever show. #74 is what changes this; until then the prompt asks for the rendered
 * count, so the refusal is a backstop rather than an ordinary outcome.
 *
 * Derived from the schema rather than counted in the DOM, because the general paste box lives
 * on /agent where no worksheet is rendered at all. A stored order longer than `min` — which
 * 0013 · Q2 says is accepted without comment — raises the floor rather than the ceiling: those
 * instances exist, so they are not evidence that more may be added.
 */
function slotsFor(question: RepeatQuestion, existing: number): number {
  return Math.max(question.min, existing);
}

/**
 * Work out what a set of blocks would change, against what is stored now.
 *
 * Writes nothing and is given no store — only the entries. The numbers it returns are what
 * 0007 · C3 requires the reader to see before an overwrite, and returning them from the same
 * pass that builds the writes is what stops the preview and the write disagreeing.
 */
export function planFor(
  blocks: readonly Block[],
  entries: ReadonlyMap<string, string>,
): Planning {
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
    (before === "" ? additions : changes).push({ group, key, label, before, after });
  };

  for (const block of blocks) {
    const { group, question } = block;
    if (!groups.includes(group)) {
      groups.push(group);
    }

    if (block.answer !== undefined) {
      // A single is stored under the question identifier itself — no field segment.
      record(group, question.id, labelFor(question, question.id), block.answer);
      continue;
    }

    if (block.fields !== undefined) {
      for (const [field, value] of block.fields) {
        record(group, `${group}.${field}`, labelFor(question, field), value);
      }
      continue;
    }

    if (block.instances === undefined || question.kind !== "repeat") {
      continue;
    }

    const stored = readOrder(entries.get(orderKey(group)));
    // `unreadable` is deliberately not `absent` (0013 · Q3): materialising over an order that
    // merely failed to parse would mint fresh identifiers on top of the reader's answers and
    // orphan every one of them. Treating it as empty here would do exactly that by another
    // name, so it refuses instead.
    if (stored.kind === "unreadable") {
      return { ok: false, refusal: { kind: "bad-value", group, field: orderKey(group) } };
    }
    const existing = stored.kind === "order" ? stored.instances : [];

    // An id naming an instance in THIS group's order answers that instance. Anything else —
    // unknown, another group's, malformed, or absent — is a new instance, and what the block
    // supplied is never written (0015). Minting rather than adopting is what makes a hostile
    // or reused identifier a case that cannot arise rather than one to validate.
    const minted: string[] = [];
    const targets: string[] = [];
    for (const instance of block.instances) {
      if (instance.id !== undefined && existing.includes(instance.id)) {
        targets.push(instance.id);
        continue;
      }
      const fresh = newInstanceId();
      minted.push(fresh);
      targets.push(fresh);
    }

    const slots = slotsFor(question, existing.length);
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

    block.instances.forEach((instance, index) => {
      const target = targets[index];
      if (target === undefined) {
        return;
      }
      for (const [field, value] of instance.fields) {
        record(group, answerKey(group, target, field), labelFor(question, field), value);
      }
    });

    if (minted.length > 0) {
      // New instances append after everything that exists, in the order the block gave them.
      // A block never reorders what is already there — the order is the reader's (0015).
      writes.set(orderKey(group), writeOrder([...existing, ...minted]));
    }
  }

  return { ok: true, plan: { writes, changes, additions, unchanged, groups } };
}

/** A refusal in terms a reader can act on, and never one that blames them. */
export function explain(refusal: Refusal): string {
  switch (refusal.kind) {
    case "no-blocks":
      return "There is nothing from an assistant in that. Copy the whole reply, including the part in a code block, and paste it again.";
    case "unknown-group":
      return `That answers a question this workbook does not have (${refusal.group}). It may be from a newer version, or the identifier may have been altered.`;
    case "checklist":
      return `${refusal.group} is a checklist you work through yourself, so answers cannot be imported into it.`;
    case "newer-version":
      return `That was written for a newer version of the workbook (version ${refusal.found}). Update, then paste it again.`;
    case "bad-version":
      return `A block for ${refusal.group || "an unnamed question"} does not say which version it is, so it cannot be read safely.`;
    case "no-answers":
      return `A block for ${refusal.group} carries no answers.`;
    case "several-shapes":
      return `A block for ${refusal.group} answers in more than one way at once, and there is no safe way to choose between them.`;
    case "wrong-shape":
      return `A block for ${refusal.group} is not the shape that question takes — it should carry ${refusal.expected}.`;
    case "unknown-field":
      return `A block for ${refusal.group} answers something that question does not ask (${refusal.field}). Nothing has been changed, so no words are lost.`;
    case "bad-value":
      return `A block for ${refusal.group} has an answer for ${refusal.field} that is not usable text.`;
    case "too-many-instances":
      return `That returns ${refusal.found} answers for ${refusal.group}, and the page has room for ${refusal.slots}. Ask for ${refusal.slots} and paste it again — nothing has been changed.`;
  }
}
