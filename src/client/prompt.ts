/**
 * The prompt one question group becomes.
 *
 * This is the copy-out half of the bridge (docs/decisions/0007). It builds the text a
 * reader hands to an assistant of their choosing, and it builds it here — as a value, from
 * the schema — rather than in the DOM, so that what the preview shows and what the
 * clipboard receives cannot be two different strings. 0007 · 1 asks for the literal payload
 * to be previewed, and the only way to mean that is for there to be one payload.
 *
 * Nothing in this file touches the network, and nothing can: `connect-src 'none'` forbids
 * it (docs/decisions/0006). The inconvenience of copy-and-paste is the mechanism rather
 * than a limitation, which 0007 · C2 asks not to be optimised away later.
 */

import type { Question, Size } from "../questions/types.ts";
import { WORKSHEETS } from "./schema.ts";

/** The contract an assistant is asked to answer in — docs/decisions/0015. */
const FORMAT = "life-compass/agent-answers";
const VERSION = 1;

/**
 * The `group` in the worked example, which the schema deliberately does not contain.
 *
 * 0015 · C8a. An example teaches the shape far better than a description of it, but a
 * reader who copies a prompt and pastes it back — a plausible mis-tap seconds later —
 * would otherwise hand the importer a correctly-named block that is not a reply. A group
 * the schema does not hold is already a refusal (0015 · C6), so the example is instructive
 * on the way out and refused loudly on the way back.
 */
const EXAMPLE_GROUP = "example.not_a_real_group";

/**
 * Everything except a checklist.
 *
 * Narrowed once, here, rather than re-checked in each helper: `promptFor` refuses a
 * checklist before any of them runs, and saying so in the type is what stops that being a
 * fact the reader has to hold in their head.
 */
type Answerable = Exclude<Question, { readonly kind: "checklist" }>;

export type Refusal =
  | { readonly kind: "unknown-group"; readonly group: string }
  | { readonly kind: "checklist"; readonly group: string };

export type Generated =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly refusal: Refusal };

/** Prior answers for one group, already resolved out of the store by the caller. */
export type Prior = {
  /** Field identifier segment to answer, for a single, group or sentence. */
  readonly fields?: ReadonlyMap<string, string>;
  /** One map per instance, in the reader's order, for a repeat. */
  readonly instances?: readonly ReadonlyMap<string, string>[];
};

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
 * How much room an answer wants, said in words rather than as a hint nobody outside this
 * codebase can interpret. The two values are the ones the workbook has always drawn
 * (src/questions/types.ts), so this adds no third opinion about length.
 */
function roomFor(size: Size): string {
  return size === "short" ? "a few words" : "a sentence or two, more if it wants them";
}

function fieldLines(fields: readonly { id: string; label: string; size: Size }[]): string {
  return fields
    .map((field) => `- ${field.label} (\`${field.id}\`) — ${roomFor(field.size)}`)
    .join("\n");
}

/**
 * How many instances to ask for.
 *
 * `min`, which is the count the build prints, NOT `max`. 0015 makes this a rule and
 * 0013 · Q2 is why: an instance order longer than the rendered slot count "is accepted
 * without comment, and the answers under its extra instances simply never appear". Day 1
 * asks for "5–8 chapters" in its prose and prints five, so asking an assistant for the
 * worksheet's range would invite three answers nothing on the page can show. The importer
 * refuses the excess either way; this is what stops it being an ordinary outcome.
 *
 * This is a workaround for a missing capability rather than the shape anyone would choose.
 * A worksheet that asks for "5-8 chapters" means the reader decides, and #74 is where that
 * becomes true. When it lands, this asks for the range and the ceiling becomes `max`.
 */
function slotsFor(question: Extract<Question, { kind: "repeat" }>): number {
  return question.min;
}

function describe(question: Answerable): string {
  if (question.kind === "single") {
    return `A single answer: **${question.label}** — ${roomFor(question.size)}.`;
  }
  if (question.kind === "group") {
    return `Several separate prompts, answered together:\n\n${fieldLines(question.fields)}`;
  }
  if (question.kind === "sentence") {
    return (
      `A sentence to complete. The gaps are named, and each one is a field:\n\n` +
      `> ${question.template}\n\n${fieldLines(question.fields)}`
    );
  }
  const slots = slotsFor(question);
  return (
    `${slots} × **${question.label}**, each with the same fields:\n\n` +
    `${fieldLines(question.fields)}\n\n` +
    `Ask about each ${question.label.toLowerCase()} in turn. Return exactly ${slots}.`
  );
}

/** The worked example, in the contract's shape but naming a group that cannot be imported. */
function example(question: Answerable): string {
  const body =
    question.kind === "repeat"
      ? `"instances": [\n    { "fields": { ${question.fields
          .map((field) => `"${field.id}": "…"`)
          .join(", ")} } }\n  ]`
      : question.kind === "single"
        ? `"answer": "…"`
        : `"fields": { ${question.fields.map((field) => `"${field.id}": "…"`).join(", ")} }`;

  return (
    "```\n{\n" +
    `  "format": "${FORMAT}",\n` +
    `  "version": ${VERSION},\n` +
    `  "group": "${EXAMPLE_GROUP}",\n` +
    `  ${body}\n}\n` +
    "```"
  );
}

function priorSection(question: Answerable, prior: Prior): string {
  const label = (id: string): string =>
    question.kind === "single"
      ? question.label
      : (question.fields.find((field) => field.id === id)?.label ?? id);

  if (prior.instances !== undefined) {
    const written = prior.instances
      .map((instance, at) => {
        const lines = [...instance].map(([id, value]) => `  - ${label(id)}: ${value}`).join("\n");
        return `- ${at + 1}.\n${lines}`;
      })
      .join("\n");
    return `\n## What I have written so far\n\n${written}\n`;
  }

  const fields = prior.fields;
  if (fields === undefined || fields.size === 0) {
    return "";
  }
  const written = [...fields].map(([id, value]) => `- ${label(id)}: ${value}`).join("\n");
  return `\n## What I have written so far\n\n${written}\n`;
}

/**
 * Build the prompt for one question group.
 *
 * `prior` is omitted unless the reader opted in, per 0007 · 2 — generating a prompt for one
 * task must never quietly bundle four days of reflection, and the default is off rather
 * than a setting somebody has to find.
 */
export function promptFor(group: string, prior?: Prior): Generated {
  const question = findQuestion(group);
  if (question === undefined) {
    return { ok: false, refusal: { kind: "unknown-group", group } };
  }
  // 0015 keeps checklists out of the contract: readiness ticks are the reader's to work
  // through, not something to answer on their behalf. Refused here rather than filtered
  // silently, so a control that should not exist fails loudly if one ever does.
  if (question.kind === "checklist") {
    return { ok: false, refusal: { kind: "checklist", group } };
  }

  const text =
    `You are interviewing me about one part of a values workbook. Ask me about it one\n` +
    `question at a time, out loud, and follow up where an answer is thin — that is the\n` +
    `part I cannot do alone. Do not write my answers for me.\n\n` +
    `## What to ask about\n\n${describe(question)}\n` +
    `${prior === undefined ? "" : priorSection(question, prior)}\n` +
    `## How to give the answers back\n\n` +
    `When I say we are done, output a single fenced block in exactly this shape, and\n` +
    `nothing else inside the fence:\n\n${example(question)}\n\n` +
    `Two things to change from that example: use \`"group": "${question.id}"\`, and put my\n` +
    `real answers where the placeholders are. Say anything else you want to say outside\n` +
    `the fence — I will only read what is inside it.\n`;

  return { ok: true, text };
}

/** What a refusal says. Each names what went wrong; none of them changes anything. */
export function explainRefusal(refusal: Refusal): string {
  if (refusal.kind === "unknown-group") {
    return `There is no question called ${refusal.group} in this workbook.`;
  }
  return "That is a checklist to work through yourself, not a question to be interviewed about.";
}
