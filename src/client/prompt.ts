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
import { answerKey, orderKey, readOrder } from "./keys.ts";
import { ASKS, WORKSHEETS } from "./schema.ts";

/** The contract an assistant is asked to answer in — docs/decisions/0015. */
const FORMAT = "life-compass/agent-answers";
const VERSION = 1;

/**
 * The `group` in the worked example, which the schema deliberately does not contain.
 *
 * 0015 · C8a. An example teaches the shape far better than a description of it, and it is
 * also what a reader hands back if they mis-tap and paste the prompt into the box seconds
 * after copying it. A group the schema does not hold is already a refusal (0015 · C6), so the
 * example is instructive on the way out and refused loudly on the way back.
 */
const EXAMPLE_GROUP = "example.not_a_real_group";

/** Everything except a checklist, which 0015 keeps out of the contract. */
type Answerable = Exclude<Question, { readonly kind: "checklist" }>;

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
): Prior | undefined {
  if (question.kind === "checklist") {
    return undefined;
  }

  if (question.kind === "repeat") {
    const order = readOrder(entries.get(orderKey(question.id)));
    if (order.kind !== "order") {
      return undefined;
    }
    const instances: PriorInstance[] = [];
    for (const id of order.instances) {
      const fields = new Map<string, string>();
      for (const field of question.fields) {
        const value = entries.get(answerKey(question.id, id, field.id));
        if (value !== undefined && value !== "") {
          fields.set(field.id, value);
        }
      }
      instances.push({ id, fields });
    }
    return instances.some((instance) => instance.fields.size > 0)
      ? { for: "instances", instances }
      : undefined;
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
      const value = entries.get(`${question.id}.${field.id}`);
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
 * backtick is the whole of the mechanism, so removing it is the whole of the fix; it happens
 * before the preview, so what 0007 · 1 shows is what is sent.
 */
function neutralise(answer: string): string {
  return answer.replace(/`/g, "'");
}

function labelFor(question: Answerable, field: string): string {
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
 * A workaround for a missing capability rather than the shape anyone would choose. #74 is
 * where a repeat holds as many instances as the reader has; when it lands, this asks for the
 * range and 0015's ceiling becomes `max`.
 */
function slotsFor(question: RepeatQuestion): number {
  return question.min;
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
      ? `\n\nThis one repeats. Ask about ${slotsFor(question)} of them, one at a time. The page ` +
        `has room for ${slotsFor(question)}, so ${slotsFor(question)} is what I need.`
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
      if (instance.fields.size === 0) {
        continue;
      }
      // The identifier, not a number. 0015 carries identity in the prompt so a reply updates
      // the instance it names; numbering them would teach the ordinal reference that 0011 was
      // written to prevent and 0013 rejected outright.
      lines.push(`- id \`${instance.id}\``);
      for (const [field, value] of instance.fields) {
        lines.push(`  - ${labelFor(question, field)}: ${neutralise(value)}`);
      }
    }
  } else {
    for (const [field, value] of prior.fields) {
      lines.push(`- ${labelFor(question, field)}: ${neutralise(value)}`);
    }
  }

  if (lines.length === 0) {
    return "";
  }

  const echo =
    prior.for === "instances"
      ? " Keep the id with the answer it belongs to, so an update lands on the right one rather" +
        " than adding a sixth."
      : "";
  return (
    `\n## What I have already written\n\n${lines.join("\n")}\n\n` +
    `Ask me about these too — I may want to change them. Return every one you and I discussed,` +
    ` changed or not.${echo}\n`
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
    `- Start on the first thing below. I know what I came here for, so no warm-up question.\n` +
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
