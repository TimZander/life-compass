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
import {
  GAP,
  gapsOf,
  identifiersOf,
  type Field,
  type Question,
  type RepeatQuestion,
  type SentenceQuestion,
} from "../src/questions/types.ts";

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
 * Everything about a question that must hold before it can be rendered honestly.
 *
 * These are the failures that leave no trace in the output. A sentence gap with no
 * field renders as nothing at all; a field with no gap is a question the reader is
 * never shown but which the registry, the storage layer and the assistant contract all
 * believe exists; a question with no fields renders as an empty string where a
 * question should be. None of them can be seen by reading the built page, which is
 * what makes the build the only place they can be caught.
 */
export function checkSchema(schema: Schema): readonly string[] {
  const problems: string[] = [];
  problems.push(...checkIdentifiers(schema));
  for (const question of schema.byId.values()) {
    problems.push(...checkText(question));
    problems.push(...checkParts(question));
    if (question.kind === "repeat") {
      problems.push(...checkRange(question));
    }
    if (question.kind === "sentence") {
      problems.push(...checkGaps(question));
    }
  }
  return problems;
}

/**
 * The identifiers themselves, checked across every question at once. Two rules.
 *
 * No identifier may contain a blank segment — the inline comment below says what a
 * blank segment can come from and why it is fatal.
 *
 * And two questions must not produce the same identifier. Each question is checked
 * internally by `checkParts`, and `loadSchema` refuses two questions with the same id,
 * but neither sees a collision BETWEEN questions: a repeat `day1.chapters` and a group
 * `day1` with a field `chapters` both produce `day1.chapters`, and `checkRegistry` then
 * collapses the two into one `used` entry. The identifier is the storage key, so that
 * is two questions writing over each other.
 *
 * This does not check the other property a stored key will need — that no identifier is
 * a dotted prefix of one belonging to a DIFFERENT question, which is what makes a key
 * with an instance spliced into the middle readable again. Enforcing that needs to see
 * retired entries too, since 0011 · C2 keeps them forever and answers written under them
 * survive; and the registry does not record which question an entry came from, so it
 * cannot tell a group legitimately prefixing its own fields from a real collision. That
 * is one of 0013's open questions, and it lands with the format it protects.
 */
function checkIdentifiers(schema: Schema): readonly string[] {
  const problems: string[] = [];
  const owner = new Map<string, string>();

  for (const question of schema.byId.values()) {
    for (const id of identifiersOf(question)) {
      // A blank segment — empty, or nothing but whitespace — makes the identifier
      // unaddressable: `day1.` and `day1..title` name nothing a reader could be given,
      // and a whitespace segment differs from an empty one only in characters nobody
      // can see. It has more sources than a blank part id: `day1..title` comes from a
      // question id of `day1.`, or from a part id of `.title` — a dot at either edge of
      // either id lands here. Trimming is as far as this vets a segment; one with an
      // interior space or an interior dot passes through unremarked.
      if (id.split(".").some((segment) => segment.trim() === "")) {
        problems.push(`${question.id} produces ${JSON.stringify(id)}, which has a blank segment`);
      }
      const already = owner.get(id);
      // `already` equal to this question's own id is a duplicate part id WITHIN the
      // question. That is a real defect, but `checkParts` already reports it as
      // `declares "f" twice`; repeating it here would read `t.g.f is produced by both
      // t.g and t.g` — one question named twice, which sounds like a second problem
      // and is the same one.
      if (already !== undefined && already !== question.id) {
        problems.push(`${id} is produced by both ${already} and ${question.id}`);
      }
      owner.set(id, question.id);
    }
  }
  return problems;
}

/** Every author-written string a question can carry, paired with what to call it. */
function textOf(question: Question): readonly (readonly [string, string])[] {
  if (question.kind === "sentence") {
    return [["template", question.template]];
  }
  if (question.kind === "checklist") {
    return question.items.map((item) => [`item "${item.id}"`, item.label] as const);
  }
  if (question.kind === "repeat") {
    return [
      ["label", question.label],
      ...question.fields.map((field) => [`field "${field.id}"`, field.label] as const),
    ];
  }
  if (question.kind === "single") {
    // Never printed today, but it becomes the form field's accessible name at #24, so it
    // is author-facing text like any other.
    return [["label", question.label]];
  }
  return question.fields.map((field) => [`field "${field.id}"`, field.label] as const);
}

/**
 * Every sequence markdown-it's typographer would have converted, and what to write.
 *
 * The list mirrors the typographer's own: smart quotes, then the replacements. `(c)` and
 * friends are left out — no worksheet has one, and unlike the rest they read fine either
 * way.
 */
const TYPOGRAPHY: readonly (readonly [RegExp, string, string])[] = [
  [/'/, "a straight apostrophe", "’"],
  [/"/, "a straight double quote", "“ ”"],
  [/\.\.\./, "three dots", "…"],
  [/---/, "three hyphens", "—"],
  [/(?<!-)--(?!-)/, "two hyphens", "–"],
];

/**
 * Author text is prose and ships as written, so it has to be typeset like prose.
 *
 * markdown-it's typographer converts these for everything in the Markdown, but it never
 * sees these strings — they are injected after parsing. A straight apostrophe therefore
 * lands on the page beside curly ones set from the same paragraph, which is the kind of
 * thing nobody notices in a diff and everybody notices in print. The anchor page's two
 * quoted sentences were the first text to need the double-quote half, and they got it by
 * hand, which is the argument for the build knowing rather than the author remembering.
 */
function checkText(question: Question): readonly string[] {
  const problems: string[] = [];
  for (const [what, text] of textOf(question)) {
    for (const [pattern, name, instead] of TYPOGRAPHY) {
      if (pattern.test(text)) {
        problems.push(`${question.id} ${what} uses ${name} — write ${instead} instead`);
      }
    }
    if (text.trim() === "") {
      problems.push(`${question.id} ${what} is empty`);
    }
  }
  return problems;
}

/**
 * A question needs parts to render, and each part needs its own identifier.
 *
 * Duplicate part ids survive `identifiersOf` and then collapse in the registry check's
 * set, so two blanks end up sharing one `data-field` with nothing reporting it — the
 * rename hazard 0011 was written to close, arrived at by copy-paste instead.
 */
function checkParts(question: Question): readonly string[] {
  if (question.kind === "single") {
    return [];
  }
  const ids = question.kind === "checklist"
    ? question.items.map((item) => item.id)
    : question.fields.map((field) => field.id);
  const problems: string[] = [];
  if (ids.length === 0) {
    problems.push(`${question.id} is a ${question.kind} with nothing to fill in`);
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      problems.push(`${question.id} declares "${id}" twice`);
    }
    seen.add(id);
  }
  return problems;
}

/** `min` is what the sheet prints, so a range that runs backwards prints too little. */
function checkRange(question: RepeatQuestion): readonly string[] {
  const problems: string[] = [];
  if (question.min < 1) {
    problems.push(`${question.id} has min ${question.min}; a worksheet prints at least one`);
  }
  if (question.max < question.min) {
    problems.push(`${question.id} has max ${question.max} below min ${question.min}`);
  }
  return problems;
}

/** Sentence gaps and fields must account for each other exactly, in both directions. */
function checkGaps(question: SentenceQuestion): readonly string[] {
  const problems: string[] = [];
  const named = gapsOf(question.template);
  const gaps = new Set(named);
  const fields = new Set(question.fields.map((field) => field.id));
  if (named.length !== gaps.size) {
    // Two gaps of one name render as two blanks sharing one `data-field`, and the
    // set comparison below would call that agreement.
    problems.push(`${question.id} names the same gap more than once`);
  }
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
/**
 * What each field is CALLED to a screen reader, which is not always what is printed.
 *
 * A label repeated inside one question gets an ordinal. `day3.themes` declares three fields
 * all labelled "Example", so each theme rendered three adjacent controls announcing
 * themselves as "Theme 1 — Example" with nothing to tell them apart — and a reader tabbing
 * between them has only the name to go on.
 *
 * The ordinal goes on the spoken name only. The printed worksheet still reads "Example:"
 * three times, which is how the worksheet has always read and is not this change's to
 * alter. Labels repeated across DIFFERENT questions are deliberately left alone: those sit
 * in separate sections under their own headings, and the heading is the context.
 */
function spokenNames(fields: readonly Field[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  for (const field of fields) {
    counts.set(field.label, (counts.get(field.label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const spoken = new Map<string, string>();
  for (const field of fields) {
    if ((counts.get(field.label) ?? 0) < 2) {
      spoken.set(field.id, field.label);
      continue;
    }
    const nth = (seen.get(field.label) ?? 0) + 1;
    seen.set(field.label, nth);
    spoken.set(field.id, `${field.label} ${nth}`);
  }
  return spoken;
}

function blank(fieldId: string, size: "short" | "long", label: string): string {
  const cls = size === "short" ? "fill-sm" : "fill";
  return (
    `<span class="${cls}" data-field="${escape(fieldId)}"` +
    ` data-label="${escape(label)}">______</span>`
  );
}

/**
 * A field's label in front of its blank.
 *
 * A label ending in a question mark IS the question, and is printed exactly as written:
 * Day 5 asks "Does it use my passions, or just my skills?" and appending a colon to that
 * produced "…my skills?: ______". Any other label names the answer rather than asking
 * for it — "My definition", "One change" — and reads as a bold lead-in, which is how
 * every worksheet wrote them before the migration and why Day 5's "One specific change"
 * stood apart from the three questions above it.
 *
 * `spoken` is what a screen reader announces for the control once #24 binds it, and it
 * differs from the printed label inside a repeat: five list items each printing "Title:"
 * need five distinct names, or a reader tabbing through hears "Title" five times with
 * nothing to say which chapter they are in.
 */
function labelled(
  label: string,
  fieldId: string,
  size: "short" | "long",
  spoken: string = label,
): string {
  const filled = blank(fieldId, size, spoken);
  return label.trimEnd().endsWith("?")
    ? `${escape(label)} ${filled}`
    : `<strong>${escape(label)}:</strong> ${filled}`;
}

/**
 * Render one question.
 *
 * `data-question`, `data-instance` and `data-field` are the seam the storage layer binds
 * to (#24). They are the reason to generate this markup at all — hand-written spans could
 * look the same, but nothing could find them.
 *
 * Inside a repeat, `data-field` alone is NOT unique: every instance of a group renders
 * the same field identifier, by design, because that identifier is frozen (0011). A
 * blank's address is the pair — the `data-instance` on its nearest ancestor, and its
 * own `data-field` (0013).
 */
export function renderQuestion(question: Question): string {
  // A single question renders as a bare answer line. Its label is NOT printed: the
  // prose immediately above it already asks the question ("Patterns — what kind of
  // work…"), so printing the label repeats the word and reads like a stutter. The label
  // is kept in the schema for the form field's accessible name (#24).
  if (question.kind === "single") {
    return (
      `<p class="q-single" data-question="${escape(question.id)}">` +
      `${blank(question.id, question.size, question.label)}</p>`
    );
  }

  if (question.kind === "group") {
    // A plain list of labelled answers. No numbering, because these prompts differ from
    // one another rather than repeating — numbering them would imply an order that is
    // not there.
    const spoken = spokenNames(question.fields);
    const items = question.fields
      .map(
        (x) =>
          `<li>${labelled(x.label, `${question.id}.${x.id}`, x.size, spoken.get(x.id))}</li>`,
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
    const parts = question.template.split(GAP);
    const byId = new Map(question.fields.map((field) => [field.id, field]));
    const spoken = spokenNames(question.fields);
    let html = "";
    for (const [index, part] of parts.entries()) {
      if (index % 2 === 0) {
        html += escape(part);
        continue;
      }
      const field = byId.get(part);
      // A gap with no field is caught by checkSchema before this runs; rendering the
      // literal brace here would only hide it.
      html += field === undefined
        ? ""
        : // A sentence has no label of its own — the template IS the prose — so the
          // field's own label is the whole name. They read as sentence fragments
          // ("Optimizing for", "Over") because that is what the gap is asking for.
          blank(`${question.id}.${part}`, field.size, spoken.get(field.id) ?? field.label);
    }
    return `<p class="q-sentence" data-question="${escape(question.id)}">${html}</p>`;
  }

  // A section-weight repeat gives each instance a heading: "Value 1 — ______", composed
  // from the label, the instance number and the first field. Those headings are how the
  // worksheet has always read, and they are navigation as well as hierarchy — a screen
  // reader moves by them, so rendering five sections as five list rows silently removes
  // five landmarks from the page (docs/decisions/0001).
  //
  // The printed number is display only — nothing stores it. The slot index emitted as
  // `data-instance` is a different thing and IS load-bearing: it is how a blank is told
  // apart from the same field in another instance, and what the client maps to a real
  // instance identifier (docs/decisions/0013).
  if (question.instances === "section") {
    const [name, ...rest] = question.fields;
    const spoken = spokenNames(question.fields);
    // checkSchema refuses a repeat with no fields, so this is unreachable rather than
    // silent — returning "" here would put an empty section where a question should be.
    if (name === undefined) {
      return "";
    }
    const sections: string[] = [];
    for (let index = 0; index < question.min; index += 1) {
      // Every other heading on the site is given an id by the slugger, which never sees
      // this markup — it is injected after parsing. Composing one from the identifier and
      // the instance number keeps these linkable and keeps the build's anchor check able
      // to see them, and unlike the old `id="value-1--______"` it says what it points at.
      const anchor = `${question.id.replace(/\./g, "-")}-${index + 1}`;
      const heading =
        `<h3 id="${escape(anchor)}">${escape(question.label)} ${index + 1} — ` +
        `${blank(`${question.id}.${name.id}`, name.size, `${question.label} ${index + 1} — ${spoken.get(name.id) ?? name.label}`)}</h3>`;
      const fields = rest
        .map(
          (x) =>
            `<li>${labelled(x.label, `${question.id}.${x.id}`, x.size, `${question.label} ${index + 1} — ${spoken.get(x.id) ?? x.label}`)}</li>`,
        )
        .join("\n");
      sections.push(
        `<div class="q-instance" data-instance="${index}">\n${heading}\n<ul>\n${fields}\n</ul>\n</div>`,
      );
    }
    return (
      `<div class="q-repeat" data-question="${escape(question.id)}"` +
      ` data-min="${question.min}" data-max="${question.max}">\n${sections.join("\n")}\n</div>`
    );
  }

  // Otherwise an ordered list, so instance numbering comes from the list rather than
  // from labels baked into the markup — which matters once the reader can add or remove
  // one.
  //
  // No per-instance heading is printed in this shape. Repeating the group's label above
  // its first field produced "Moment / Moment: ____" and "Hard moment / Hard moment:
  // ____"; the list number is identity enough.
  // A field whose label just restates the group's is the same stutter the comment above
  // describes, one line lower down: ten rows reading "Value: ____" under a heading that
  // already says "Narrow to 10". The list number is identity enough.
  const spoken = spokenNames(question.fields);
  const cell = (field: Field, index: number): string => {
    const instance = `${question.label} ${index + 1}`;
    return field.label === question.label
      ? blank(`${question.id}.${field.id}`, field.size, instance)
      : labelled(
          field.label,
          `${question.id}.${field.id}`,
          field.size,
          `${instance} — ${spoken.get(field.id) ?? field.label}`,
        );
  };

  const items: string[] = [];
  for (let index = 0; index < question.min; index += 1) {
    if (question.instances === "line") {
      // Every field on the one line. The em dash is the separator the worksheets already
      // used for this shape, and it survives a line wrap better than a comma.
      items.push(`<li data-instance="${index}">${question.fields.map((x) => cell(x, index)).join(" — ")}</li>`);
      continue;
    }
    if (question.fields.length === 1) {
      const field = question.fields[0];
      if (field === undefined) {
        continue;
      }
      items.push(`<li data-instance="${index}">${cell(field, index)}</li>`);
      continue;
    }
    // The first field sits inline with the list number and the rest nest beneath it.
    // Nesting all of them leaves the number alone on an otherwise empty line, which
    // reads as though something failed to render.
    const [first, ...rest] = question.fields;
    if (first === undefined) {
      continue;
    }
    const head = cell(first, index);
    const nested = rest.map((x) => `<li>${cell(x, index)}</li>`).join("\n");
    items.push(`<li data-instance="${index}">${head}\n<ul>\n${nested}\n</ul>\n</li>`);
  }

  // The permitted range is carried as data, not printed. Rendering "(5–8)" advertises
  // an affordance the page does not yet have — nothing can add a sixth chapter until
  // #24 — and it appeared as unstyled debris between the list and the next heading.
  return (
    `<ol class="q-repeat" data-question="${escape(question.id)}"` +
    ` data-min="${question.min}" data-max="${question.max}">\n${items.join("\n")}\n</ol>`
  );
}
