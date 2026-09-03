/**
 * The thread vocabulary: what a wake document says, what a thread's objectives
 * state, and what a first turn sheds to fit.
 *
 * THE RULE WRITTEN TWICE IS THE POINT, so the identity of the two copies is
 * asserted rather than assumed: the system prompt and the wake document must
 * carry the same sentence, because two drifting copies of a rule nothing
 * enforces is a rule nobody is bound by.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeHttpPageItemsMax,
  nativeHttpPathSegmentCharsMax,
  selectorSettingsTextCharsMax,
  sessionTurnInputCharsMax,
  threadMessageCharsMax,
  threadSeedingCharsMax,
  threadSeedingFixedCharsMax,
  threadWakeCharsMax,
} from "../../src/contract/http.ts";
import { allSessionCapabilities } from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  allThreadStandings,
  allThreadWakeReasons,
  parseThreadWake,
  threadCapabilitiesDefault,
  threadChannelStanding,
  threadSeedingText,
  threadStanding,
  threadSystemPrompt,
  threadSystemPromptCharsMax,
  threadTurnInput,
  threadTurnInputCharsMax,
  threadWakeDocument,
  threadWakeStanding,
  threadWakeText,
  threadWakeVersion,
} from "../../src/interpreter/thread.ts";

const partition = { tenant: "acme", project: "atlas" } as unknown as Partition;
const instant = "2026-09-02T12:00:00.000Z";

const wake = () =>
  threadWakeDocument({ wake: "TicketRefused", resource: "42", at: instant });

test("the default roster is capabilities the tree knows, and holds neither of the two withheld", () => {
  for (const capability of threadCapabilitiesDefault)
    assert.ok(
      (allSessionCapabilities as readonly string[]).includes(capability),
      capability,
    );
  const held: readonly string[] = threadCapabilitiesDefault;
  assert.ok(!held.includes("LeadDecision"));
  assert.ok(!held.includes("RepositoryWrite"));
  assert.ok(held.includes("DraftOriginate"));
});

/**
 * Unit 4's SQL mirrors this roster one-for-one against the change kinds it
 * joins, so a member lost or renamed here is a wake nobody ever gets. The list
 * is written out rather than iterated, the way the capability roster is.
 */
test("the wake roster holds exactly the reasons the wake runtime joins", () => {
  assert.deepEqual(allThreadWakeReasons, [
    "TicketRefused",
    "RefusalLifted",
    "DraftDeleted",
    "TicketEscalated",
    "TicketCompleted",
    "TicketAbandoned",
  ]);
  assert.deepEqual(allThreadStandings, ["Open", "Closed", "Orphaned"]);
});

/**
 * The two copies being identical says nothing about what they say, so the acts
 * the sentence forbids are written out here. `originate` is the one that
 * matters most: this slice gives every thread `DraftOriginate` by default.
 */
test("the standing sentence names each act a woken thread may not take", () => {
  for (const act of ["originate", "revise", "release", "dispatch", "run"])
    assert.ok(threadWakeStanding.includes(` ${act}`), act);
  assert.match(threadWakeStanding, /notice, not an instruction/u);
  assert.match(threadWakeStanding, /nothing/u);
});

test("a thread with no membership left stands apart from one that is closed", () => {
  assert.equal(threadStanding({ state: "Open", owner: "geoff" }), "Open");
  assert.equal(threadStanding({ state: "Open" }), "Orphaned");
  assert.equal(threadStanding({ state: "Closed" }), "Closed");
  assert.equal(threadStanding({ state: "Closed", owner: "geoff" }), "Closed");
});

test("a wake document carries the standing rule rather than taking one", () => {
  const document = wake();

  assert.equal(document.version, threadWakeVersion);
  assert.equal(document.wake, "TicketRefused");
  assert.equal(document.resource, "42");
  assert.equal(document.standing, threadWakeStanding);
  assert.deepEqual(parseThreadWake(threadWakeText(document)), document);
});

test("every reason in the roster is one a document round-trips", () => {
  for (const reason of allThreadWakeReasons) {
    const document = threadWakeDocument({
      wake: reason,
      resource: "7",
      at: instant,
    });

    assert.equal(parseThreadWake(threadWakeText(document)).wake, reason);
  }
});

test("a wake document with an empty resource or instant is not written at all", () => {
  assert.throws(() =>
    threadWakeDocument({ wake: "DraftDeleted", resource: "", at: instant }),
  );
  assert.throws(() =>
    threadWakeDocument({ wake: "DraftDeleted", resource: "9", at: "" }),
  );
});

test("reading a wake refuses rather than repairs", () => {
  const document = wake();
  const refused = [
    "not json at all",
    JSON.stringify([document]),
    JSON.stringify("a string"),
    JSON.stringify({ ...document, version: threadWakeVersion + 1 }),
    JSON.stringify({ ...document, wake: "TicketInvented" }),
    JSON.stringify({ ...document, resource: "" }),
    JSON.stringify({ ...document, resource: 42 }),
    JSON.stringify({ ...document, at: undefined }),
    JSON.stringify({ ...document, standing: undefined }),
  ];

  for (const text of refused)
    assert.throws(() => parseThreadWake(text), new RegExp("wake"), text);
});

test("a wake larger than the column holds is refused at both ends", () => {
  const past = JSON.stringify({
    ...wake(),
    resource: "4".repeat(threadWakeCharsMax),
  });

  assert.ok(past.length > threadWakeCharsMax);
  assert.throws(() => parseThreadWake(past));
  assert.throws(() =>
    threadWakeText({ ...wake(), resource: "4".repeat(threadWakeCharsMax) }),
  );
});

/**
 * The standing sentence is inside every wake document, so lengthening it eats
 * the budget the resource is written in. This is what makes that visible before
 * a pass finds it: the widest resource a change row can name must still fit.
 */
test("the widest wake a change row can name fits the document bound", () => {
  for (const reason of allThreadWakeReasons) {
    const text = threadWakeText(
      threadWakeDocument({
        wake: reason,
        resource: "r".repeat(nativeHttpPathSegmentCharsMax),
        at: instant,
      }),
    );

    assert.ok(text.length <= threadWakeCharsMax, reason);
  }
});

test("the objectives state whose the thread is, then the two standing rules", () => {
  const prompt = threadSystemPrompt({ partition, owner: "geoff" });

  assert.ok(prompt.includes("geoff"));
  assert.ok(prompt.includes("acme/atlas"));
  assert.ok(prompt.includes(threadChannelStanding));
  assert.ok(prompt.includes(threadWakeStanding));
  assert.ok(
    prompt.indexOf("geoff") < prompt.indexOf(threadChannelStanding),
    "the owner is named before the rules",
  );
  assert.ok(
    prompt.indexOf(threadChannelStanding) < prompt.indexOf(threadWakeStanding),
    "the channel rule stands before the wake rule",
  );
});

/**
 * The rule is enforceable nowhere, so the only thing that can be checked of it
 * is that the two places saying it say the same thing.
 */
test("the wake document and the objectives carry one sentence and not two", () => {
  const carried = parseThreadWake(threadWakeText(wake())).standing;

  assert.equal(carried, threadWakeStanding);
  assert.ok(
    threadSystemPrompt({ partition, owner: "geoff" }).includes(carried),
    "the prompt does not carry the sentence the wake does",
  );
});

test("a North Star is named where there is one and no heading where there is none", () => {
  const without = threadSystemPrompt({ partition, owner: "geoff" });
  const with_ = threadSystemPrompt({
    partition,
    owner: "geoff",
    northStar: "ship the console",
  });

  assert.ok(!without.includes("North Star"));
  assert.ok(with_.includes("ship the console"));
});

test("an owner nobody could have been is refused, and the widest prompt fits", () => {
  assert.throws(() => threadSystemPrompt({ partition, owner: "" }));
  const widest = threadSystemPrompt({
    partition: {
      tenant: "t".repeat(256),
      project: "p".repeat(256),
    } as unknown as Partition,
    owner: "o".repeat(256),
    northStar: "n".repeat(selectorSettingsTextCharsMax),
  });

  assert.ok(widest.length <= threadSystemPromptCharsMax);
});

const seededDrafts = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({
    ticket: index + 1,
    summary: `draft ${String(index + 1)}`,
  }));

const seededRefusals = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({
    ticket: index + 1,
    reason: `refused ${String(index + 1)}`,
  }));

test("a turn with no seeding is the message alone", () => {
  assert.equal(threadTurnInput("what is blocking 42?"), "what is blocking 42?");
  assert.throws(() => threadTurnInput("x".repeat(threadTurnInputCharsMax + 1)));
});

test("a first turn puts the seeding block in front of the message", () => {
  const input = threadTurnInput("what is blocking 42?", {
    northStar: "ship the console",
    drafts: seededDrafts(2),
    refusals: seededRefusals(1),
  });

  assert.ok(input.endsWith("what is blocking 42?"));
  assert.ok(input.indexOf("ship the console") < input.indexOf("draft 1"));
  assert.ok(input.indexOf("draft 2") < input.indexOf("refused 1"));
  assert.ok(input.includes(threadWakeStanding));
});

test("the drafts shed oldest first, and only then the refusals", () => {
  const filler = "d".repeat(Math.ceil(threadTurnInputCharsMax / 8));
  const drafts = Array.from({ length: 32 }, (_unused, index) => ({
    ticket: index + 1,
    summary: `[${String(index + 1)}]${filler}`,
  }));
  const message = "x".repeat(threadMessageCharsMax);

  const input = threadTurnInput(message, {
    drafts,
    refusals: seededRefusals(2),
  });

  assert.ok(input.length <= threadTurnInputCharsMax);
  assert.ok(!input.includes(`[1]${filler}`), "the oldest draft survived");
  assert.ok(input.includes(`[32]${filler}`), "the newest draft was shed");
  assert.ok(input.includes("refused 1"), "a refusal was shed before a draft");
});

test("the refusals shed oldest first once no draft is left to shed", () => {
  const filler = "r".repeat(Math.ceil(threadTurnInputCharsMax / 8));
  const refusals = Array.from({ length: 32 }, (_unused, index) => ({
    ticket: index + 1,
    reason: `[${String(index + 1)}]${filler}`,
  }));

  const input = threadTurnInput("x".repeat(threadMessageCharsMax), {
    drafts: seededDrafts(4),
    refusals,
  });

  assert.ok(input.length <= threadTurnInputCharsMax);
  assert.ok(!input.includes("draft 1"), "a draft survived a shed refusal");
  assert.ok(!input.includes(`[1]${filler}`), "the oldest refusal survived");
  assert.ok(input.includes(`[32]${filler}`), "the newest refusal was shed");
});

test("the North Star and the standing rules are never shed", () => {
  const input = threadTurnInput("x".repeat(threadMessageCharsMax), {
    northStar: "ship the console",
    drafts: seededDrafts(nativeHttpPageItemsMax),
    refusals: seededRefusals(32),
  });

  assert.ok(input.includes("ship the console"));
  assert.ok(input.includes(threadChannelStanding));
  assert.ok(input.includes(threadWakeStanding));
});

test("an input that cannot fit with everything sheddable shed is refused", () => {
  assert.throws(() =>
    threadTurnInput("x".repeat(threadTurnInputCharsMax), {
      northStar: "n".repeat(selectorSettingsTextCharsMax),
      drafts: [],
      refusals: [],
    }),
  );
});

/**
 * The seeding carries a North Star the settings route has already accepted and
 * never sheds it, so a first turn at that ceiling has to compose rather than
 * raise. Refusing it would be a door no member could open and no member could
 * fix.
 */
test("a North Star at the bound the settings route accepts still composes", () => {
  const northStar = "n".repeat(selectorSettingsTextCharsMax);

  const input = threadTurnInput("x".repeat(threadMessageCharsMax), {
    northStar,
    drafts: seededDrafts(nativeHttpPageItemsMax),
    refusals: seededRefusals(32),
  });

  assert.ok(input.includes(northStar));
  assert.ok(input.length <= threadTurnInputCharsMax);
  assert.ok(
    input.length <= sessionTurnInputCharsMax,
    "the widest first turn is a row the mailbox column will not take",
  );
});

/** The ceiling the contract names is a claim about this block, so it is measured. */
test("what the seeding weighs beyond its North Star is inside the named ceiling", () => {
  const headings = threadSeedingText({
    northStar: "",
    drafts: [{ ticket: 1, summary: "" }],
    refusals: [{ ticket: 1, reason: "" }],
  });

  assert.ok(headings.includes("open drafts"));
  assert.ok(headings.includes("Standing against"));
  assert.ok(headings.length <= threadSeedingFixedCharsMax);
  assert.equal(
    threadSeedingCharsMax,
    selectorSettingsTextCharsMax + threadSeedingFixedCharsMax,
  );
});

test("the seeding block omits the sections it has nothing for", () => {
  const bare = threadSeedingText({ drafts: [], refusals: [] });

  assert.ok(!bare.includes("North Star"));
  assert.ok(!bare.includes("open drafts"));
  assert.ok(!bare.includes("Standing against"));
  assert.ok(bare.includes(threadWakeStanding));
});
