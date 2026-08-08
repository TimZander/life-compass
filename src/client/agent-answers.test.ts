/**
 * Reading an assistant's reply, and working out what it would change.
 *
 * The whole surface of somebody else's text meeting answers the reader wrote themselves, so
 * the refusals carry as much weight here as the happy path — every one of them is a case
 * where accepting would either lose words or store something the reader never said.
 *
 * Fixtures are real question identifiers rather than invented ones. The shape a block must
 * take is decided by the group's kind (0015), so a test against a made-up question would be
 * testing the test's idea of the schema instead of the schema.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBlocks, planFor, explain, type Block, type Refusal } from "./agent-answers.ts";
import { answerKey, orderKey, writeOrder } from "./keys.ts";

const SINGLE = "day4.eulogy";
const GROUP = "day5.career";
const SENTENCE = "day4.enough_and_more_1";
const REPEAT = "day1.chapters";
const CHECKLIST = "day5.ready";
/** day1.chapters is min 5 / max 8. The bound is the rendered count, which is min (0015). */
const SLOTS = 5;

/** A block as an assistant would send it, wrapped the way one actually replies. */
function reply(body: Record<string, unknown>, fence = "json"): string {
  return `Happy to help — here is what we worked out.\n\n\`\`\`${fence}\n${JSON.stringify(body, null, 2)}\n\`\`\`\n\nLet me know if you want to go again.`;
}

function block(group: string, rest: Record<string, unknown>): Record<string, unknown> {
  return { format: "life-compass/agent-answers", version: 1, group, ...rest };
}

/** The blocks a text yields, asserting it was accepted. */
function blocksIn(text: string): readonly Block[] {
  const read = readBlocks(text);
  assert.ok(read.ok, `refused: ${read.ok ? "" : explain(read.refusal)}`);
  return read.blocks;
}

/** The refusal a text produces, asserting it was refused. */
function refusalFor(text: string): Refusal {
  const read = readBlocks(text);
  assert.ok(!read.ok, "the text was accepted");
  return read.refusal;
}

describe("finding blocks in a reply", () => {
  it("readBlocks_AFenceLabelledJson_IsStillFoundByItsContent", () => {
    // Arrange — 0015 makes this the load-bearing choice: asked for ```life-compass an
    // assistant writes ```json. Requiring the info string would require them to be reliable
    // about the one thing they demonstrably are not.
    const ANSWER = "That I showed up for the people who needed it.";

    // Act
    const blocks = blocksIn(reply(block(SINGLE, { answer: ANSWER })));

    // Assert
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.group, SINGLE);
    assert.equal(blocks[0]?.answer, ANSWER);
  });

  it("readBlocks_AWholeDayInOnePaste_ReadsEveryBlockInOrder", () => {
    // Arrange — 0015 · C1 makes a day's reply an ordinary use of version 1 rather than a
    // future addition, and the prose between blocks is what an assistant actually sends.
    const text = [
      "Here is your day.",
      "```json",
      JSON.stringify(block(SINGLE, { answer: "a" })),
      "```",
      "And the second part:",
      "```",
      JSON.stringify(block(SENTENCE, { fields: { excess: "noise", lack: "care" } })),
      "```",
    ].join("\n");

    // Act
    const blocks = blocksIn(text);

    // Assert
    assert.deepEqual(blocks.map((one) => one.group), [SINGLE, SENTENCE]);
  });

  it("readBlocks_ProseFencesAndBlocksThatAreNotOurs_AreIgnoredNotRefused", () => {
    // Arrange — assistants quote, illustrate and explain. A fence that will not parse, or
    // parses without this format, is ordinary noise rather than an error to report.
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
    assert.equal(blocks.length, 1, "noise was read as an answer");
    assert.equal(blocks[0]?.answer, "the real one");
  });

  it("readBlocks_NothingMatchingAtAll_IsRefusedRatherThanReportedAsSuccess", () => {
    // Arrange — negative case, and the one 0015 singles out: what must not happen is
    // silence. A paste that yields nothing has to say so.
    // Act
    const refusal = refusalFor("Sure! I think your chapters are about growth and loss.");

    // Assert
    assert.equal(refusal.kind, "no-blocks");
    assert.ok(explain(refusal).length > 0);
  });

  it("readBlocks_OneMalformedBlockAmongGoodOnes_RefusesTheWholePaste", () => {
    // Arrange — negative case. Partial acceptance would mean telling the reader some of
    // their reply landed and leaving them to work out which. `import.ts` establishes
    // all-or-nothing as the property this application keeps.
    const text = [
      "```json",
      JSON.stringify(block(SINGLE, { answer: "this one is fine" })),
      "```",
      "```json",
      JSON.stringify(block(REPEAT, { answer: "a repeat cannot take an answer" })),
      "```",
    ].join("\n");

    // Act
    const refusal = refusalFor(text);

    // Assert
    assert.equal(refusal.kind, "wrong-shape");
    assert.equal(refusal.kind === "wrong-shape" ? refusal.group : "", REPEAT);
  });
});

describe("refusing a block", () => {
  it("readBlocks_AGroupThisBuildDoesNotHave_IsNamedInTheRefusal", () => {
    // Arrange — a frozen identifier (0011) this build lacks is either a typo an assistant
    // introduced or a question retired since, and those are different problems.
    const MISSING = "day9.nothing_like_this";

    // Act
    const refusal = refusalFor(reply(block(MISSING, { answer: "x" })));

    // Assert
    assert.equal(refusal.kind, "unknown-group");
    assert.match(explain(refusal), /day9\.nothing_like_this/);
  });

  it("readBlocks_AChecklistGroup_IsRefused", () => {
    // Arrange — 0015 keeps these out of the contract: readiness ticks the reader works
    // through, not questions an assistant answers on their behalf.
    // Act
    const refusal = refusalFor(reply(block(CHECKLIST, { fields: { x: "y" } })));

    // Assert
    assert.equal(refusal.kind, "checklist");
  });

  it("readBlocks_AVersionFromTheFuture_IsRefusedAndSaysToUpdate", () => {
    // Arrange
    const AHEAD = 2;

    // Act
    const refusal = refusalFor(reply({ ...block(SINGLE, { answer: "x" }), version: AHEAD }));

    // Assert
    assert.equal(refusal.kind, "newer-version");
    assert.match(explain(refusal), /Update/);
  });

  it("readBlocks_AnImpossibleVersion_IsRefusedAlongsideTheFuture", () => {
    // Arrange — negative case. `readEnvelope`'s reason, which 0015 adopts: refusing the
    // future without refusing the impossible would let the impossible through. No build
    // ever wrote one of these, so it is damaged or hand-made rather than old.
    const IMPOSSIBLE = [0, -1, 1.5, "1", undefined];

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
    const refusal = refusalFor(
      reply(block(SINGLE, { answer: "one", fields: { excess: "two" } })),
    );

    // Assert
    assert.equal(refusal.kind, "several-shapes");
  });

  it("readBlocks_ABlockCarryingNoAnswersAtAll_IsRefused", () => {
    // Arrange — negative case.
    // Act
    const refusal = refusalFor(reply(block(SINGLE, {})));

    // Assert
    assert.equal(refusal.kind, "no-answers");
  });

  it("readBlocks_AShapeThatDoesNotMatchTheGroupsKind_IsRefused", () => {
    // Arrange — the block deliberately does not restate the kind (0015): the schema already
    // says it, and two copies of one fact can disagree. So the shape is checked against the
    // schema instead.
    const WRONG: readonly (readonly [string, Record<string, unknown>])[] = [
      [SINGLE, { fields: { excess: "x" } }],
      [GROUP, { answer: "x" }],
      [REPEAT, { fields: { title: "x" } }],
      [SENTENCE, { instances: [{ fields: { excess: "x" } }] }],
    ];

    // Act & Assert
    for (const [group, shape] of WRONG) {
      const refusal = refusalFor(reply(block(group, shape)));
      assert.equal(refusal.kind, "wrong-shape", `${group} accepted the wrong shape`);
    }
  });

  it("readBlocks_AFieldTheQuestionDoesNotAsk_IsRefusedRatherThanDropped", () => {
    // Arrange — negative case. Keys the CONTRACT does not name are ignored so a later
    // version is cheap to add, but a field this group does not have is an assistant
    // answering a question that does not exist. Dropping it silently loses words the reader
    // believes travelled.
    // Act
    const refusal = refusalFor(
      reply(block(SENTENCE, { fields: { excess: "noise", invented: "nowhere" } })),
    );

    // Assert
    assert.equal(refusal.kind, "unknown-field");
    assert.match(explain(refusal), /invented/);
    assert.match(explain(refusal), /nothing has been changed/i);
  });

  it("readBlocks_AValueThatIsNotUsableText_IsRefusedForEveryValueNotASample", () => {
    // Arrange — negative case. One good value proves nothing about the rest. The empty
    // string matters most: `store.ts` deletes on empty, so permitting it would hand an
    // assistant a delete primitive through a format that says below it has none.
    const UNUSABLE: readonly unknown[] = ["", 42, null, ["a"], { a: "b" }, true];

    // Act & Assert
    for (const value of UNUSABLE) {
      const refusal = refusalFor(
        reply(block(SENTENCE, { fields: { excess: "fine", lack: value } })),
      );
      assert.equal(refusal.kind, "bad-value", `${JSON.stringify(value)} was accepted`);
    }
  });
});

describe("planning what a reply would change", () => {
  /** Plan for one block against stored entries, asserting it was not refused. */
  function planning(text: string, entries: ReadonlyMap<string, string>) {
    const planned = planFor(blocksIn(text), entries);
    assert.ok(planned.ok, `refused: ${planned.ok ? "" : explain(planned.refusal)}`);
    return planned.plan;
  }

  it("planFor_AnAnswerWithNothingStored_IsAnAdditionRatherThanAChange", () => {
    // Arrange — additions need no review: they fill a blank. Only overwrites do (0007 · C3).
    const ANSWER = "That I showed up.";

    // Act
    const plan = planning(reply(block(SINGLE, { answer: ANSWER })), new Map());

    // Assert
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.additions[0]?.before, "");
    assert.equal(plan.additions[0]?.after, ANSWER);
    assert.equal(plan.writes.get(SINGLE), ANSWER);
  });

  it("planFor_AnAnswerOverSomethingWritten_IsAChangeCarryingBothVersions", () => {
    // Arrange — this is the case the whole reviewing surface exists for. Showing only the
    // new text would ask the reader to accept a replacement they cannot see.
    const MINE = "What I actually wrote, in my own words.";
    const THEIRS = "A tidier sentence somebody else made of it.";

    // Act
    const plan = planning(
      reply(block(SINGLE, { answer: THEIRS })),
      new Map([[SINGLE, MINE]]),
    );

    // Assert
    assert.equal(plan.additions.length, 0);
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0]?.before, MINE);
    assert.equal(plan.changes[0]?.after, THEIRS);
    assert.equal(plan.changes[0]?.label, "Eulogy", "the reader is shown an identifier");
  });

  it("planFor_AnAnswerEchoedBackUnchanged_IsNeitherAndIsNotWritten", () => {
    // Arrange — the ordinary case when the reader asked an assistant to review what they
    // already had. A write that changes nothing still costs a transaction and still reads
    // as activity to somebody deciding whether to accept.
    const MINE = "Unchanged, word for word.";

    // Act
    const plan = planning(reply(block(SINGLE, { answer: MINE })), new Map([[SINGLE, MINE]]));

    // Assert
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.additions.length, 0);
    assert.equal(plan.writes.size, 0, "an identical value was written anyway");
  });

  it("planFor_AGroupsFields_AreKeyedTheWayTheFieldBindingReadsThem", () => {
    // Arrange — a group's answers are stored under `${group}.${field}`, and a single's under
    // the question identifier with no field segment. Getting this wrong writes answers to
    // keys nothing reads, which looks exactly like a successful import.
    const VALUE = "Most days, yes.";

    // Act
    const plan = planning(
      reply(block(GROUP, { fields: { values_daily: VALUE } })),
      new Map(),
    );

    // Assert
    assert.equal(plan.writes.get(`${GROUP}.values_daily`), VALUE);
  });
});

describe("instances, and the identity that must not be adopted", () => {
  function planning(text: string, entries: ReadonlyMap<string, string>) {
    const planned = planFor(blocksIn(text), entries);
    assert.ok(planned.ok, `refused: ${planned.ok ? "" : explain(planned.refusal)}`);
    return planned.plan;
  }

  function refusedPlan(text: string, entries: ReadonlyMap<string, string>): Refusal {
    const planned = planFor(blocksIn(text), entries);
    assert.ok(!planned.ok, "the plan was accepted");
    return planned.refusal;
  }

  /** A store holding one repeat instance the reader already wrote. */
  const MINE = "5f1c8e2a-0000-4000-8000-000000000001";
  const stored = (): Map<string, string> =>
    new Map([
      [orderKey(REPEAT), writeOrder([MINE])],
      [answerKey(REPEAT, MINE, "title"), "The garage-band years"],
    ]);

  it("planFor_AnEchoedIdentifier_AnswersTheInstanceItNames", () => {
    // Arrange — identity travels out in the prompt and comes back as a REFERENCE. This is
    // the whole reason it travels: without it every answer is a new instance.
    const CHANGED = "The years in the garage";

    // Act
    const plan = planning(
      reply(block(REPEAT, { instances: [{ id: MINE, fields: { title: CHANGED } }] })),
      stored(),
    );

    // Assert
    assert.equal(plan.writes.get(answerKey(REPEAT, MINE, "title")), CHANGED);
    assert.equal(plan.writes.has(orderKey(REPEAT)), false, "the order was rewritten");
    assert.equal(plan.changes.length, 1);
  });

  it("planFor_AnIdentifierThisGroupDoesNotHave_MintsInsteadOfAdoptingIt", () => {
    // Arrange — the rule the rest of the design rests on. An assistant cannot invent the
    // identifiers 0013 mints, so a supplied one is never written as a key: a hostile,
    // duplicated or reused identifier becomes a case that CANNOT ARISE rather than one to
    // validate. `keys.ts` stays the only path into the identifier format.
    const FORGED = "../../../etc/passwd";

    // Act
    const plan = planning(
      reply(block(REPEAT, { instances: [{ id: FORGED, fields: { title: "new" } }] })),
      stored(),
    );

    // Assert
    const written = [...plan.writes.keys()];
    assert.ok(!written.some((key) => key.includes(FORGED)), `the supplied id was used: ${written}`);
    const order = plan.writes.get(orderKey(REPEAT));
    assert.ok(order !== undefined && !order.includes(FORGED), "the supplied id reached the order");
  });

  it("planFor_NewInstances_AppendAfterWhatExistsAndNeverReorderIt", () => {
    // Arrange — the order is the reader's (0015). New instances append, in the order the
    // block gives them, after every existing instance.
    const FIRST = "a new one";
    const SECOND = "another new one";

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
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "[]") as string[];
    assert.equal(order[0], MINE, "the reader's existing instance moved");
    assert.equal(order.length, 3);
    assert.equal(plan.writes.get(answerKey(REPEAT, order[1] ?? "", "title")), FIRST);
    assert.equal(plan.writes.get(answerKey(REPEAT, order[2] ?? "", "title")), SECOND);
  });

  it("planFor_MoreInstancesThanThePageRenders_IsRefusedRatherThanTruncated", () => {
    // Arrange — negative case, and the rule 0015 calls the one most easily got wrong. Day
    // 1's chapters are min 5 / max 8, and bounding at `max` would store three chapters of
    // dictated words that nothing on the page will ever show. Truncating instead of refusing
    // is the silent loss the bound exists to prevent.
    const TOO_MANY = SLOTS + 1;
    const instances = Array.from({ length: TOO_MANY }, (_, index) => ({
      fields: { title: `chapter ${index}` },
    }));

    // Act
    const refusal = refusedPlan(reply(block(REPEAT, { instances })), new Map());

    // Assert
    assert.equal(refusal.kind, "too-many-instances");
    assert.equal(refusal.kind === "too-many-instances" ? refusal.slots : 0, SLOTS);
    assert.match(explain(refusal), /nothing has been changed/i);
  });

  it("planFor_FewerInstancesThanThePageRenders_IsAllowed", () => {
    // Arrange — 0013 · Q2 already defines this: a short order is adopted for the slots it
    // covers, and the slots past its end refuse writes and say so.
    // Act
    const plan = planning(
      reply(block(REPEAT, { instances: [{ fields: { title: "just the one" } }] })),
      new Map(),
    );

    // Assert
    const order = JSON.parse(plan.writes.get(orderKey(REPEAT)) ?? "[]") as string[];
    assert.equal(order.length, 1);
  });

  it("planFor_AnUnreadableInstanceOrder_IsRefusedRatherThanTreatedAsAbsent", () => {
    // Arrange — negative case, and 0013 · Q3 is explicit: `absent` and `unreadable` are
    // deliberately different answers. Only `absent` may materialise. Treating an order that
    // merely failed to parse as empty would mint fresh identifiers on top of the reader's
    // answers and orphan every one of them permanently.
    const entries = new Map([[orderKey(REPEAT), "{not an order at all"]]);

    // Act
    const refusal = refusedPlan(
      reply(block(REPEAT, { instances: [{ fields: { title: "new" } }] })),
      entries,
    );

    // Assert
    assert.equal(refusal.kind, "bad-value");
  });

  it("planFor_AnOrderLongerThanTheRenderedCount_RaisesTheFloorNotTheCeiling", () => {
    // Arrange — a restored backup can leave more instances than the page renders, which
    // 0013 · Q2 says is accepted without comment. Those instances EXIST, so they are not
    // evidence that more may be added: answering them is fine, adding past them is not.
    const many = Array.from({ length: SLOTS + 2 }, (_, index) =>
      `5f1c8e2a-0000-4000-8000-00000000000${index}`,
    );
    const entries = new Map([[orderKey(REPEAT), writeOrder(many)]]);

    // Act — answering an existing one is allowed...
    const plan = planning(
      reply(block(REPEAT, { instances: [{ id: many[0], fields: { title: "answered" } }] })),
      entries,
    );
    // ...and adding one more is not.
    const refusal = refusedPlan(
      reply(block(REPEAT, { instances: [{ fields: { title: "one too many" } }] })),
      entries,
    );

    // Assert
    assert.equal(plan.changes.length + plan.additions.length, 1);
    assert.equal(refusal.kind, "too-many-instances");
  });
});

describe("what the reader is told", () => {
  it("explain_EveryRefusal_SaysSomethingAndNeverBlamesTheReader", () => {
    // Arrange — a refusal that does not say which of these it is tells somebody holding
    // their own writing nothing about what to do next.
    const EVERY: readonly Refusal[] = [
      { kind: "no-blocks" },
      { kind: "unknown-group", group: "day9.x" },
      { kind: "checklist", group: CHECKLIST },
      { kind: "newer-version", group: SINGLE, found: 2 },
      { kind: "bad-version", group: SINGLE },
      { kind: "no-answers", group: SINGLE },
      { kind: "several-shapes", group: SINGLE },
      { kind: "wrong-shape", group: REPEAT, expected: "instances" },
      { kind: "bad-value", group: SINGLE, field: "title" },
      { kind: "unknown-field", group: SENTENCE, field: "invented" },
      { kind: "too-many-instances", group: REPEAT, slots: SLOTS, found: SLOTS + 1 },
    ];

    // Act & Assert
    for (const refusal of EVERY) {
      const said = explain(refusal);
      assert.ok(said.length > 0, `${refusal.kind} says nothing`);
      assert.ok(!/error|invalid|failed/i.test(said), `${refusal.kind} reads as a scolding: ${said}`);
    }
  });
});
