/**
 * Reading an assistant's reply, and working out what it would change.
 *
 * The whole surface of somebody else's text meeting answers the reader wrote themselves, so
 * the refusals carry as much weight here as the happy path — every one of them is a case
 * where accepting would either lose words or store something the reader never said.
 *
 * Fixtures are real question identifiers rather than invented ones. The shape a block must
 * take is decided by the group's kind (0015), so a test against a made-up question would be
 * testing the test's idea of the schema instead of the schema. Those identifiers are the one
 * thing shared at module level: they are domain fixtures rather than the magic numbers the
 * standard is about, and spelling `day1.chapters` forty times would obscure more than it
 * reveals. Every numeric constant is local to the test that uses it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readBlocks,
  planFor,
  explain,
  type Block,
  type Plan,
  type Refusal,
} from "./agent-answers.ts";
import { answerKey, orderKey, writeOrder } from "./keys.ts";

const SINGLE = "day4.eulogy";
const GROUP = "day5.career";
const SENTENCE = "day4.enough_and_more_1";
const REPEAT = "day1.chapters";
const CHECKLIST = "day5.ready";

/** A block as an assistant would send it, wrapped the way one actually replies. */
function reply(body: Record<string, unknown>, fence = "json"): string {
  return `Happy to help — here is what we worked out.\n\n\`\`\`${fence}\n${JSON.stringify(body, null, 2)}\n\`\`\`\n\nLet me know if you want to go again.`;
}

function block(group: string, rest: Record<string, unknown>): Record<string, unknown> {
  return { format: "life-compass/agent-answers", version: 1, group, ...rest };
}

/** Several blocks in one paste, with prose between them. */
function pasteOf(...bodies: Record<string, unknown>[]): string {
  return bodies
    .map((body, index) => `Part ${index}:\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``)
    .join("\n\n");
}

function blocksIn(text: string): readonly Block[] {
  const read = readBlocks(text);
  assert.ok(read.ok, `refused: ${read.ok ? "" : explain(read.refusal)}`);
  return read.blocks;
}

function refusalFor(text: string): Refusal {
  const read = readBlocks(text);
  assert.ok(!read.ok, "the text was accepted");
  return read.refusal;
}

/** Plan a text against stored entries, asserting it was not refused. */
function planning(text: string, entries: ReadonlyMap<string, string>): Plan {
  const planned = planFor(blocksIn(text), entries);
  assert.ok(planned.ok, `refused: ${planned.ok ? "" : explain(planned.refusal)}`);
  return planned.plan;
}

/** The refusal a plan produces, asserting it was refused rather than accepted. */
function refusedPlan(text: string, entries: ReadonlyMap<string, string>): Refusal {
  const planned = planFor(blocksIn(text), entries);
  assert.ok(!planned.ok, "the plan was accepted");
  return planned.refusal;
}

/** The single answer a block carries, whatever shape it took. */
function answerOf(one: Block | undefined): string {
  assert.ok(one?.for === "answer", "the block is not a single answer");
  return one.answer;
}

describe("finding blocks in a reply", () => {
  it("readBlocks_AFenceLabelledJson_IsStillFoundByItsContent", () => {
    // Arrange — 0015 makes this the load-bearing choice: asked for ```life-compass an
    // assistant writes ```json. Requiring the info string would require them to be reliable
    // about the one thing they demonstrably are not.
    const ANSWER = "That I showed up for the people who needed it.";
    const ONE = 1;

    // Act
    const blocks = blocksIn(reply(block(SINGLE, { answer: ANSWER })));

    // Assert
    assert.equal(blocks.length, ONE);
    assert.equal(blocks[0]?.group, SINGLE);
    assert.equal(answerOf(blocks[0]), ANSWER);
  });

  it("readBlocks_AReplyCopiedFromAChatWindowWithNoFences_IsStillRead", () => {
    // Arrange — the ordinary way a reader copies a reply, and the first thing that happened on
    // a device. A fence is MARKDOWN SOURCE: copying a rendered chat message gives you the JSON
    // without the backticks, because the backticks were never on screen. Requiring them made
    // the whole feature answer "there is nothing from an assistant in that" to a paste that
    // contained exactly what was asked for.
    const ANSWER = "That I showed up for the people who needed me.";
    const ONE = 1;
    const text = `Great — here is what we worked out.\n\n${JSON.stringify(block(SINGLE, { answer: ANSWER }))}\n\nLet me know if you would like to revise it.`;

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.equal(blocks.length, ONE);
    assert.equal(answerOf(blocks[0]), ANSWER);
  });

  it("readBlocks_AnAnswerContainingABraceAndAQuote_DoesNotThrowTheScanOff", () => {
    // Arrange — the scan counts braces, so anything inside a string has to be invisible to it.
    // Both halves matter and a balanced pair proves neither: this carries an UNMATCHED `}`, so
    // a scan that read string contents as structure would close the object early, and an
    // escaped quote before it, so a scan that mishandled `\\"` would leave the string at the
    // wrong moment and count that brace anyway. Either way the object never parses and the
    // reader is told there is nothing from an assistant in their reply.
    const ANSWER = 'He said "we are done}" and left, and I have thought about it since.';
    const ONE = 1;

    // Act
    const blocks = blocksIn(reply(block(SINGLE, { answer: ANSWER })));

    // Assert
    assert.equal(blocks.length, ONE);
    assert.equal(answerOf(blocks[0]), ANSWER);
  });

  it("readBlocks_TheWorkedExampleRepeatedBesideARealAnswer_IsIgnoredAndNotCountedAgainst", () => {
    // Arrange — an assistant restating the shape it was given. 0015 · C8a puts a group the
    // schema does not contain into the example precisely so it can never be imported; refusing
    // the whole paste because the assistant was thorough would make a verbose reply unusable.
    //
    // And not reported as a lost answer either, which is the harder half. #82 makes every
    // example in a prompt name this group, so being ignored stopped meaning "the assistant was
    // chatty" and started ALSO meaning "one of your four questions did not come back". What
    // separates them is the words: an echo carries the prompt's own placeholders and nothing
    // else. Counting this one would put a warning about missing answers over a complete
    // import, in exactly the case this ignoring exists to serve — and a warning that fires on
    // the ordinary reply is one nobody reads on the day it is true.
    const ANSWER = "the real one";
    const ONE = 1;
    const NONE = 0;
    const text = pasteOf(
      { format: "life-compass/agent-answers", version: 1, group: "example.not_a_real_group", answer: "what I said" },
      block(SINGLE, { answer: ANSWER }),
    );

    // Act
    const read = readBlocks(text);

    // Assert
    assert.ok(read.ok, "the paste was refused");
    assert.equal(read.blocks.length, ONE, "the worked example was imported");
    assert.equal(answerOf(read.blocks[0]), ANSWER);
    assert.equal(read.stranded, NONE, "a restated example was reported as a lost answer");
  });

  it("readBlocks_AnExampleRestatedWithARealIdEchoed_IsStillReadAsTheExample", () => {
    // Arrange — the other half of the placeholder test, and the one a careless version gets
    // wrong: a repeat's example carries `"id": "the id from above"` as well as its answers, so
    // an echo of THAT has two distinct placeholder strings in it. Testing only the answer would
    // report the id as a lost answer every time an assistant restated a repeat's shape.
    const NONE = 0;
    const ONE = 1;
    const text = pasteOf(
      {
        format: "life-compass/agent-answers",
        version: 1,
        group: "example.not_a_real_group",
        instances: [{ id: "the id from above", fields: { title: "what I said", learned: "what I said" } }],
      },
      block(SINGLE, { answer: "the real one" }),
    );

    // Act
    const read = readBlocks(text);

    // Assert
    assert.ok(read.ok);
    assert.equal(read.blocks.length, ONE);
    assert.equal(read.stranded, NONE, "a restated repeat example was reported as a lost answer");
  });

  it("readBlocks_ARealAnswerForEveryQuestion_ReportsNothingLeftOut", () => {
    // Arrange — the negative case for that count, and the ordinary one: a reply to a numbered
    // item that substituted every group. A count that was always non-zero would put a warning
    // about missing answers on every successful import, which is the surest way to teach a
    // reader to ignore it.
    const NONE = 0;
    const text = pasteOf(block(SINGLE, { answer: "one" }), block(SENTENCE, { fields: { excess: "two" } }));

    // Act
    const read = readBlocks(text);

    // Assert
    assert.ok(read.ok);
    assert.equal(read.stranded, NONE, "a reply that left nothing out says it did");
  });

  it("readBlocks_SomeGroupsStillNamedTheExample_ImportsTheRestAndSaysOneWasLeftOut", () => {
    // Arrange — the failure #82's prompt makes ordinary, and the reason the count exists at
    // all. Every example in a several-question prompt names the placeholder group, so an
    // assistant that substitutes two of three leaves one block that cannot be attributed. It
    // used to be dropped in silence: the reader saw two questions in the tally, approved, and
    // found the third still blank later. 0008 calls that the worst failure available here.
    const IMPORTED = 2;
    const LEFT_OUT = 1;
    const text = pasteOf(
      block(SINGLE, { answer: "one" }),
      { format: "life-compass/agent-answers", version: 1, group: "example.not_a_real_group", fields: { excess: "two" } },
      block(SENTENCE, { fields: { excess: "three" } }),
    );

    // Act
    const read = readBlocks(text);

    // Assert
    assert.ok(read.ok, "the answers that did come back were refused with the one that did not");
    assert.equal(read.blocks.length, IMPORTED);
    assert.equal(read.stranded, LEFT_OUT, "the question that did not come back is not reported");
  });

  it("readBlocks_TheWorkedExampleOnItsOwn_IsStillRefusedLoudly", () => {
    // Arrange — negative case, and the mis-paste 0015 · C8a actually describes: the reader taps
    // copy, then pastes the PROMPT back into the box seconds later. Ignoring it here would
    // leave them staring at a box that appeared to do nothing.
    //
    // The refusal names what is actually in the paste. It used to fall through to
    // "there is nothing from an assistant in that", which is half true of a document that
    // plainly is from one and only says so because the ignoring left nothing behind.
    const text = reply({
      format: "life-compass/agent-answers",
      version: 1,
      group: "example.not_a_real_group",
      answer: "what I said",
    });

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "example-only");
    assert.match(explain(refusal), /example question/i);
  });

  it("readBlocks_AnEmptyBlockNamingTheExample_IsNotReportedAsAnAnswerThatWasLost", () => {
    // Arrange — the boundary of the placeholder test. A block naming the example group and
    // carrying no answers at all held nothing, so nothing was stranded in it; counting it told
    // the reader an answer went missing when the block never had one. The other side of the
    // boundary — a block carrying even one word of the reader's — is the case the count exists
    // for, and is asserted beside it so neither can drift into the other.
    const NONE = 0;
    const ONE = 1;
    const empty = { format: "life-compass/agent-answers", version: 1, group: "example.not_a_real_group" };
    const carrying = { ...empty, fields: { excess: "noise and hurry" } };

    // Act
    const withEmpty = readBlocks(pasteOf(block(SINGLE, { answer: "real" }), empty));
    const withAnswer = readBlocks(pasteOf(block(SINGLE, { answer: "real" }), carrying));

    // Assert
    assert.ok(withEmpty.ok && withAnswer.ok);
    assert.equal(withEmpty.stranded, NONE, "a block that held nothing was called a lost answer");
    assert.equal(withAnswer.stranded, ONE, "a block holding the reader's words was not counted");
  });

  it("readBlocks_EveryBlockStillNamingTheExample_SaysThatRatherThanNothingWasFound", () => {
    // Arrange — what a numbered item's prompt looks like pasted back: several example blocks
    // and no real one. Every one is skipped, so nothing is left — and "there is nothing from an
    // assistant in that" is only half true, because there plainly is, it just names the
    // placeholder throughout. One sentence has to serve this and a reply that substituted no
    // groups at all, since the text cannot tell them apart.
    const text = pasteOf(
      { format: "life-compass/agent-answers", version: 1, group: "example.not_a_real_group", answer: "what I said" },
      { format: "life-compass/agent-answers", version: 1, group: "example.not_a_real_group", fields: { excess: "…" } },
    );

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "example-only");
    assert.match(explain(refusal), /example question/i, "the refusal does not say what is wrong with it");
  });

  it("readBlocks_AWholeDayInOnePaste_ReadsEveryBlockInOrder", () => {
    // Arrange — 0015 · C1 makes a day's reply an ordinary use of version 1 rather than a
    // future addition, and the prose between blocks is what an assistant actually sends.
    const text = pasteOf(
      block(SINGLE, { answer: "a" }),
      block(SENTENCE, { fields: { excess: "noise", lack: "care" } }),
    );

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.deepEqual(blocks.map((one) => one.group), [SINGLE, SENTENCE]);
  });

  it("readBlocks_ProseFencesAndBlocksThatAreNotOurs_AreIgnoredNotRefused", () => {
    // Arrange — assistants quote, illustrate and explain. A fence that will not parse, or
    // parses without this format, is ordinary noise rather than an error to report.
    const ONE = 1;
    const text = [
      "```python",
      "print('not json at all')",
      "```",
      "```json",
      JSON.stringify({ format: "life-compass/answers", version: 1, payload: {} }),
      "```",
      "```json",
      JSON.stringify(block(SINGLE, { answer: "the real one" })),
      "```",
    ].join("\n");

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.equal(blocks.length, ONE, "noise was read as an answer");
    assert.equal(answerOf(blocks[0]), "the real one");
  });

  it("readBlocks_ALongerFenceAroundAPlainBlock_IsRead", () => {
    // Arrange — a four-backtick fence with nothing nested inside it. Named for what the
    // fixture actually contains: it used to claim the nested case, which it does not exercise
    // at all — the rule that makes nesting work is pinned by the test below, and this one
    // passed with that rule mutated away.
    const ONE = 1;
    const text = ["````json", JSON.stringify(block(SINGLE, { answer: "outer" })), "````"].join(
      "\n",
    );

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.equal(blocks.length, ONE);
    assert.equal(answerOf(blocks[0]), "outer");
  });

  it("readBlocks_AWrappedExampleBeforeTheRealBlock_SkipsTheExampleAndKeepsTheAnswer", () => {
    // Arrange — the case the fence-length rule exists for, and the realistic one: an
    // assistant explains the format by wrapping an illustrative block in a LONGER fence,
    // then sends the real one. A closing fence that only had to be three backticks would end
    // the wrapper at the example's inner fence, leaving the rest of the paste in pieces —
    // and the reader's actual answer refused as `no-blocks`. Verified: that mutation loses
    // this block entirely.
    const ANSWER = "the real one";
    const ONE = 1;
    const text = [
      "````",
      "A block looks like this:",
      "```json",
      '{"format":"life-compass/agent-answers","version":1,"group":"example.not_a_real_group","answer":"what I said"}',
      "```",
      "````",
      "",
      "And here is yours:",
      "```json",
      JSON.stringify(block(SINGLE, { answer: ANSWER })),
      "```",
    ].join("\n");

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.equal(blocks.length, ONE, "the worked example was imported, or the answer was lost");
    assert.equal(blocks[0]?.group, SINGLE);
    assert.equal(answerOf(blocks[0]), ANSWER);
  });

  it("readBlocks_AFenceIndentedUnderAListItem_IsStillFound", () => {
    // Arrange — assistants indent code blocks under numbered lists constantly.
    const ONE = 1;
    const text = ["1. Here it is:", "", "   ```json", `   ${JSON.stringify(block(SINGLE, { answer: "indented" }))}`, "   ```"].join("\n");

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.equal(blocks.length, ONE);
    assert.equal(answerOf(blocks[0]), "indented");
  });

  it("readBlocks_APasteWithWindowsLineEndings_IsRead", () => {
    // Arrange — a paste from a Windows clipboard carries CRLF, and a scanner that splits on
    // "\n" alone leaves a "\r" on every line, which stops a closing fence matching.
    const ONE = 1;
    const text = reply(block(SINGLE, { answer: "crlf" })).replace(/\n/g, "\r\n");

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.equal(blocks.length, ONE);
    assert.equal(answerOf(blocks[0]), "crlf");
  });

  it("readBlocks_NothingMatchingAtAll_IsRefusedRatherThanReportedAsSuccess", () => {
    // Arrange — negative case, and the one 0015 singles out: what must not happen is
    // silence. A paste that yields nothing has to say so.
    // Act
    const refusal = refusalFor("Sure! I think your chapters are about growth and loss.");

    // Assert
    assert.equal(refusal.kind, "no-blocks");
  });

  it("readBlocks_AReplyCutOffMidAnswer_IsRefusedRatherThanPartlyAccepted", () => {
    // Arrange — negative case, and a silent one before it was found. Everything after an
    // unclosed fence is consumed as its body, so a truncated streamed reply used to return
    // `ok` with the later blocks simply gone and nothing said. Reporting success on the
    // blocks that survived tells the reader their whole reply arrived.
    const text = [
      "```json",
      JSON.stringify(block(SINGLE, { answer: "this one parsed" })),
      "```",
      "And the rest:",
      '{"format":"life-compass/agent-answers","version":1,"group":"day5.career","fields":{"change":"cut off mid',
    ].join("\n");

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "cut-off");
    assert.match(explain(refusal), /cut off/);
  });

  it("readBlocks_OneMalformedBlockAmongGoodOnes_RefusesTheWholePaste", () => {
    // Arrange — negative case. Partial acceptance would mean telling the reader some of
    // their reply landed and leaving them to work out which. `import.ts` establishes
    // all-or-nothing as the property this application keeps.
    const text = pasteOf(
      block(SINGLE, { answer: "this one is fine" }),
      block(REPEAT, { answer: "a repeat cannot take an answer" }),
    );

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "wrong-shape");
    assert.equal(refusal.kind === "wrong-shape" ? refusal.group : "", REPEAT);
  });

  it("readBlocks_TwoBlocksAnsweringOneQuestion_AreRefusedRatherThanChosenBetween", () => {
    // Arrange — negative case, and the defect that made this refusal exist. Two answers to
    // one question is a contradiction with nothing to choose between, the same reasoning
    // `several-shapes` applies within a block. Left to run it was silent and destructive:
    // for a repeat, the second block recomputed the instance order from the ORIGINAL store
    // and overwrote the first block's, stranding its answers under identifiers nothing
    // referenced — the orphaning 0013 · Q3 exists to prevent.
    const text = pasteOf(
      block(REPEAT, { instances: [{ fields: { title: "from the first block" } }] }),
      block(REPEAT, { instances: [{ fields: { title: "from the second" } }] }),
    );

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "repeated-group");
    assert.equal(refusal.kind === "repeated-group" ? refusal.group : "", REPEAT);
  });

  it("readBlocks_TwoEntriesClaimingOneInstance_AreRefused", () => {
    // Arrange — negative case, the same contradiction one level down. Left to run, the later
    // entry replaced the earlier in the writes while BOTH were listed to the reader as
    // changes they were agreeing to.
    const MINE = "5f1c8e2a-0000-4000-8000-000000000001";
    const text = reply(
      block(REPEAT, {
        instances: [
          { id: MINE, fields: { title: "first" } },
          { id: MINE, fields: { title: "second" } },
        ],
      }),
    );

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "repeated-instance");
  });
});

describe("refusing a block", () => {
  it("readBlocks_AGroupThisBuildDoesNotHave_IsRefused", () => {
    // Arrange — a frozen identifier (0011) this build lacks is either a typo an assistant
    // introduced or a question retired since, and those are different problems.
    const MISSING = "day9.nothing_like_this";

    // Act
    const refusal = refusalFor(reply(block(MISSING, { answer: "x" })));

    // Assert
    assert.equal(refusal.kind, "unknown-group");
    assert.equal(refusal.kind === "unknown-group" ? refusal.group : "", MISSING);
  });

  it("readBlocks_AChecklistGroup_IsRefused", () => {
    // Arrange — 0015 keeps these out of the contract: readiness ticks the reader works
    // through, not questions an assistant answers on their behalf.
    // Act
    const refusal = refusalFor(reply(block(CHECKLIST, { fields: { x: "y" } })));

    // Assert
    assert.equal(refusal.kind, "checklist");
  });

  it("readBlocks_AVersionFromTheFuture_IsRefused", () => {
    // Arrange
    const AHEAD = 2;

    // Act
    const refusal = refusalFor(reply({ ...block(SINGLE, { answer: "x" }), version: AHEAD }));

    // Assert
    assert.equal(refusal.kind, "newer-version");
    assert.equal(refusal.kind === "newer-version" ? refusal.found : 0, AHEAD);
  });

  it("readBlocks_AnImpossibleVersion_IsRefusedAlongsideTheFuture", () => {
    // Arrange — negative case. `readEnvelope`'s reason, which 0015 adopts: refusing the
    // future without refusing the impossible would let the impossible through. No build
    // ever wrote one of these, so it is damaged or hand-made rather than old.
    const IMPOSSIBLE = [0, -1, 1.5, "1", undefined, Number.NaN];

    // Act & Assert
    for (const version of IMPOSSIBLE) {
      const refusal = refusalFor(reply({ ...block(SINGLE, { answer: "x" }), version }));
      assert.equal(refusal.kind, "bad-version", `version ${String(version)} was accepted`);
    }
  });

  it("readBlocks_ABlockAnsweringInTwoWaysAtOnce_IsRefusedRatherThanChosenBetween", () => {
    // Arrange — negative case. Which to believe is not a question with a defensible answer,
    // and guessing is how an assistant's stray key becomes the reader's stored words.
    // Act
    const refusal = refusalFor(reply(block(SINGLE, { answer: "one", fields: { excess: "two" } })));

    // Assert
    assert.equal(refusal.kind, "several-shapes");
  });

  it("readBlocks_ABlockCarryingNoAnswersAtAll_IsRefused", () => {
    // Arrange — negative case, in all four shapes it can take: nothing at all, an empty
    // field map, an empty instance list, and an instance answering nothing. Each would
    // otherwise be a confirmation surface for a paste that does nothing, and the last mints
    // an instance holding no words — a slot taken out of the count the page renders.
    const EMPTY: readonly (readonly [string, Record<string, unknown>])[] = [
      [SINGLE, {}],
      [SENTENCE, { fields: {} }],
      [REPEAT, { instances: [] }],
    ];

    // Act & Assert
    for (const [group, shape] of EMPTY) {
      const refusal = refusalFor(reply(block(group, shape)));
      assert.equal(refusal.kind, "no-answers", `${group} ${JSON.stringify(shape)} was accepted`);
    }
  });

  it("readBlocks_OneEmptyEntryAmongSeveral_BlamesTheEntryRatherThanTheBlock", () => {
    // Arrange — negative case. An entry answering nothing would mint an instance holding no
    // words, taking a slot out of the count the page renders. It used to refuse as
    // `no-answers`, whose message says the block carries none — untrue when it carries three,
    // and it sends the reader looking for an empty block that is not there.
    const text = reply(
      block(REPEAT, {
        instances: [{ fields: { title: "a real one" } }, { fields: {} }],
      }),
    );

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "empty-instance");
    assert.match(explain(refusal), /One of the entries/);
  });

  it("readBlocks_AShapeThatDoesNotMatchTheGroupsKind_IsRefused", () => {
    // Arrange — the block deliberately does not restate the kind (0015): the schema already
    // says it, and two copies of one fact can disagree. So the shape is checked against the
    // schema instead. The last two are the shapes that are the right KEY but the wrong type.
    const WRONG: readonly (readonly [string, Record<string, unknown>, string])[] = [
      [SINGLE, { fields: { excess: "x" } }, "answer"],
      [GROUP, { answer: "x" }, "fields"],
      [REPEAT, { fields: { title: "x" } }, "instances"],
      [SENTENCE, { instances: [{ fields: { excess: "x" } }] }, "fields"],
      [SENTENCE, { fields: ["not an object"] }, "fields"],
      [REPEAT, { instances: ["not an object"] }, "instances"],
    ];

    // Act & Assert
    for (const [group, shape, expected] of WRONG) {
      const refusal = refusalFor(reply(block(group, shape)));
      assert.equal(refusal.kind, "wrong-shape", `${group} accepted ${JSON.stringify(shape)}`);
      assert.equal(
        refusal.kind === "wrong-shape" ? refusal.expected : "",
        expected,
        `${group} was told to send the wrong thing`,
      );
    }
  });

  it("readBlocks_AFieldTheQuestionDoesNotAsk_IsRefusedRatherThanDropped", () => {
    // Arrange — negative case. Keys the CONTRACT does not name are ignored so a later
    // version is cheap to add, but a field this group does not have is an assistant
    // answering a question that does not exist. Dropping it silently loses words the reader
    // believes travelled. `__proto__` and `constructor` land here too, which is what keeps
    // a JSON key from ever reaching an object as a property name.
    const INVENTED = ["invented", "__proto__", "constructor", "prototype"];

    // Act & Assert
    for (const field of INVENTED) {
      const refusal = refusalFor(
        reply(block(SENTENCE, { fields: { excess: "noise", [field]: "nowhere" } })),
      );
      assert.equal(refusal.kind, "unknown-field", `${field} was accepted`);
    }
  });

  it("readBlocks_AValueThatIsNotUsableText_IsRefusedForEveryValueNotASample", () => {
    // Arrange — negative case. One good value proves nothing about the rest. The empty
    // string matters most: `store.ts` deletes on empty, so permitting it would hand an
    // assistant a delete primitive through a format that says below it has none.
    const UNUSABLE: readonly unknown[] = ["", 42, null, ["a"], { a: "b" }, true];

    // Act & Assert
    for (const value of UNUSABLE) {
      const refusal = refusalFor(reply(block(SENTENCE, { fields: { excess: "fine", lack: value } })));
      assert.equal(refusal.kind, "bad-value", `${JSON.stringify(value)} was accepted`);
    }
  });

  it("readBlocks_AnEmptyAnswerOnASingle_IsRefusedBecauseAnEmptyValueDeletes", () => {
    // Arrange — negative case, and the one shape that could otherwise reach `store.merge`
    // carrying a value that DELETES. The field-map check covers group and sentence; a single
    // takes a different path and had no test, so removing its empty check went unnoticed.
    const UNUSABLE: readonly unknown[] = ["", 42, null, { a: "b" }];

    // Act & Assert
    for (const answer of UNUSABLE) {
      const refusal = refusalFor(reply(block(SINGLE, { answer })));
      assert.equal(refusal.kind, "bad-value", `${JSON.stringify(answer)} was accepted`);
    }
  });

  it("readBlocks_ATopLevelKeyTheContractDoesNotName_IsIgnored", () => {
    // Arrange — deliberately NOT symmetric with the field check above. 0015: "Keys this list
    // does not name are ignored, which is what makes a later version cheap to add."
    const ANSWER = "still fine";

    // Act
    const blocks = blocksIn(
      reply({ ...block(SINGLE, { answer: ANSWER }), notInTheContract: "ignore me" }),
    );

    // Assert
    assert.equal(answerOf(blocks[0]), ANSWER);
  });
});

describe("planning what a reply would change", () => {
  it("planFor_AnAnswerWithNothingStored_IsAnAdditionRatherThanAChange", () => {
    // Arrange — additions need no review: they fill a blank. Only overwrites do (0007 · C3).
    const ANSWER = "That I showed up.";
    const ONE = 1;

    // Act
    const plan = planning(reply(block(SINGLE, { answer: ANSWER })), new Map());

    // Assert
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.additions.length, ONE);
    assert.equal(plan.additions[0]?.before, "");
    assert.equal(plan.additions[0]?.after, ANSWER);
    assert.equal(plan.additions[0]?.group, SINGLE, "the review cannot say which question");
    assert.equal(plan.writes.get(SINGLE), ANSWER);
  });

  it("planFor_AnAnswerOverSomethingWritten_IsAChangeCarryingBothVersions", () => {
    // Arrange — this is the case the whole reviewing surface exists for. Showing only the
    // new text would ask the reader to accept a replacement they cannot see.
    const MINE = "What I actually wrote, in my own words.";
    const THEIRS = "A tidier sentence somebody else made of it.";
    const ONE = 1;

    // Act
    const plan = planning(reply(block(SINGLE, { answer: THEIRS })), new Map([[SINGLE, MINE]]));

    // Assert
    assert.equal(plan.additions.length, 0);
    assert.equal(plan.changes.length, ONE);
    assert.equal(plan.changes[0]?.before, MINE);
    assert.equal(plan.changes[0]?.after, THEIRS);
    assert.equal(plan.changes[0]?.label, "Eulogy", "the reader is shown an identifier");
  });

  it("planFor_AnAnswerEchoedBackUnchanged_IsNeitherAndIsNotWritten", () => {
    // Arrange — the ordinary case when the reader asked an assistant to review what they
    // already had. A write that changes nothing still costs a transaction and still reads
    // as activity to somebody deciding whether to accept.
    const MINE = "Unchanged, word for word.";
    const ONE = 1;

    // Act
    const plan = planning(reply(block(SINGLE, { answer: MINE })), new Map([[SINGLE, MINE]]));

    // Assert
    assert.equal(plan.unchanged, ONE);
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.additions.length, 0);
    assert.equal(plan.writes.size, 0, "an identical value was written anyway");
  });

  it("planFor_AGroupsFields_AreKeyedTheWayTheFieldBindingReadsThem", () => {
    // Arrange — a group's answers are stored under `${group}.${field}`, and a single's under
    // the question identifier with no field segment. Getting either wrong writes answers to
    // keys nothing reads, which looks exactly like a successful import.
    const VALUE = "Most days, yes.";
    const ANSWER = "A single has no field segment.";

    // Act
    const grouped = planning(reply(block(GROUP, { fields: { values_daily: VALUE } })), new Map());
    const single = planning(reply(block(SINGLE, { answer: ANSWER })), new Map());

    // Assert
    assert.deepEqual([...grouped.writes], [[`${GROUP}.values_daily`, VALUE]]);
    assert.deepEqual([...single.writes], [[SINGLE, ANSWER]]);
  });

  it("planFor_AFieldWithNoLabelOfItsOwn_IsNamedForTheReaderNotByItsIdentifier", () => {
    // Arrange — the review surface says what is being overwritten. Falling back to the raw
    // identifier would show "values_daily" where the page says "Does it use my values daily?"
    // Act
    const plan = planning(
      reply(block(GROUP, { fields: { values_daily: "yes" } })),
      new Map([[`${GROUP}.values_daily`, "no"]]),
    );

    // Assert
    const label = plan.changes[0]?.label ?? "";
    assert.ok(label !== "values_daily", "the reader is shown a storage identifier");
    assert.ok(label.length > 0, "the field is unnamed");
  });

  it("planFor_SeveralBlocksInOnePaste_AreAllPlannedAndTheGroupsRecorded", () => {
    // Arrange — every planning test used to pass exactly ONE block, which is why four
    // separate multi-block defects shipped green. 0015 · C1 makes this the ordinary case.
    const EXPECTED_WRITES = 3;
    const text = pasteOf(
      block(SINGLE, { answer: "one" }),
      block(SENTENCE, { fields: { excess: "noise", lack: "care" } }),
    );

    // Act
    const plan = planning(text, new Map());

    // Assert
    assert.deepEqual(plan.groups, [SINGLE, SENTENCE], "the reader cannot be told where it went");
    assert.equal(plan.writes.size, EXPECTED_WRITES);
    assert.equal(plan.additions.length, EXPECTED_WRITES);
  });

  it("planFor_CalledDirectlyWithTwoBlocksForOneGroup_RefusesRatherThanTrusting", () => {
    // Arrange — `planFor` is exported, and all four of the original defects are still latent
    // inside it: each block reads the stored instance order from `entries`, so two naming one
    // group would plan from the same starting point and the second's order write would strand
    // the first's answers. `readBlocks` refuses this, and being its only caller today is the
    // condition under which a precondition gets quietly forgotten — the next slice adds the
    // second caller. Every other planning test goes through `readBlocks`, which is why the
    // guard here was invisible to the suite.
    const first = blocksIn(reply(block(REPEAT, { instances: [{ fields: { title: "A" } }] })));
    const second = blocksIn(reply(block(REPEAT, { instances: [{ fields: { title: "B" } }] })));

    // Act
    const planned = planFor([...first, ...second], new Map());

    // Assert
    assert.ok(!planned.ok, "two blocks for one group were planned");
    assert.equal(planned.refusal.kind, "repeated-group");
  });

  it("planFor_NoBlocksAtAll_IsAnEmptyPlanRatherThanAFailure", () => {
    // Arrange — negative case. `readBlocks` refuses an empty paste, so this is only
    // reachable by a caller passing an empty list, and it should not throw.
    // Act
    const planned = planFor([], new Map());

    // Assert
    assert.ok(planned.ok);
    assert.equal(planned.plan.writes.size, 0);
    assert.equal(planned.plan.unchanged, 0);
    assert.deepEqual(planned.plan.groups, []);
  });
});

describe("instances, and the identity that must not be adopted", () => {
  const MINE = "5f1c8e2a-0000-4000-8000-000000000001";

  /** A store holding one repeat instance the reader already wrote. */
  function stored(): Map<string, string> {
    return new Map([
      [orderKey(REPEAT), writeOrder([MINE])],
      [answerKey(REPEAT, MINE, "title"), "The garage-band years"],
    ]);
  }

  it("planFor_AnEchoedIdentifier_AnswersTheInstanceItNames", () => {
    // Arrange — identity travels out in the prompt and comes back as a REFERENCE. This is
    // the whole reason it travels: without it every answer is a new instance.
    const CHANGED = "The years in the garage";
    const ONE = 1;

    // Act
    const plan = planning(
      reply(block(REPEAT, { instances: [{ id: MINE, fields: { title: CHANGED } }] })),
      stored(),
    );

    // Assert
    assert.deepEqual([...plan.writes], [[answerKey(REPEAT, MINE, "title"), CHANGED]]);
    assert.equal(plan.writes.has(orderKey(REPEAT)), false, "the order was rewritten");
    assert.equal(plan.changes.length, ONE);
  });

  it("planFor_AWellFormedIdentifierThisGroupDoesNotHave_MintsInsteadOfAdoptingIt", () => {
    // Arrange — the rule the rest of the design rests on, and the test that used to certify
    // it could not fail for the reason it claimed: its forged id contained dots, so
    // `answerKey` threw in keys.ts before either assertion ran. It was testing keys.ts's dot
    // rejection, which keys.test.ts already covers. THIS id is one keys.ts would happily put
    // in a key — a plausible UUID an assistant invented, which is the realistic case — so
    // only the mint-versus-adopt decision can make it pass.
    const FORGED = "9c1f0e77-2b44-4a1e-9c3d-77e0b1a2c3d4";
    const TITLE = "a chapter it made up an id for";
    const AFTER_EXISTING = 2;

    // Act
    const plan = planning(
      reply(block(REPEAT, { instances: [{ id: FORGED, fields: { title: TITLE } }] })),
      stored(),
    );

    // Assert — nothing anywhere carries the supplied id...
    const written = [...plan.writes.keys()];
    assert.ok(!written.some((key) => key.includes(FORGED)), `the supplied id was used: ${written}`);
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "[]") as string[];
    assert.ok(!order.includes(FORGED), "the supplied id reached the order");
    // ...and the answer really was written, under an identifier this application minted.
    assert.equal(order.length, AFTER_EXISTING, "the new instance was dropped instead of minted");
    const minted = order[1] ?? "";
    assert.notEqual(minted, FORGED);
    assert.equal(plan.writes.get(answerKey(REPEAT, minted, "title")), TITLE);
  });

  it("planFor_AnIdentifierThatIsNotAString_MintsRatherThanCoercingIt", () => {
    // Arrange — negative case. Stringifying a number or an object would put an
    // assistant-chosen value into a storage key by another route.
    const NOT_IDENTIFIERS: readonly unknown[] = [42, null, { id: "x" }, ["a"], true];
    const AFTER_EXISTING = 2;

    // Act & Assert
    for (const id of NOT_IDENTIFIERS) {
      // The store already holds an instance whose id is the STRINGIFIED value, so coercion
      // would find a match and answer that instance instead of minting. Against an empty
      // store this test could not fail: coercion matches nothing there, so minting happens
      // either way — verified, the `String(id)` mutation survived that version.
      const collides = String(id);
      const entries = new Map([
        [orderKey(REPEAT), writeOrder([collides])],
        [answerKey(REPEAT, collides, "title"), "an answer already here"],
      ]);

      const plan = planning(
        reply(block(REPEAT, { instances: [{ id, fields: { title: "t" } }] })),
        entries,
      );

      const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "[]") as string[];
      assert.equal(order.length, AFTER_EXISTING, `${JSON.stringify(id)} was coerced and matched`);
      assert.equal(order[0], collides, "the existing instance moved");
      assert.equal(
        plan.writes.get(answerKey(REPEAT, collides, "title")),
        undefined,
        `${JSON.stringify(id)} was coerced into a key and overwrote a stored answer`,
      );
    }
  });

  it("planFor_NewInstances_AppendAfterWhatExistsAndNeverReorderIt", () => {
    // Arrange — the order is the reader's (0015). New instances append, in the order the
    // block gives them, after every existing instance.
    const FIRST = "a new one";
    const SECOND = "another new one";
    const TOTAL = 3;

    // Act
    const plan = planning(
      reply(
        block(REPEAT, {
          instances: [{ fields: { title: FIRST } }, { fields: { title: SECOND } }],
        }),
      ),
      stored(),
    );

    // Assert
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "") as string[];
    assert.equal(order[0], MINE, "the reader's existing instance moved");
    assert.equal(order.length, TOTAL);
    assert.equal(plan.writes.get(answerKey(REPEAT, order[1] ?? "", "title")), FIRST);
    assert.equal(plan.writes.get(answerKey(REPEAT, order[2] ?? "", "title")), SECOND);
  });

  it("planFor_AnEchoedAndAMintedInstanceTogether_KeepEachAnswerWithItsOwnInstance", () => {
    // Arrange — the commonest real reply to "I started this by hand, help me finish": some
    // entries echo an id, some are new. The two lists have to stay in step, and nothing
    // covered the mixed case.
    const KEPT = "the one I already had, reworded";
    const ADDED = "the one it wrote for me";
    const TOTAL = 2;

    // Act
    const plan = planning(
      reply(
        block(REPEAT, {
          instances: [{ id: MINE, fields: { title: KEPT } }, { fields: { title: ADDED } }],
        }),
      ),
      stored(),
    );

    // Assert
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "") as string[];
    assert.equal(order.length, TOTAL);
    assert.equal(plan.writes.get(answerKey(REPEAT, MINE, "title")), KEPT);
    assert.equal(plan.writes.get(answerKey(REPEAT, order[1] ?? "", "title")), ADDED);
  });

  it("planFor_ExactlyAsManyInstancesAsThePageRenders_IsAccepted", () => {
    // Arrange — the ordinary day-1 case, and the boundary itself. Only 1, 2 and slots+1 were
    // covered, so nothing noticed a mutant that dropped every instance past the second.
    const SLOTS = 5;
    const instances = Array.from({ length: SLOTS }, (_, index) => ({
      fields: { title: `chapter ${index}` },
    }));

    // Act
    const plan = planning(reply(block(REPEAT, { instances })), new Map());

    // Assert
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "") as string[];
    assert.equal(order.length, SLOTS, "not every instance was planned");
    assert.equal(plan.additions.length, SLOTS);
    order.forEach((id, index) => {
      assert.equal(plan.writes.get(answerKey(REPEAT, id, "title")), `chapter ${index}`);
    });
  });

  it("planFor_MoreInstancesThanThePageRenders_IsRefusedRatherThanTruncated", () => {
    // Arrange — negative case, and the rule 0015 calls the one most easily got wrong. Day
    // 1's chapters are min 5 / max 8, and bounding at `max` would store three chapters of
    // dictated words that nothing on the page will ever show. Truncating instead of refusing
    // is the silent loss the bound exists to prevent.
    // The ceiling is now `max` (#74), so "too many" means past the range rather than past
    // the printed slots.
    const SLOTS = 8;
    const TOO_MANY = SLOTS + 1;
    const instances = Array.from({ length: TOO_MANY }, (_, index) => ({
      fields: { title: `chapter ${index}` },
    }));

    // Act
    const refusal = refusedPlan(reply(block(REPEAT, { instances })), new Map());

    // Assert
    assert.equal(refusal.kind, "too-many-instances");
    assert.equal(refusal.kind === "too-many-instances" ? refusal.slots : 0, SLOTS);
    assert.equal(refusal.kind === "too-many-instances" ? refusal.adding : 0, TOO_MANY);
  });

  it("planFor_FewerInstancesThanThePageRenders_IsAllowedAndWritesWhatItHas", () => {
    // Arrange — 0013 · Q2 already defines this: a short order is adopted for the slots it
    // covers, and the slots past its end refuse writes and say so. That second half is the
    // field binding's job, not this one's; what belongs here is that the answer lands.
    const TITLE = "just the one";
    const ONE = 1;

    // Act
    const plan = planning(reply(block(REPEAT, { instances: [{ fields: { title: TITLE } }] })), new Map());

    // Assert
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "") as string[];
    assert.equal(order.length, ONE);
    assert.equal(plan.writes.get(answerKey(REPEAT, order[0] ?? "", "title")), TITLE);
  });

  it("planFor_AnUnreadableInstanceOrder_IsRefusedAsADeviceProblemNotABadBlock", () => {
    // Arrange — negative case, and 0013 · Q3 is explicit: `absent` and `unreadable` are
    // deliberately different answers. Only `absent` may materialise. Treating an order that
    // merely failed to parse as empty would mint fresh identifiers on top of the reader's
    // answers and orphan every one of them permanently. It also must not read as the block's
    // fault — nothing in any reply can fix a damaged store.
    const entries = new Map([[orderKey(REPEAT), "{not an order at all"]]);

    // Act
    const refusal = refusedPlan(reply(block(REPEAT, { instances: [{ fields: { title: "new" } }] })), entries);

    // Assert
    assert.equal(refusal.kind, "bad-order");
    assert.match(explain(refusal), /not a problem with the reply/i);
  });

  it("planFor_AnswersWithNoOrderToReferenceThem_AreRefusedRatherThanMintedOver", () => {
    // Arrange — negative case, and the guard for the assumption this function cannot check
    // outright: that `entries` is the WHOLE store. A caller filtering by group prefix — the
    // obvious economy for a per-question paste button — drops the order key, and then an
    // echoed identifier stops matching, a fresh instance is minted, and the order written
    // here replaces the reader's, orphaning every chapter while reporting no changes at all.
    const entries = new Map([[answerKey(REPEAT, MINE, "title"), "a chapter I dictated"]]);

    // Act
    const refusal = refusedPlan(
      reply(block(REPEAT, { instances: [{ id: MINE, fields: { title: "reworded" } }] })),
      entries,
    );

    // Assert
    assert.equal(refusal.kind, "orphaned-answers");
  });

  it("planFor_AnOrderLongerThanTheRenderedCount_AllowsAnsweringWhatExists", () => {
    // Arrange — a restored backup can leave more instances than the page renders, which
    // 0013 · Q2 says is accepted without comment. Those instances EXIST, so answering one is
    // fine even though the count is already past the rendered ceiling.
    // Past the range, so a long order still raises the floor rather than the ceiling.
    const SLOTS = 9;
    const EXTRA = 0;
    const many = Array.from({ length: SLOTS + EXTRA }, (_, index) =>
      `5f1c8e2a-0000-4000-8000-00000000000${index}`,
    );
    const entries = new Map([[orderKey(REPEAT), writeOrder(many)]]);

    // Act
    const plan = planning(
      reply(block(REPEAT, { instances: [{ id: many[0], fields: { title: "answered" } }] })),
      entries,
    );

    // Assert
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.writes.has(orderKey(REPEAT)), false, "an answer rewrote the order");
  });

  it("planFor_AnOrderLongerThanTheRenderedCount_StillRefusesAddingToIt", () => {
    // Arrange — negative case for the same state. A long order raises the floor, not the
    // ceiling: those instances existing is not evidence that more may be added.
    // Past the range, so a long order still raises the floor rather than the ceiling.
    const SLOTS = 9;
    const EXTRA = 0;
    const many = Array.from({ length: SLOTS + EXTRA }, (_, index) =>
      `5f1c8e2a-0000-4000-8000-00000000000${index}`,
    );
    const entries = new Map([[orderKey(REPEAT), writeOrder(many)]]);

    // Act
    const refusal = refusedPlan(
      reply(block(REPEAT, { instances: [{ fields: { title: "one too many" } }] })),
      entries,
    );

    // Assert
    assert.equal(refusal.kind, "too-many-instances");
    assert.equal(refusal.kind === "too-many-instances" ? refusal.slots : 0, SLOTS + EXTRA);
  });
});

describe("what the reader is told", () => {
  it("explain_EveryRefusal_SaysWhatWentWrongAndThatTheDeviceIsUntouched", () => {
    // Arrange — 0015 · C6: each refusal "says what was wrong AND that nothing on the device
    // changed", which `import.ts` does in all seven of its branches. The previous version of
    // this test asserted only that the string was non-empty, so replacing `explain` wholesale
    // with a constant left it green — and nine of the eleven branches had quietly dropped the
    // reassurance. The moment it matters is exactly this one: somebody has just pasted a
    // reply about words they dictated.
    const EVERY: readonly (readonly [Refusal, RegExp])[] = [
      [{ kind: "no-blocks" }, /code block/],
      [{ kind: "example-only" }, /example question/],
      [{ kind: "cut-off" }, /cut off/],
      [{ kind: "repeated-group", group: REPEAT }, /twice/],
      [{ kind: "repeated-instance", group: REPEAT }, /same entry/],
      [{ kind: "unknown-group", group: "day9.x" }, /day9\.x/],
      [{ kind: "checklist", group: CHECKLIST }, /checklist/],
      [{ kind: "newer-version", group: SINGLE, found: 2 }, /Update/],
      [{ kind: "bad-version", group: SINGLE }, /which version/],
      [{ kind: "no-answers", group: SINGLE }, /no answers/],
      [{ kind: "several-shapes", group: SINGLE }, /more than one way/],
      [{ kind: "wrong-shape", group: REPEAT, expected: "instances" }, /instances/],
      [{ kind: "bad-value", group: SINGLE, field: "title" }, /title/],
      [{ kind: "unknown-field", group: SENTENCE, field: "invented" }, /invented/],
      [{ kind: "bad-order", group: REPEAT }, /not a problem with the reply/],
      [{ kind: "orphaned-answers", group: REPEAT }, /not a problem with the reply/],
      [{ kind: "cannot-key", group: REPEAT }, /could not be worked out/],
      [{ kind: "too-many-instances", group: REPEAT, slots: 5, existing: 0, adding: 6 }, /room for 5/],
      [{ kind: "empty-instance", group: REPEAT }, /One of the entries/],
      [{ kind: "too-many-instances", group: REPEAT, slots: 5, existing: 5, adding: 1 }, /already holds 5/],
    ];

    // Act & Assert
    for (const [refusal, says] of EVERY) {
      const said = explain(refusal);
      assert.match(said, says, `${refusal.kind} does not say what went wrong`);
      assert.match(
        said,
        /Nothing on this device has changed\./,
        `${refusal.kind} does not say the reader's answers are safe`,
      );
      assert.ok(!/error|invalid|failed/i.test(said), `${refusal.kind} reads as a scolding`);
    }
  });

  it("explain_ABlockThatNamedNoQuestion_DoesNotLeaveAGapWhereTheNameGoes", () => {
    // Arrange — negative case. A non-string `group` collapses to "", which rendered "That
    // answers a question this workbook does not have ()."
    // Act
    const said = explain({ kind: "unknown-group", group: "" });

    // Assert
    assert.match(said, /an unnamed question/);
    assert.ok(!said.includes("()"), "an empty gap was left where the question's name goes");
  });

  it("explain_AnEnormousIdentifierFromTheReply_IsCutToSomethingReadable", () => {
    // Arrange — negative case. `group` and `field` are raw JSON values out of text an
    // assistant relayed, and it may be relaying somebody else's. Uncapped, a 200,000
    // character group produced a 200,128 character banner — not so much an attack as a
    // message nobody can act on, which is what every refusal here is trying not to be.
    const ENORMOUS = 200_000;
    const READABLE = 400;

    // Act
    const said = explain({ kind: "unknown-group", group: "x".repeat(ENORMOUS) });

    // Assert
    assert.ok(said.length < READABLE, `the message is ${said.length} characters long`);
  });
});
