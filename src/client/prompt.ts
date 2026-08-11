/**
 * The prompt one numbered item becomes.
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

/**
 * The words standing in for a reader's answer in the worked example, and for an id to echo.
 *
 * Exported because the importer needs them to tell two pastes apart that would otherwise look
 * identical: an assistant restating the example it was given, and an assistant that answered a
 * question but left the placeholder group on the block. Both name `EXAMPLE_GROUP` and both are
 * ignored; only the second means an answer was lost. An echo carries these strings and nothing
 * else, so comparing values is the whole of the test — and it has to be one fact in one place,
 * because a prompt and a reader that disagree about what a placeholder looks like would put a
 * warning about missing answers over a reply that is complete.
 */
export const EXAMPLE_ANSWER = "what I said";
export const EXAMPLE_ID = "the id from above";

/** Everything except a checklist, which 0015 keeps out of the contract. */
export type Answerable = Exclude<Question, { readonly kind: "checklist" }>;

export type Refusal =
  | { readonly kind: "unknown-group"; readonly group: string }
  | { readonly kind: "checklist"; readonly group: string }
  | { readonly kind: "wrong-prior"; readonly group: string }
  /**
   * One question twice in the same item — asked for, it produces a reply the importer refuses.
   *
   * The same kind name `agent-answers.ts` uses, because it is the same fact seen from the
   * other end: a paste naming one group twice is refused there, so a prompt asking for two
   * blocks of one question asks for something that cannot be accepted.
   */
  | { readonly kind: "repeated-group"; readonly group: string }
  /**
   * A stored instance identifier that cannot be printed in the prompt as it is.
   *
   * Refused rather than rewritten. `keys.ts` accepts any non-empty identifier without the
   * separator, so a restored backup can hold one carrying a backtick or a line break — and
   * either one has to be altered to sit in the list `priorSection` builds, which turns the
   * identity 0015 · C3 carries outward into one the reply cannot match. Better no prompt than
   * a prompt whose every answer comes back as a new instance beside the reader's own.
   */
  | { readonly kind: "unprintable-instance"; readonly group: string }
  /**
   * Nothing was handed over at all. No group to name, which is why this arm is the only one
   * without one — a caller that built an empty list has a bug the prompt cannot describe.
   *
   * Unreachable from the controls today and kept anyway: it is the only thing between an empty
   * list and a prompt whose "What to ask about" section is blank, which an assistant fills by
   * inventing something to interview about (0007 · C3).
   */
  | { readonly kind: "nothing-to-ask" };

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

/**
 * One question inside a numbered item, with whatever the reader already has for it.
 *
 * A prompt covers a list of these rather than a section identifier, because section
 * membership lives in the markup — `data-section`, which #93 taught the build to emit — and
 * nowhere else. Copying it into `schema.ts` as well would be a second statement of a fact the
 * page already carries, which is the mistake 0009 · C6 and 0013 · `keys.ts` both record. The
 * caller reads the grouping off the DOM it is already walking, and this stays a function from
 * values to a string that can be checked by running it over every item in the workbook.
 */
export type Part = {
  readonly group: string;
  /**
   * Explicitly `| undefined` as well as optional: `exactOptionalPropertyTypes` is on, and the
   * caller builds this from `priorFrom`, which returns `undefined` when there is nothing
   * stored. Without it every call site would have to delete the key instead of setting it.
   */
  readonly prior?: Prior | undefined;
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
 * could hand back a prompt that imports answers to a question they were not looking at. This
 * happens before the preview, so what 0007 · 1 shows is what is sent.
 *
 * The backtick was called "the whole of the mechanism for THAT attack" here, and that stopped
 * being true when 0015 was amended after the first device test: the importer now scans for
 * balanced `{…}` regions and "lets the fences be whatever they are", because copying a
 * rendered chat message gives you the JSON without any backticks at all. A one-line contract
 * object needs no fence to be found, so stripping backticks alone left the attack intact — I
 * confirmed a stored answer carrying one made a pasted-back prompt import a different
 * question. The braces are what the scanner keys on, so the braces are what give way. Rounding
 * them to parentheses is visible in the reader's own words, which is the same trade the
 * backtick rule already makes, and it is a trade worth making: dictated reflection almost
 * never contains a brace, and the alternative is a document that can rewrite an answer the
 * reader never opened.
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
  return answer
    .replace(/`/g, "'")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, `\n${continuation}`);
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
 * How many instances to ask for. `max` since #74 — see the amendment below, which reversed
 * what this line used to say.
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

/** The worksheet's own words for this question, and nothing else. */
function ask(question: Answerable): string {
  return ASKS[question.id] ?? "";
}

/**
 * Whether a question's prose is the one before it, and so can be pointed at rather than repeated.
 *
 * Exported for its own test rather than left inline, because the interesting half cannot be
 * reached through `promptFor`: every question in the workbook has an ask, so nothing built from
 * the schema can exercise two empty ones. Without the emptiness check they would compare equal
 * and the second question would read "the same instruction as question 1 above" pointing at a
 * question that says nothing either — a state that cannot ship, since the build refuses a
 * question with no prose anywhere, but one that costs a condition rather than an argument to
 * keep out.
 */
export function repeatsPrevious(prose: string, previous: string): boolean {
  return prose !== "" && prose === previous;
}

/**
 * What the answer has to contain: its named parts, and — for a repeat — how many of them.
 *
 * Split from the prose above it because consecutive questions can share one instruction and
 * never share a shape. Day 4's contribution question is four sentences under a single line of
 * prose, so all four carry the same ask and four different templates — stating the ask once
 * needs the two halves separable.
 */
function shape(question: Answerable): string {
  const fields =
    question.kind === "single"
      ? ""
      : `\n\nThe answer has these parts:\n\n${question.fields
          .map((field) => `- **${field.label}** — key \`${field.id}\``)
          .join("\n")}`;

  const kindNote =
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

  return `${fields}${kindNote}`;
}

/** The worked example, in the contract's shape but naming a group that cannot be imported. */
function example(question: Answerable, prior: Prior | undefined): string {
  const placeholder = (id: string): string => `"${id}": "${EXAMPLE_ANSWER}"`;
  const body =
    question.kind === "repeat"
      ? `"instances": [\n    { ${
          prior?.for === "instances" && prior.instances.length > 0 ? `"id": "${EXAMPLE_ID}", ` : ""
        }"fields": { ${question.fields.map((field) => placeholder(field.id)).join(", ")} } }\n  ]`
      : question.kind === "single"
        ? `"answer": "${EXAMPLE_ANSWER}"`
        : `"fields": { ${question.fields.map((field) => placeholder(field.id)).join(", ")} }`;

  return `\`\`\`\n{\n  "format": "${FORMAT}",\n  "version": ${VERSION},\n  "group": "${EXAMPLE_GROUP}",\n  ${body}\n}\n\`\`\``;
}

/**
 * `level` is the heading depth this sits at: `##` when the prompt covers one question, `####`
 * when it sits under a `###` per-question heading. A prior nested under a question it does not
 * belong to is the one thing a several-question prompt can get wrong that a single one cannot,
 * and heading depth is what a reader — and an assistant — resolve that by.
 */
function priorSection(question: Answerable, prior: Prior, level: "##" | "####"): string {
  const lines: string[] = [];

  if (prior.for === "instances") {
    for (const instance of prior.instances) {
      // The identifier, not a number. 0015 carries identity in the prompt so a reply updates
      // the instance it names; numbering them would teach the ordinal reference that 0011 was
      // written to prevent and 0013 rejected outright.
      //
      // Listed even where nothing has been written under it, so every slot has an id to come
      // back with. Skipping the empty ones is what made a half-finished group un-importable.
      //
      // VERBATIM, never neutralised. An identifier is structure rather than prose (0015 · C3),
      // and rewriting one defeats the whole reason it travels: an id printed as `a(b)c` comes
      // back as `a(b)c`, fails `planInstances`' lookup against the stored order, and 0015 mints
      // a fresh instance beside the reader's — a duplicate slot, their answers orphaned under
      // the old id, and the whole thing reported as "1 new entry". That is exactly the failure
      // the paragraph below this list warns the assistant about, arriving through the defence.
      // `promptFor` refuses an id that cannot be printed here instead.
      //
      // Safe to print raw: an id carrying braces cannot forge an importable block, because
      // `keys.ts` forbids the separator in an identifier and every real group id contains one,
      // so any object built out of an id names a group the schema does not hold.
      lines.push(`- id \`${instance.id}\``);
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
      `\n${level} The ones I already have, and their ids\n\n${lines.join("\n")}\n\n` +
      `Return **every** id above, each with its own answers — the ones already written as they` +
      ` are unless I change them, and the empty ones filled in. Keep each id with the answer it` +
      ` belongs to. An answer that comes back without its id is treated as a new one and added` +
      ` beside the old, which is not what either of us wants.\n`
    );
  }
  return (
    `\n${level} What I have already written\n\n${lines.join("\n")}\n\n` +
    `Ask me about these too — I may want to change them. Return every one you and I discussed,` +
    ` changed or not.\n`
  );
}

/** One question of a numbered item, resolved against the schema. */
type Asked = { readonly question: Answerable; readonly prior: Prior | undefined };

/** How to run the interview. The extra rule is only true where there is an order to keep. */
function howToRunIt(count: number): string {
  return (
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
    (count > 1
      ? // "Question" now means two things in one prompt — a numbered question of the worksheet,
        // and a thing you ask in a message — so the rule that separates them is spelled out.
        // Without the last sentence an assistant can read "work through them in order" as
        // licence to put a whole numbered question in one message, which is the wall of text
        // 0001 exists to prevent.
        `- The numbered questions below are one exercise. Work through them in the order given\n` +
        `  and finish one before starting the next — the worksheet's order is how it builds.\n` +
        `  That is about the order you cover them in, not about how much you ask at once: it is\n` +
        `  still one thing per message.\n`
      : "") +
    `- When we have covered everything below, say so and offer me the ${count > 1 ? "blocks" : "block"}.\n\n`
  );
}

/**
 * The questions themselves, in the order the page asks them.
 *
 * One question is the whole of its numbered item, and its own ask is all the context there is —
 * so that prompt is byte for byte the prompt this file produced before items existed, checked
 * across all 113 questions with answers carried and withheld. (The one deliberate exception is
 * `neutralise` now defusing braces, which changes any prompt carrying an answer that has one.)
 * Naming the item over a single question would put a heading above prose that is already the
 * heading: every ask is read back off the page (0004 · C8), and the first question under a
 * numbered heading carries that heading in its ask already.
 */
function questions(item: string, parts: readonly Asked[]): string {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only !== undefined) {
    return (
      `## What to ask about\n\n${ask(only.question)}${shape(only.question)}\n` +
      `${only.prior === undefined ? "" : priorSection(only.question, only.prior, "##")}`
    );
  }

  // Named unless the first question's ask already opens with that name, which it does on 14 of
  // the 24 items that ask more than one question: #91 gives a question with no prose of its own
  // the prose above it, and for the first question under a numbered heading that prose IS the
  // heading. Printing both put the item's name twice, three lines apart — the duplication this
  // function's own comment gives as the reason not to name a single question's item at all.
  // The reader's words are never edited to make room for ours (0004), so it is our line that
  // gives way; where the two do not match, both are printed and the prompt is merely repetitive.
  // Compared with the emphasis taken off both sides. The two strings are one heading rendered
  // twice — the caller reads it out of the DOM with its markup stripped, and #91 reads it out
  // of the Markdown with its markup intact — so rigorous day 3's "weighted *least*" arrives as
  // "weighted least" from one and "weighted *least*" from the other, `startsWith` fails, and
  // the item gets named twice in two spellings three lines apart. That is the duplication this
  // branch exists to prevent, so the comparison ignores what the two renderings disagree about.
  // An empty name needs no guard of its own: every string starts with "".
  const first = parts[0];
  const plain = (text: string): string => text.replace(/[*_`]/g, "");
  const named = first !== undefined && !plain(ask(first.question)).startsWith(plain(item));
  const blocks: string[] = [
    // Two wrapped paragraphs rather than one with a swappable opening: the prompt is hard
    // wrapped, and prose wrapped for one lead-in reads as a wall when it is given another.
    // The item's name gets a line of its own for the same reason — its length is the one
    // thing not known here, so wrapping fixed prose around it would put the break in a
    // different place on every worksheet.
    `## What to ask about\n\n` +
      (named
        ? `This is one numbered item of the worksheet:\n\n**${neutralise(item)}**\n\n` +
          `It asks ${parts.length} questions. They are one exercise rather than ${parts.length} separate ones,\n` +
          `so what I say about an earlier question is context for the ones after it.\n`
        : `This is one numbered item of the worksheet, and it asks ${parts.length} questions. They are\n` +
          `one exercise rather than ${parts.length} separate ones, so what I say about an earlier question\n` +
          `is context for the ones after it.\n`),
  ];
  // Which question last printed the shared prose, so a third question sharing it points at the
  // one that HAS it. Day 4's contribution question is four sentences under one line of prose;
  // pointing each at "the question above" made questions 3 and 4 point at question 2, which is
  // itself only a pointer, so an assistant had to hop twice to reach an instruction.
  let saidAt = 0;
  let said = "";
  for (const [index, part] of parts.entries()) {
    const prose = ask(part.question);
    const repeated = repeatsPrevious(prose, said);
    blocks.push(
      `### Question ${index + 1} of ${parts.length} — \`${part.question.id}\`\n\n` +
        `${repeated ? `The same instruction as question ${saidAt} above.` : prose}` +
        `${shape(part.question)}\n` +
        `${part.prior === undefined ? "" : priorSection(part.question, part.prior, "####")}`,
    );
    if (!repeated) {
      said = prose;
      saidAt = index + 1;
    }
  }
  return blocks.join("\n");
}

/**
 * The contract, and a worked example of it per question.
 *
 * Every example names `EXAMPLE_GROUP` rather than the question it stands for, which is
 * 0015 · C8a: a reader who mis-taps and pastes the prompt back gets a refusal instead of an
 * example silently imported as their answers. The real identifier is named in the prose above
 * each example, where no `{` can carry it into a block the importer would scan.
 */
function howToAnswer(parts: readonly Asked[]): string {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only !== undefined) {
    return (
      `## How to give the answers back\n\n` +
      `At the end, output one fenced block — the last thing in your reply, and the only fenced\n` +
      `block in it. Change two things from this example: put \`"group": "${only.question.id}"\`, and\n` +
      `put my real answers where the placeholders are.\n\n${example(only.question, only.prior)}\n\n` +
      `Every value is plain text on one line. If I did not answer something, **leave that key\n` +
      `out entirely** — never send an empty string, a dash, or a guess. Say anything else you\n` +
      `want to say outside the block.\n`
    );
  }

  const shown = parts.map(
    (part, index) =>
      `Question ${index + 1} of ${parts.length} — put \`"group": "${part.question.id}"\`:\n\n` +
      example(part.question, part.prior),
  );
  return (
    `## How to give the answers back\n\n` +
    `At the end, output one fenced block for each of the ${parts.length} questions above, in the same\n` +
    `order — the last thing in your reply, and the only fenced blocks in it. In each one, put\n` +
    `the group named above it where the example has its own, and put what I actually said\n` +
    `wherever the example says "${EXAMPLE_ANSWER}". Where a block shows an id, copy the id of\n` +
    `the entry you are answering exactly as it is written above — that is what carries my\n` +
    `answer to the right entry, and inventing one loses it. If we never got to one of the\n` +
    `questions, leave its block out altogether rather than sending an empty one.\n\n` +
    `${shown.join("\n\n")}\n\n` +
    `Every value is plain text on one line. If I did not answer something, **leave that key\n` +
    `out entirely** — never send an empty string, a dash, or a guess. Say anything else you\n` +
    `want to say outside the blocks.\n`
  );
}

/**
 * Build the prompt for one numbered item — every question it asks, in page order.
 *
 * `item` is what the worksheet calls it, e.g. "3. The contribution question (15 min)", read
 * off the heading by the caller. It is unused where the item holds a single question; see
 * `questions` for why.
 *
 * A part's `prior` is omitted unless the reader opted in, per 0007 · 2 — generating a prompt
 * for one task must never quietly bundle four days of reflection, and the default is off
 * rather than a setting somebody has to find.
 */
export function promptFor(item: string, parts: readonly Part[]): Generated {
  const asking: Asked[] = [];
  let checklist: string | undefined;

  for (const part of parts) {
    const question = findQuestion(part.group);
    if (question === undefined) {
      // Refused rather than skipped, and it refuses the whole item: an identifier on the page
      // that this build cannot resolve means the markup and the schema disagree, which is
      // reachable across a service worker activation. Asking about the rest would hide it.
      return { ok: false, refusal: { kind: "unknown-group", group: part.group } };
    }
    if (question.kind === "checklist") {
      // 0015 keeps checklists out of the contract: readiness ticks are the reader's to work
      // through, not something to answer on their behalf. Dropped rather than refused, because
      // a numbered item may hold one beside real questions and refusing would cost the reader
      // the whole item over a part that was never on offer. Where it is ALL the item holds,
      // the refusal below still says so by name.
      checklist ??= part.group;
      continue;
    }
    // A caller holding the wrong shape has read the store wrongly; saying so beats rendering a
    // repeat's answers as though the question had none.
    const wants = question.kind === "repeat" ? "instances" : "fields";
    if (part.prior !== undefined && part.prior.for !== wants) {
      return { ok: false, refusal: { kind: "wrong-prior", group: part.group } };
    }
    if (asking.some((one) => one.question.id === question.id)) {
      return { ok: false, refusal: { kind: "repeated-group", group: part.group } };
    }
    // A backtick would close the code span the id sits in; a line break would end the list item
    // and open what looks like another instance, which is the forgery `neutralise`'s indent
    // exists to stop. Neither can be defused without changing the identifier, so neither is.
    if (part.prior?.for === "instances" && part.prior.instances.some((one) => /[`\r\n]/.test(one.id))) {
      return { ok: false, refusal: { kind: "unprintable-instance", group: part.group } };
    }
    asking.push({ question, prior: part.prior });
  }

  if (asking.length === 0) {
    return checklist === undefined
      ? { ok: false, refusal: { kind: "nothing-to-ask" } }
      : { ok: false, refusal: { kind: "checklist", group: checklist } };
  }

  return {
    ok: true,
    text: `${howToRunIt(asking.length)}${questions(item, asking)}\n${howToAnswer(asking)}`,
  };
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
    case "repeated-group":
      return `${refusal.group} appears twice in this numbered item, and one question can only be answered once.`;
    case "unprintable-instance":
      return `The entries saved for ${refusal.group} are identified in a way that cannot be put into a message safely, so nothing in this numbered item can be asked about.`;
    case "nothing-to-ask":
      return "There is no question here for an assistant to ask about.";
  }
}
