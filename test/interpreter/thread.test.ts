/**
 * The thread vocabulary: what a wake document says, what a thread's objectives
 * state, what a first turn sheds to fit, and where the member's own message
 * begins.
 *
 * THE RULE IS WRITTEN TWICE, so what the two compositions do with one set of
 * rules is asserted rather than assumed: given the same rules, the objectives
 * and the wake document write the same text. That is driven for a project's own
 * rules and for the default.
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
  threadConfigurationStanding,
  threadImageFetchPath,
  threadImagesSection,
  threadPurposeStanding,
  threadStoppedStanding,
  threadSeedingText,
  threadStanding,
  threadSystemPrompt,
  threadSystemPromptCharsMax,
  threadTurnInput,
  threadTurnInputCharsMax,
  threadWakeDocument,
  threadWakeText,
  threadWakeVersion,
  type ThreadSeededImage,
} from "../../src/interpreter/thread.ts";
import {
  resolvedThreadStandingRules,
  threadImagesHeading,
  threadImagesRead,
  threadStandingRulesDefault,
  threadTurnBoundaryHeading,
} from "../../src/contract/threadSeeding.ts";
import {
  ticketReferenceInstruction,
  ticketReferenceSplit,
} from "../../src/contract/ticketReference.ts";

/** What one project says instead of the installation's, said once here. */
const projectStandingRules = "- You draft, and you do nothing else.";

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
test("the default standing names each act a woken thread may not take", () => {
  for (const act of ["originate", "revise", "release", "dispatch", "run"])
    assert.ok(threadStandingRulesDefault.includes(` ${act}`), act);
  assert.match(threadStandingRulesDefault, /notice, not an instruction/u);
  assert.match(
    threadStandingRulesDefault,
    /the lead's decisions are the lead's/u,
  );
});

test("a project's own standing is what stands, and the default stands for the rest", () => {
  assert.equal(
    resolvedThreadStandingRules(projectStandingRules),
    projectStandingRules,
  );
  assert.equal(
    resolvedThreadStandingRules(undefined),
    threadStandingRulesDefault,
  );
});

test("a thread with no membership left stands apart from one that is closed", () => {
  assert.equal(threadStanding({ state: "Open", owner: "geoff" }), "Open");
  assert.equal(threadStanding({ state: "Open", owner: undefined }), "Orphaned");
  assert.equal(threadStanding({ state: "Closed", owner: undefined }), "Closed");
  assert.equal(threadStanding({ state: "Closed", owner: "geoff" }), "Closed");
});

test("a wake document carries the standing rule rather than taking one", () => {
  const document = wake();

  assert.equal(document.version, threadWakeVersion);
  assert.equal(document.wake, "TicketRefused");
  assert.equal(document.resource, "42");
  assert.equal(document.standing, threadStandingRulesDefault);
  assert.deepEqual(parseThreadWake(threadWakeText(document)), document);
});

test("a wake carries the project's own standing where the candidate named one", () => {
  const document = threadWakeDocument({
    wake: "TicketRefused",
    resource: "42",
    at: instant,
    standingRules: projectStandingRules,
  });

  assert.equal(document.standing, projectStandingRules);
  assert.equal(
    parseThreadWake(threadWakeText(document)).standing,
    projectStandingRules,
  );
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
 * The standing rules are inside every wake document and a project sets its own,
 * so the bound must admit the widest of both together: the widest resource a
 * change row can name beside the widest standing the settings route accepts,
 * written as characters JSON escapes rather than as characters it copies.
 */
test("the widest wake a change row can name fits the document bound", () => {
  for (const reason of allThreadWakeReasons) {
    const text = threadWakeText(
      threadWakeDocument({
        wake: reason,
        resource: "r".repeat(nativeHttpPathSegmentCharsMax),
        at: instant,
        standingRules: "\u0001".repeat(selectorSettingsTextCharsMax),
      }),
    );

    assert.ok(text.length <= threadWakeCharsMax, reason);
  }
});

test("the objectives state whose the thread is, what it is for, then its standing rules", () => {
  const prompt = threadSystemPrompt({
    partition,
    owner: "geoff",
    standingRules: threadStandingRulesDefault,
  });

  assert.ok(prompt.includes("geoff"));
  assert.ok(prompt.includes("acme/atlas"));
  assert.ok(prompt.includes(threadPurposeStanding));
  assert.ok(prompt.includes(threadStandingRulesDefault));
  assert.ok(
    prompt.indexOf("geoff") < prompt.indexOf(threadPurposeStanding),
    "the owner is named before the purpose",
  );
  assert.ok(
    prompt.indexOf(threadPurposeStanding) <
      prompt.indexOf(threadStandingRulesDefault),
    "the purpose stands before the rules",
  );
});

test("the objectives carry the project's own standing rules and not the default", () => {
  const prompt = threadSystemPrompt({
    partition,
    owner: "geoff",
    standingRules: projectStandingRules,
  });

  assert.ok(prompt.includes(projectStandingRules));
  assert.ok(!prompt.includes(threadStandingRulesDefault));
});

/** The rule is enforceable nowhere, so what can be checked of it is that the
 * two compositions write one set of rules the same way. */
test("one set of rules composes the same into the objectives and the wake", () => {
  for (const standingRules of [undefined, projectStandingRules]) {
    const carried = parseThreadWake(
      threadWakeText(
        threadWakeDocument({
          wake: "TicketRefused",
          resource: "42",
          at: instant,
          ...(standingRules === undefined ? {} : { standingRules }),
        }),
      ),
    ).standing;

    assert.ok(
      threadSystemPrompt({
        partition,
        owner: "geoff",
        standingRules: resolvedThreadStandingRules(standingRules),
      }).includes(carried),
      "the prompt does not carry the rules the wake does",
    );
  }
});

/**
 * The purpose is enforceable nowhere: the pod holds a shell, and a shell
 * writes. What can be checked is that the sentence names the draft as the
 * work, the tree as read and not changed, and the filing as how a turn that
 * was asked for a change ends.
 */
test("the purpose says the draft is the job and the checkout is for reading", () => {
  assert.match(threadPurposeStanding, /into tickets/u);
  assert.match(threadPurposeStanding, /draft tools/u);
  assert.match(threadPurposeStanding, /never do the work yourself/u);
  assert.match(threadPurposeStanding, /change nothing/u);
  assert.match(threadPurposeStanding, /what you filed/u);
});

/**
 * Revoking ends a ticket for good, and the roster cannot say when: the tool is
 * held on a wake as on a message. What can be checked is that the purpose says
 * whose word it takes.
 */
test("the purpose lets a thread revoke a ticket on its owner's word and on nothing else", () => {
  assert.match(
    threadPurposeStanding,
    /You revoke a ticket only on your owner's word: their instruction, or their yes to one line from you naming the tickets\./u,
  );
});

/**
 * A ticket runs on the agent of the configuration it was released against, so
 * the choice of one is where a thread decides who does the work. The telling
 * names no configuration, and stands after the purpose it qualifies.
 */
test("the objectives tell a thread a configuration is who does the work, and to choose one for each ticket", () => {
  const prompt = threadSystemPrompt({
    partition,
    owner: "geoff",
    standingRules: threadStandingRulesDefault,
  });

  for (const said of [
    /A configuration is also who does the work/u,
    /read each and choose for every ticket/u,
    /the strongest agent for work that needs design judgement/u,
    /a cheaper one for work that is mechanical and fully specified/u,
    /the stronger when unsure/u,
    /names the configuration beside each ticket/u,
    /before anything is released\.$/u,
  ])
    assert.match(threadConfigurationStanding, said);
  assert.ok(prompt.includes(threadConfigurationStanding));
  assert.ok(
    prompt.indexOf(threadPurposeStanding) <
      prompt.indexOf(threadConfigurationStanding),
    "the purpose stands before who does the work",
  );
  assert.ok(
    prompt.indexOf(threadConfigurationStanding) <
      prompt.indexOf(threadStandingRulesDefault),
    "who does the work stands before the rules",
  );
});

/**
 * A stop reaches the model as a step its user declined, and unprompted it
 * opens the next answer by explaining that. What can be checked is that the
 * thread is told a stopped turn is over and is not to be spoken of, and that
 * the telling stands apart from the purpose and after it.
 */
test("the objectives tell a thread to say nothing of a turn its owner stopped", () => {
  const prompt = threadSystemPrompt({
    partition,
    owner: "geoff",
    standingRules: threadStandingRulesDefault,
  });

  assert.match(threadStoppedStanding, /A stopped turn is over/u);
  assert.match(threadStoppedStanding, /say nothing of it/u);
  assert.match(threadStoppedStanding, /unless your owner asks/u);
  assert.ok(prompt.includes(threadStoppedStanding));
  assert.ok(
    prompt.indexOf(threadPurposeStanding) <
      prompt.indexOf(threadStoppedStanding),
    "the purpose stands before what is said of a stop",
  );
  assert.ok(
    prompt.indexOf(threadStoppedStanding) <
      prompt.indexOf(threadStandingRulesDefault),
    "what is said of a stop stands before the rules",
  );
});

/**
 * An account of what was filed is owed by a turn that was asked for a change
 * and by no other, so an answer to a question ends as an answer. A question
 * that shows its owner wants the thing changed is the one that ends on an
 * offer, or a want put as a question would be explained and left there.
 */
test("the purpose asks a turn that was asked for a change what it filed, and a question for its answer and an offer only where it shows a want", () => {
  assert.match(
    threadPurposeStanding,
    /A turn asked for a change ends by saying what you filed, or why you filed nothing\.$/u,
  );
  assert.match(
    threadPurposeStanding,
    /A question is answered from what you read, and that answer says nothing about filing: no line that nothing was filed, and no offer to file, unless the question itself shows your owner wants the thing changed, when the answer ends with one line offering to file it\./u,
  );
  assert.doesNotMatch(threadPurposeStanding, /every turn/iu);
});

/** The console draws a reference only where the agent wrote the form, so the
 * objectives carrying that form is what makes the widget reachable at all. */
test("every thread is told the form the console draws a ticket from", () => {
  const objectives = threadSystemPrompt({
    partition,
    owner: "geoff",
    standingRules: threadStandingRulesDefault,
  });

  assert.ok(objectives.includes(ticketReferenceInstruction));
  assert.deepEqual(
    ticketReferenceSplit(objectives).filter(
      (segment) => segment.kind === "Ticket",
    ),
    [{ kind: "Ticket", ticket: 15 }],
  );
});

test("a North Star is named where there is one and no heading where there is none", () => {
  const without = threadSystemPrompt({
    partition,
    owner: "geoff",
    standingRules: threadStandingRulesDefault,
  });
  const with_ = threadSystemPrompt({
    partition,
    owner: "geoff",
    northStar: "ship the console",
    standingRules: threadStandingRulesDefault,
  });

  assert.ok(!without.includes("North Star"));
  assert.ok(with_.includes("ship the console"));
});

test("an owner nobody could have been is refused, and the widest prompt fits", () => {
  assert.throws(() =>
    threadSystemPrompt({
      partition,
      owner: "",
      standingRules: threadStandingRulesDefault,
    }),
  );
  const widest = threadSystemPrompt({
    partition: {
      tenant: "t".repeat(256),
      project: "p".repeat(256),
    } as unknown as Partition,
    owner: "o".repeat(256),
    northStar: "n".repeat(selectorSettingsTextCharsMax),
    standingRules: "s".repeat(selectorSettingsTextCharsMax),
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

const seededImages = (count: number): ThreadSeededImage[] =>
  Array.from({ length: count }, (_unused, index) => ({
    artifact: `image/png:token-${String(index + 1)}`,
    mediaType: "image/png",
    path: `/image-${String(index + 1)}`,
  }));

test("an image's fetch path is the project artifact route, filled in", () => {
  assert.equal(
    threadImageFetchPath(partition, "image/png:token-1"),
    "/api/v1/tenants/acme/projects/atlas/artifacts/image%2Fpng%3Atoken-1",
  );
});

test("the images section names each one's identity, media type and fetch path", () => {
  const section = threadImagesSection(seededImages(2));

  assert.equal(
    section,
    `${threadImagesHeading}

- image/png:token-1 — image/png — fetch at /image-1
- image/png:token-2 — image/png — fetch at /image-2`,
  );
});

test("a turn with no seeding is the message alone", () => {
  assert.equal(threadTurnInput("what is blocking 42?"), "what is blocking 42?");
  assert.throws(() => threadTurnInput("x".repeat(threadTurnInputCharsMax + 1)));
});

/**
 * A turn naming no image is byte for byte what it was before this module knew
 * images existed — the one shape the boundary the console splits on may not
 * move, whether or not the caller passed an empty list.
 */
test("a turn naming no image is byte for byte what it was", () => {
  assert.equal(
    threadTurnInput("what is blocking 42?", undefined, []),
    "what is blocking 42?",
  );
  assert.equal(
    threadTurnInput("what is blocking 42?", {
      standingRules: projectStandingRules,
      drafts: [],
      refusals: [],
    }),
    threadTurnInput(
      "what is blocking 42?",
      { standingRules: projectStandingRules, drafts: [], refusals: [] },
      [],
    ),
  );
});

/**
 * A later turn carries no seeding block at all, so an image it names opens the
 * turn directly: the images section, the boundary, then the message — the
 * same shape a first turn's own block stands in front of.
 */
test("a later turn naming an image opens with the images section and the boundary", () => {
  const images = seededImages(1);

  const input = threadTurnInput("what is blocking 42?", undefined, images);

  assert.equal(
    input,
    `${threadImagesSection(images)}\n\n${threadTurnBoundaryHeading}\n\nwhat is blocking 42?`,
  );
});

test("a first turn naming an image carries the seeding block, then the images section, then the boundary", () => {
  const images = seededImages(1);
  const seeding = {
    standingRules: projectStandingRules,
    drafts: [],
    refusals: [],
  };

  const input = threadTurnInput("what is blocking 42?", seeding, images);

  assert.equal(
    input,
    `${threadSeedingText(seeding)}\n\n${threadImagesSection(images)}\n\n${threadTurnBoundaryHeading}\n\nwhat is blocking 42?`,
  );
});

test("what a turn's images section names, the contract's reader reads back, with what stood before it", () => {
  const images = seededImages(2);
  const seeding = {
    standingRules: projectStandingRules,
    drafts: [],
    refusals: [],
  };
  const block = `${threadSeedingText(seeding)}\n\n${threadImagesSection(images)}`;

  assert.deepEqual(threadImagesRead(block), {
    before: threadSeedingText(seeding),
    artifacts: images.map((image) => image.artifact),
  });
  assert.deepEqual(threadImagesRead(threadImagesSection(images)), {
    before: "",
    artifacts: images.map((image) => image.artifact),
  });
  assert.deepEqual(threadImagesRead(threadSeedingText(seeding)), {
    before: threadSeedingText(seeding),
    artifacts: [],
  });
});

test("the images section is never shed", () => {
  const images = seededImages(1);

  const input = threadTurnInput(
    "x".repeat(threadMessageCharsMax),
    {
      northStar: "ship the console",
      standingRules: projectStandingRules,
      drafts: seededDrafts(nativeHttpPageItemsMax),
      refusals: seededRefusals(32),
    },
    images,
  );

  assert.ok(input.includes(threadImagesSection(images)));
});

/**
 * An image section that will not fit once nothing sheddable is left is
 * refused rather than silently dropped — the same rule the North Star and the
 * standing rules are already held to.
 */
test("an input that cannot fit the images section once everything sheddable is shed is refused", () => {
  assert.throws(() =>
    threadTurnInput(
      "x".repeat(threadTurnInputCharsMax),
      undefined,
      seededImages(1),
    ),
  );
});

test("a first turn puts the seeding block in front of the message", () => {
  const input = threadTurnInput("what is blocking 42?", {
    northStar: "ship the console",
    standingRules: threadStandingRulesDefault,
    drafts: seededDrafts(2),
    refusals: seededRefusals(1),
  });

  assert.ok(input.endsWith("what is blocking 42?"));
  assert.ok(input.indexOf("ship the console") < input.indexOf("draft 1"));
  assert.ok(input.indexOf("draft 2") < input.indexOf("refused 1"));
  assert.ok(input.includes(threadStandingRulesDefault));
});

/**
 * The boundary is what the console splits a first turn on, so where it is
 * written is a fact about the wire and not a detail of the composition: it
 * stands between the block and the message, and the message is the whole of
 * what follows it.
 */
test("a first turn writes the boundary between the block and the message", () => {
  const input = threadTurnInput("what is blocking 42?", {
    standingRules: projectStandingRules,
    drafts: [],
    refusals: [],
  });

  assert.equal(
    input,
    `${threadSeedingText({
      standingRules: projectStandingRules,
      drafts: [],
      refusals: [],
    })}\n\n${threadTurnBoundaryHeading}\n\nwhat is blocking 42?`,
  );
  assert.equal(input.split(threadTurnBoundaryHeading).length, 2);
});

test("the drafts shed oldest first, and only then the refusals", () => {
  const filler = "d".repeat(Math.ceil(threadTurnInputCharsMax / 8));
  const drafts = Array.from({ length: 32 }, (_unused, index) => ({
    ticket: index + 1,
    summary: `[${String(index + 1)}]${filler}`,
  }));
  const message = "x".repeat(threadMessageCharsMax);

  const input = threadTurnInput(message, {
    standingRules: threadStandingRulesDefault,
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
    standingRules: threadStandingRulesDefault,
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
    standingRules: projectStandingRules,
    drafts: seededDrafts(nativeHttpPageItemsMax),
    refusals: seededRefusals(32),
  });

  assert.ok(input.includes("ship the console"));
  assert.ok(input.includes(projectStandingRules));
});

test("an input that cannot fit with everything sheddable shed is refused", () => {
  assert.throws(() =>
    threadTurnInput("x".repeat(threadTurnInputCharsMax), {
      northStar: "n".repeat(selectorSettingsTextCharsMax),
      standingRules: threadStandingRulesDefault,
      drafts: [],
      refusals: [],
    }),
  );
});

/**
 * The seeding carries a North Star and a standing the settings route has
 * already accepted and sheds neither, so a first turn at both ceilings has to
 * compose rather than raise. Refusing it would be a door no member could open
 * and no member could fix.
 */
test("both settings texts at the bound the route accepts still compose", () => {
  const northStar = "n".repeat(selectorSettingsTextCharsMax);
  const standingRules = "s".repeat(selectorSettingsTextCharsMax);

  const input = threadTurnInput("x".repeat(threadMessageCharsMax), {
    northStar,
    standingRules,
    drafts: seededDrafts(nativeHttpPageItemsMax),
    refusals: seededRefusals(32),
  });

  assert.ok(input.includes(northStar));
  assert.ok(input.includes(standingRules));
  assert.ok(input.length <= threadTurnInputCharsMax);
  assert.ok(
    input.length <= sessionTurnInputCharsMax,
    "the widest first turn is a row the mailbox column will not take",
  );
});

/** The ceiling the contract names is a claim about this block, so it is measured. */
test("what the seeding weighs beyond its two texts is inside the named ceiling", () => {
  const headings = `${threadSeedingText({
    northStar: "",
    standingRules: "",
    drafts: [{ ticket: 1, summary: "" }],
    refusals: [{ ticket: 1, reason: "" }],
  })}\n\n${threadTurnBoundaryHeading}\n\n`;

  assert.ok(headings.includes("open drafts"));
  assert.ok(headings.includes("Standing against"));
  assert.ok(headings.length <= threadSeedingFixedCharsMax);
  assert.equal(
    threadSeedingCharsMax,
    selectorSettingsTextCharsMax * 2 + threadSeedingFixedCharsMax,
  );
});

test("the seeding block omits the sections it has nothing for", () => {
  const bare = threadSeedingText({
    standingRules: projectStandingRules,
    drafts: [],
    refusals: [],
  });

  assert.ok(!bare.includes("North Star"));
  assert.ok(!bare.includes("open drafts"));
  assert.ok(!bare.includes("Standing against"));
  assert.ok(bare.includes(projectStandingRules));
});

/**
 * The block moved into the contract so the console could split it back off a
 * first turn's input. This is the text before that move, written out, because
 * the split is worth nothing if the composition drifted while it was made.
 */
test("the composed block is character for character what it was", () => {
  const composed = threadSeedingText({
    northStar: "Ship the console.",
    standingRules: threadStandingRulesDefault,
    drafts: [{ ticket: 7, summary: "the rail" }],
    refusals: [{ ticket: 9, reason: "no brief" }],
  });

  assert.equal(
    composed,
    `# North Star

Ship the console.

# Your open drafts

- 7 — the rail

# Standing against them

- 9 — no brief

# How you act on this project

${threadStandingRulesDefault}`,
  );
});
