/**
 * Loading, verifying, and rendering question definitions.
 *
 * The verification here is what makes a sidecar schema safe rather than drift-prone
 * (docs/decisions/0004): anchors are checked in BOTH directions, so neither a question
 * without a place to render nor a placeholder without a question can survive a build.
 * A one-directional check would let the second case through silently — the page renders,
 * the questions are simply absent, and nothing says so.
 */

import { WORKSHEETS, type Worksheet } from "../src/questions/index.ts";
import { REGISTRY } from "../src/questions/registry.ts";
import { gapsOf, identifiersOf, type Question } from "../src/questions/types.ts";

/** `<!-- questions: day1.chapters -->` on a line of its own. */
export const ANCHOR = /^<!--\s*questions:\s*([A-Za-z0-9._-]+)\s*-->$/;

export type Schema = {
  readonly worksheets: readonly Worksheet[];
  /** Question id -> definition, across every worksheet. */
  readonly byId: ReadonlyMap<string, Question>;
  /** Source path -> the questions declared for it. */
  readonly bySource: ReadonlyMap<string, readonly Question[]>;
};

export function loadSchema(worksheets: readonly Worksheet[] = WORKSHEETS): Schema {
  const byId = new Map<string, Question>();
  const bySource = new Map<string, readonly Question[]>();

  for (const worksheet of worksheets) {
    bySource.set(worksheet.source, worksheet.questions);
    for (const question of worksheet.questions) {
      if (byId.has(question.id)) {
        throw new Error(`duplicate question id: ${question.id}`);
      }
      byId.set(question.id, question);
    }
  }

  return { worksheets, byId, bySource };
}

/**
 * Check every identifier against the registry, in both directions.
 *
 * Unregistered identifiers are the obvious half. The other half — a registered `active`
 * identifier that no question uses any more — is the one that catches a rename done by
 * editing a single line, which is exactly what 0011 set out to make impossible.
 */
export function checkRegistry(schema: Schema): readonly string[] {
  const problems: string[] = [];

  const entries = new Map(REGISTRY.map((entry) => [entry.id, entry]));
  const used = new Set<string>();

  for (const question of schema.byId.values()) {
    for (const id of identifiersOf(question)) {
      used.add(id);
      const entry = entries.get(id);
      if (entry === undefined) {
        problems.push(`${id} is used by a question but is not in the registry`);
      } else if (entry.status === "retired") {
        problems.push(`${id} is retired but still used by a question`);
      }
    }
  }

  for (const entry of REGISTRY) {
    if (entry.status === "active" && !used.has(entry.id)) {
      problems.push(
        `${entry.id} is registered active but no question uses it — retire it with a tombstone rather than deleting the entry`,
      );
    }
    if (entry.status === "retired" && entry.retiredOn === undefined) {
      problems.push(`${entry.id} is retired without a retiredOn date`);
    }
    if (entry.renamedTo !== undefined && !entries.has(entry.renamedTo)) {
      problems.push(`${entry.id} is renamed to ${entry.renamedTo}, which is not registered`);
    }
  }

  return problems;
}

/**
 * Sentence templates and their fields must account for each other exactly.
 *
 * Both failures are invisible in the output: a gap with no field renders as nothing at
 * all, and a field with no gap is a question the reader is never shown but which the
 * registry, the storage layer and the assistant contract all believe exists.
 */
export function checkSentences(schema: Schema): readonly string[] {
  const problems: string[] = [];
  for (const question of schema.byId.values()) {
    if (question.kind !== "sentence") {
      continue;
    }
    const gaps = new Set(gapsOf(question.template));
    const fields = new Set(question.fields.map((field) => field.id));
    for (const gap of gaps) {
      if (!fields.has(gap)) {
        problems.push(`${question.id} has a {${gap}} gap with no matching field`);
      }
    }
    for (const field of fields) {
      if (!gaps.has(field)) {
        problems.push(`${question.id} defines "${field}" but the sentence has no {${field}} gap`);
      }
    }
  }
  return problems;
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A drawn blank. The underscores are hidden by the stylesheet and drawn as a rule. */
function blank(fieldId: string, size: "short" | "long"): string {
  const cls = size === "short" ? "fill-sm" : "fill";
  return `<span class="${cls}" data-field="${escape(fieldId)}">______</span>`;
}

/**
 * Render one question.
 *
 * `data-question` and `data-field` are the seam the storage layer binds to (#24). They
 * are the reason to generate this markup at all — hand-written spans could look the
 * same, but nothing could find them.
 */
export function renderQuestion(question: Question): string {
  // A single question renders as a bare answer line. Its label is NOT printed: the
  // prose immediately above it already asks the question ("Patterns — what kind of
  // work…"), so printing the label repeats the word and reads like a stutter. The label
  // is kept in the schema for the form field's accessible name (#24).
  if (question.kind === "single") {
    return (
      `<p class="q-single" data-question="${escape(question.id)}">` +
      `${blank(question.id, question.size)}</p>`
    );
  }

  if (question.kind === "group") {
    // A plain list of labelled answers. No numbering, because these prompts differ from
    // one another rather than repeating — numbering them would imply an order that is
    // not there.
    const items = question.fields
      .map(
        (field) =>
          `<li>${escape(field.label)}: ${blank(`${question.id}.${field.id}`, field.size)}</li>`,
      )
      .join("\n");
    return `<ul class="q-group" data-question="${escape(question.id)}">\n${items}\n</ul>`;
  }

  if (question.kind === "checklist") {
    // Same markup kramdown produced for `- [ ]`, so the printed and on-screen forms stay
    // the ones readers already know. Disabled until #24 can store what was ticked —
    // a box that forgets is worse than one that cannot be ticked at all.
    const items = question.items
      .map(
        (item) =>
          `<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox"` +
          ` disabled="disabled" data-field="${escape(`${question.id}.${item.id}`)}" />` +
          `${escape(item.label)}</li>`,
      )
      .join("\n");
    return (
      `<ul class="task-list q-checklist" data-question="${escape(question.id)}">\n${items}\n</ul>`
    );
  }

  if (question.kind === "sentence") {
    // Text and blanks interleaved, so the sentence survives. Splitting on the gaps keeps
    // the literal parts and the fields in step without a second pass over the string.
    const parts = question.template.split(/\{([A-Za-z0-9_]+)\}/);
    const byId = new Map(question.fields.map((field) => [field.id, field]));
    let html = "";
    for (const [index, part] of parts.entries()) {
      if (index % 2 === 0) {
        html += escape(part);
        continue;
      }
      const field = byId.get(part);
      // A gap with no field is caught by checkSchema before this runs; rendering the
      // literal brace here would only hide it.
      html += field === undefined ? "" : blank(`${question.id}.${part}`, field.size);
    }
    return `<p class="q-sentence" data-question="${escape(question.id)}">${html}</p>`;
  }

  // An ordered list, so instance numbering comes from the list rather than from labels
  // baked into the markup — which matters once the reader can add or remove one.
  //
  // No per-instance heading is printed. Repeating the group's label above its first
  // field produced "Moment / Moment: ____" and "Hard moment / Hard moment: ____"; the
  // list number is identity enough. `label` stays in the schema for the add-another
  // control (#24), where it reads as a verb phrase rather than a heading.
  const items: string[] = [];
  for (let index = 0; index < question.min; index += 1) {
    if (question.fields.length === 1) {
      const field = question.fields[0];
      if (field === undefined) {
        continue;
      }
      items.push(
        `<li>${escape(field.label)}: ${blank(`${question.id}.${field.id}`, field.size)}</li>`,
      );
      continue;
    }
    // The first field sits inline with the list number and the rest nest beneath it.
    // Nesting all of them leaves the number alone on an otherwise empty line, which
    // reads as though something failed to render.
    const [first, ...rest] = question.fields;
    if (first === undefined) {
      continue;
    }
    const head = `${escape(first.label)}: ${blank(`${question.id}.${first.id}`, first.size)}`;
    const nested = rest
      .map(
        (field) =>
          `<li>${escape(field.label)}: ${blank(`${question.id}.${field.id}`, field.size)}</li>`,
      )
      .join("\n");
    items.push(`<li>${head}\n<ul>\n${nested}\n</ul>\n</li>`);
  }

  // The permitted range is carried as data, not printed. Rendering "(5–8)" advertises
  // an affordance the page does not yet have — nothing can add a sixth chapter until
  // #24 — and it appeared as unstyled debris between the list and the next heading.
  return (
    `<ol class="q-repeat" data-question="${escape(question.id)}"` +
    ` data-min="${question.min}" data-max="${question.max}">\n${items.join("\n")}\n</ol>`
  );
}
