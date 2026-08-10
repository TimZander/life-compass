/**
 * The prompt one question group becomes.
 *
 * The copy-out half of the bridge (docs/decisions/0007). It builds the text a reader hands to
 * an assistant of their choosing, and it builds it here — as a value, from the schema — so
 * that what the preview shows and what the clipboard receives cannot be two different
 * strings. 0007 · 1 asks for the literal payload to be previewed, and the only way to mean
 * that is for there to be one payload.
 *
 * What makes it worth anything is `ASKS`. An earlier version of this file worked from the
 * label alone and produced, for the question about a eulogy, the entire brief "A single
 * answer: **Eulogy**" — while the worksheet two lines above asked the real question. 0004 · C8
 * records the split that caused it and the reading-back that repairs it.
 *
 * Nothing here touches the network, and nothing can: `connect-src 'none'` forbids it
 * (docs/decisions/0006). The inconvenience of copy-and-paste is the mechanism rather than a
 * limitation, which 0007 · C2 asks not to be optimised away later.
 */

import type { Question, RepeatQuestion } from "../questions/types.ts";
import { answerKey, fieldKey, orderKey, readOrder } from "./keys.ts";
import { ASKS, WORKSHEETS } from "./schema.ts";

/**
 * The contract an assistant is asked to answer in — docs/decisions/0015.
 *
 * Exported so the reader that parses replies uses the same two values that the generator
 * asked for. 0015 names two-copies-of-one-fact as the mistake behind 0009 · C6 and behind
 * `keys.ts`'s `readOrder`/`answerKey` disagreement; a format string the writer and the reader
 * each spell for themselves is that mistake with the round trip in between, where it would
 * show up as replies that silently match nothing.
 */
export const FORMAT = "life-compass/agent-answers";
export const VERSION = 1;

/**
 * The `group` in the worked example, which the schema deliberately does not contain.
 *
 * 0015 · C8a. An example teaches the shape far better than a description of it, and it is
 * also what a reader hands back if they mis-tap and paste the prompt into the box seconds
 * after copying it. A group the schema does not hold is already a refusal (0015 · C6), so the
 * example is instructive on the way out and refused loudly on the way back.
 */
export const EXAMPLE_GROUP = "example.not_a_real_group";

/** Everything except a checklist, which 0015 keeps out of the contract. */
export type Answerable = Exclude<Question, { readonly kind: "checklist" }>;

export type Refusal =
  | { readonly kind: "unknown-group"; readonly group: string }
  | { readonly kind: "checklist"; readonly group: string }
  | { readonly kind: "wrong-prior"; readonly group: string };

export type Generated =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly refusal: Refusal };

/** One instance the reader already has, with the identity 0013 minted for it. */
export type PriorInstance = {
  readonly id: string;
  readonly fields: ReadonlyMap<string, string>;
  /**
   * Whether anything is stored under it — which is not the same as whether it is being sent.
   *
   * Identifiers travel whether or not answers do (0015 · C3), so with answers withheld every
   * instance arrives with an empty map. Without this flag they were all announced as "nothing
   * written yet", which tells the assistant something untrue about a question the reader has
   * already answered, and invites it to ask again for words they have deliberately not shared.
   */
  readonly written: boolean;
};

/**
 * Answers the reader already has, if they opted them in.
 *
 * A union rather than two optional keys, discriminated the way the question is. The shape a
 * group's answers take is decided by its kind, so a type that lets a `single` be handed a
 * list of instances is a type that lets a caller be wrong silently — and 0015 refuses a
 * *block* carrying more than one shape for the same reason.
 */
export type Prior =
  | { readonly for: "fields"; readonly fields: ReadonlyMap<string, string> }
  | { readonly for: "instances"; readonly instances: readonly PriorInstance[] };

/** The question with this identifier, from the definitions the pages were rendered from. */
export function findQuestion(group: string): Question | undefined {
  for (const worksheet of WORKSHEETS) {
    for (const question of worksheet.questions) {
      if (question.id === group) {
        return question;
      }
    }
  }
  return undefined;
}

/**
 * Assemble a group's stored answers into the shape a prompt can carry.
 *
 * This is the seam where an interface designed without its caller usually turns out not to
 * fit, so it lives beside the type it produces and is tested against real stored keys rather
 * than against an idea of them.
 *
 * A repeat's answers hang off instance identifiers whose order is itself a stored value
 * (0013), and an unreadable order is not an empty one — `keys.ts` refuses the whole order
 * rather than dropping entries, because dropping shifts every later instance up a slot. So an
 * unreadable order yields no prior at all: better to interview from scratch than to hand an
 * assistant identifiers that will not match on the way back.
 *
 * Returns `undefined` when there is nothing written, which is what keeps 0007 · 2's
 * default-off honest — an empty section is not an opt-in with nothing in it.
 */
export function priorFrom(
  question: Question,
  entries: ReadonlyMap<string, string>,
  includeAnswers: boolean,
): Prior | undefined {
  if (question.kind === "checklist") {
    return undefined;
  }

  if (question.kind === "repeat") {
    const order = readOrder(entries.get(orderKey(question.id)));
    if (order.kind !== "order") {
      return undefined;
    }
    // EVERY instance in the order, answered or not, and regardless of the answers opt-in.
    // 0015 · C3 says so — "prompts carry instance identifiers even when no answers travel" —
    // and the arithmetic is why. Carrying only the answered ones sends two ids for a group
    // asking for five; the assistant returns five, three of them with no id to echo, and
    // 0015 mints those as new and appends them AFTER the five that exist. Eight instances
    // against a five-slot page, which 0015 · C6 then refuses outright — so the commonest
    // journey there is, "I started this by hand, help me finish", produces a reply the
    // importer cannot accept. An identifier is structure rather than content, so it does not
    // wait on a decision about content.
    const instances: PriorInstance[] = [];
    for (const id of order.instances) {
      const fields = new Map<string, string>();
      let written = false;
      for (const field of question.fields) {
        const value = entries.get(answerKey(question.id, id, field.id));
        if (value === undefined || value === "") {
          continue;
        }
        written = true;
        // Read either way, carried only when asked for: the reader's opt-in governs the
        // words, not whether this instance is known to exist.
        if (includeAnswers) {
          fields.set(field.id, value);
        }
      }
      instances.push({ id, fields, written });
    }
    return { for: "instances", instances };
  }

  if (!includeAnswers) {
    // Nothing but answers to carry for the other kinds: they have no identity of their own,
    // so with answers withheld there is nothing structural left to send.
    return undefined;
  }

  const fields = new Map<string, string>();
  if (question.kind === "single") {
    // A single has no field segment: its answer is stored under the question identifier
    // itself. Keyed by that here so the label lookup has something to find.
    const value = entries.get(question.id);
    if (value !== undefined && value !== "") {
      fields.set(question.id, value);
    }
  } else {
    for (const field of question.fields) {
      const value = entries.get(fieldKey(question.id, field.id));
      if (value !== undefined && value !== "") {
        fields.set(field.id, value);
      }
    }
  }
  return fields.size > 0 ? { for: "fields", fields } : undefined;
}

/**
 * A reader's own words, made safe to sit in a document that is about to be read for fenced
 * blocks.
 *
 * An answer containing a fence and a JSON body would otherwise arrive in the prompt as a
 * second, valid-looking contract block naming a real group — and 0015's importer scans every
 * fence in a paste. So a reader who wrote about code, or who was fed something to write,
 * could hand back a prompt that imports answers to a question they were not looking at. The
 * backtick is the whole of the mechanism for THAT attack, and it happens before the preview,
 * so what 0007 · 1 shows is what is sent.
 *
 * The newline is the other half, and it was missed. Every answer is interpolated into a
 * Markdown list item, and answers are multi-line by construction — fields.ts treats `\n` as
 * the common case, because these are dictated paragraphs. An answer whose second line begins
 * "- id 'i2'" therefore closes the reader's own entry and opens a second one that looks
 * exactly like a real instance, ahead of the real one. Indenting every continuation line
 * keeps a multi-line answer inside the item it belongs to, so no line of a reader's prose can
 * open a block of its own — which covers `-`, `*`, `#`, `>`, `1.` and a fence in one move,
 * rather than one escape per character that happens to be special.
 */
function neutralise(answer: string, continuation = "    "): string {
  return answer.replace(/`/g, "'").replace(/\r?\n/g, `\n${continuation}`);
}

/**
 * What the reader sees a field called.
 *
 * Exported for agent-answers.ts, which needs the same answer for the review surface. It had
 * its own byte-identical copy plus a checklist branch it could never reach, because its
 * question was typed `Question` where the value had already been proven answerable.
 */
export function labelFor(question: Answerable, field: string): string {
  if (question.kind === "single") {
    return question.label;
  }
  return question.fields.find((one) => one.id === field)?.label ?? field;
}

/**
 * How many instances to ask for: `min`, the count the build prints, NOT `max`.
 *
 * 0013 · Q2 is why — an instance order longer than the rendered slot count "is accepted
 * without comment, and the answers under its extra instances simply never appear". Day 1
 * asks for "5–8 chapters" in its prose and prints five, so asking an assistant for the
 * worksheet's range would invite three answers nothing on the page can show.
 *
 * *Updated with #74.* The sheet now renders every instance the range allows and reveals the
 * ones a stored order names, so a reply carrying eight chapters has somewhere to go. This is
 * therefore `max` rather than `min`, and the prompt asks for the range instead of a number the
 * reader never chose. 0015's ceiling moves with it.
 */
export function renderedSlots(question: RepeatQuestion): number {
  return question.max;
}

/** What the assistant is being asked about, in the worksheet's own words. */
function subject(question: Answerable): string {
  const ask = ASKS[question.id] ?? "";
  const fields =
    question.kind === "single"
      ? ""
      : `\n\nThe answer has these parts:\n\n${question.fields
          .map((field) => `- **${field.label}** — key \`${field.id}\``)
          .join("\n")}`;

  const shape =
    question.kind === "repeat"
      ? question.min === question.max
        // 31 of the 34 repeats have a single count. Phrased as a range they read "between
        // 5 and 5 … do not stop at 5 if I have more", which is incoherent and actively
        // invites the overflow `ceilingFor` then refuses — the prompt and the importer
        // disagreeing, which is what sharing a ceiling exists to prevent.
        ? `\n\nThis one repeats. The page holds ${question.min}, so ask about ${question.min} of ` +
          `them, one at a time.`
        : `\n\nThis one repeats. The worksheet asks for between ${question.min} and ${question.max}, ` +
          `and how many is my decision — ask me, and cover that many one at a time. Do not pad ` +
          `to reach ${renderedSlots(question)}, and do not stop at ${question.min} if I have more.`
      : question.kind === "sentence"
        ? `\n\nIt is a sentence to complete, not a form to fill: "${question.template}"`
        : "";

  return `${ask}${fields}${shape}`;
}

/** The worked example, in the contract's shape but naming a group that cannot be imported. */
function example(question: Answerable, prior: Prior | undefined): string {
  const placeholder = (id: string): string => `"${id}": "what I said"`;
  const body =
    question.kind === "repeat"
      ? `"instances": [\n    { ${
          prior?.for === "instances" && prior.instances.length > 0 ? '"id": "the id from above", ' : ""
        }"fields": { ${question.fields.map((field) => placeholder(field.id)).join(", ")} } }\n  ]`
      : question.kind === "single"
        ? `"answer": "what I said"`
        : `"fields": { ${question.fields.map((field) => placeholder(field.id)).join(", ")} }`;

  return `\`\`\`\n{\n  "format": "${FORMAT}",\n  "version": ${VERSION},\n  "group": "${EXAMPLE_GROUP}",\n  ${body}\n}\n\`\`\``;
}

function priorSection(question: Answerable, prior: Prior): string {
  const lines: string[] = [];

  if (prior.for === "instances") {
    for (const instance of prior.instances) {
      // The identifier, not a number. 0015 carries identity in the prompt so a reply updates
      // the instance it names; numbering them would teach the ordinal reference that 0011 was
      // written to prevent and 0013 rejected outright.
      //
      // Listed even where nothing has been written under it, so every slot has an id to come
      // back with. Skipping the empty ones is what made a half-finished group un-importable.
      lines.push(`- id \`${neutralise(instance.id)}\``);
      if (instance.fields.size === 0) {
        lines.push(
          instance.written
            ? "  - (I have answered this one already, and have not shared it with you here)"
            : "  - (nothing written yet — ask me about this one)",
        );
        continue;
      }
      for (const [field, value] of instance.fields) {
        lines.push(`  - ${labelFor(question, field)}: ${neutralise(value)}`);
      }
    }
  } else {
    for (const [field, value] of prior.fields) {
      // Two spaces, not four: these entries sit at the top level of the list rather than
      // under an id, so the continuation has one less level to clear.
      lines.push(`- ${labelFor(question, field)}: ${neutralise(value, "  ")}`);
    }
  }

  if (lines.length === 0) {
    return "";
  }

  if (prior.for === "instances") {
    return (
      `\n## The ones I already have, and their ids\n\n${lines.join("\n")}\n\n` +
      `Return **every** id above, each with its own answers — the ones already written as they` +
      ` are unless I change them, and the empty ones filled in. Keep each id with the answer it` +
      ` belongs to. An answer that comes back without its id is treated as a new one and added` +
      ` beside the old, which is not what either of us wants.\n`
    );
  }
  return (
    `\n## What I have already written\n\n${lines.join("\n")}\n\n` +
    `Ask me about these too — I may want to change them. Return every one you and I discussed,` +
    ` changed or not.\n`
  );
}

/**
 * Build the prompt for one question group.
 *
 * `prior` is omitted unless the reader opted in, per 0007 · 2 — generating a prompt for one
 * task must never quietly bundle four days of reflection, and the default is off rather than
 * a setting somebody has to find.
 */
export function promptFor(group: string, prior?: Prior): Generated {
  const question = findQuestion(group);
  if (question === undefined) {
    return { ok: false, refusal: { kind: "unknown-group", group } };
  }
  // 0015 keeps checklists out of the contract: readiness ticks are the reader's to work
  // through, not something to answer on their behalf. Refused rather than filtered silently,
  // so a control that should not exist fails loudly if one ever does.
  if (question.kind === "checklist") {
    return { ok: false, refusal: { kind: "checklist", group } };
  }
  // A caller holding the wrong shape has read the store wrongly; saying so beats rendering a
  // repeat's answers as though the question had none.
  const wants = question.kind === "repeat" ? "instances" : "fields";
  if (prior !== undefined && prior.for !== wants) {
    return { ok: false, refusal: { kind: "wrong-prior", group } };
  }

  const text =
    `You are interviewing me about one part of a values workbook, so that I can answer it by\n` +
    `talking instead of typing.\n\n` +
    `How to run it:\n\n` +
    `- Ask **one question per message**, then wait for my answer before asking the next.\n` +
    `  Never list several questions at once.\n` +
    `- Follow up when an answer is thin. Ask for a specific memory, decision or moment rather\n` +
    `  than a general belief — that is the part I cannot do alone.\n` +
    `- Each answer has named parts, listed below. Make sure you have every one before moving\n` +
    `  on, and if what I said does not cover a part, **ask for it by name**. Do not infer it\n` +
    `  from something I said about a different part.\n` +
    `- Do not invent answers, and do not improve mine. Give me back my own words, tidied only\n` +
    `  where dictation garbled them. If an answer is short because that is what I said, leave\n` +
    `  it short.\n` +
    `- When we have covered everything below, say so and offer me the block.\n\n` +
    `## What to ask about\n\n${subject(question)}\n` +
    `${prior === undefined ? "" : priorSection(question, prior)}\n` +
    `## How to give the answers back\n\n` +
    `At the end, output one fenced block — the last thing in your reply, and the only fenced\n` +
    `block in it. Change two things from this example: put \`"group": "${question.id}"\`, and\n` +
    `put my real answers where the placeholders are.\n\n${example(question, prior)}\n\n` +
    `Every value is plain text on one line. If I did not answer something, **leave that key\n` +
    `out entirely** — never send an empty string, a dash, or a guess. Say anything else you\n` +
    `want to say outside the block.\n`;

  return { ok: true, text };
}

/** What a refusal says. Each names what went wrong; none of them changes anything. */
export function explain(refusal: Refusal): string {
  switch (refusal.kind) {
    case "unknown-group":
      return `This build has no question called ${refusal.group}, so there is nothing to ask about.`;
    case "checklist":
      return `${refusal.group} is a checklist to work through yourself, not a question to be interviewed about.`;
    case "wrong-prior":
      return `The stored answers for ${refusal.group} are not the shape that question takes.`;
  }
}
