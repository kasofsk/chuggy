/**
 * The read of one ticket's action reach over doubles that record what was
 * asked of them: the access, the store, the port ancestry is asked of, and the
 * pacing its bound waits on. A bound is proved by counting what reached a
 * double, and time passes only when a case lets the pacing go.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  actionReachEarlierReadMax,
  actionReachEarlierSuccessesMax,
  type ActionReachEarlierSuccess,
  type ActionReachNewest,
  type ActionReachObservation,
} from "../../src/interpreter/actionReach.ts";
import {
  actionReachAncestry,
  actionReachAncestryDefaults,
} from "../../src/interpreter/actionReachAncestry.ts";
import type {
  CommitAncestry,
  CommitAncestryQuestion,
} from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  asRepositoryId,
  type GitObjectId,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import type {
  RepositoryActionId,
  RepositoryActionName,
} from "../../src/interpreter/repositoryAction.ts";
import { repositoryDeclarationsMax } from "../../src/interpreter/repositoryDeclaration.ts";
import type { RuntimePacing } from "../../src/interpreter/serviceRuntime.ts";
import {
  asTicketLandedStamp,
  ticketActionReachAnswerSecsMax,
  ticketActionReachAsksMax,
  ticketActionReaches,
  type ActionReachDeclared,
  type ActionReachEarlierQuery,
  type TicketActionReach,
  type TicketActionReachStore,
  type TicketLanded,
} from "../../src/interpreter/ticketActionReach.ts";

const principal = asPrincipal("caller");
const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const ticket = asTicketId(7);
const repository = asRepositoryId("https://forge.example/acme/engine.git");
const binding = {
  partition,
  repository,
  recoveryEpoch: asRecoveryEpoch("epoch"),
};
const since = asTicketLandedStamp("2026-01-01 00:00:00+00");

/** A commit named by a run of hex, so a fixture reads as the tips it weighs. */
function commitOf(named: string): GitObjectId {
  return asGitObjectId(named.padEnd(40, "0"));
}

const landedCommit = commitOf("c");
const landedAt: TicketLanded = {
  landed: "At",
  repository: binding,
  retired: false,
  commit: landedCommit,
  since,
};

function reported(
  ordinal: number,
  outcome: ActionReachObservation["outcome"],
  named: string,
): ActionReachObservation {
  return {
    ordinal,
    outcome,
    commit: commitOf(named),
    receivedAt: asPublicInstant("2026-01-02T00:00:00.000000Z"),
  };
}

/** One declared action whose newest report is a success at the commit named, or of which nothing was reported. */
function declared(action: string, tip?: string): ActionReachDeclared {
  const success = tip === undefined ? undefined : reported(2, "Succeeded", tip);
  const newest: ActionReachNewest =
    success === undefined ? {} : { success, report: success };
  return {
    action: action as RepositoryActionId,
    name: `The ${action}` as RepositoryActionName,
    newest,
  };
}

interface Fixture {
  readonly reaches: ReturnType<typeof ticketActionReaches>;
  /** What the access was asked, in order. */
  readonly authorized: unknown[];
  /** Each store read by its name, in order. */
  readonly stored: string[];
  readonly earlierAsked: ActionReachEarlierQuery[];
  /** Every question put to the port beneath what the process keeps. */
  readonly asked: CommitAncestryQuestion[];
  /** Each wait the read began: how long, whether it was let go, and the means to let its time pass. */
  readonly waits: { ms: number; signal: AbortSignal; pass: () => void }[];
  /** Answers the oldest question the port is still holding. */
  readonly release: (answer: CommitAncestry) => void;
  readonly deny: () => void;
  /** Moves on the clock the kept answers read their waits on, which no read moves. */
  readonly pass: (ms: number) => void;
}

/** A store answering as a case told it, each read recorded by its name and each read of earlier successes whole. */
function fixtureStore(
  own: Pick<Fixture, "stored" | "earlierAsked">,
  landed: TicketLanded | undefined,
  declares: readonly ActionReachDeclared[],
  earlier: readonly ActionReachEarlierSuccess[],
): TicketActionReachStore {
  return {
    landed: (where, which) => {
      assert.deepEqual([where, which], [partition, ticket]);
      own.stored.push("landed");
      return Promise.resolve(landed);
    },
    declared: (where, which) => {
      assert.deepEqual([where, which], [partition, repository]);
      own.stored.push("declared");
      return Promise.resolve(declares);
    },
    earlier: (query) => {
      own.stored.push("earlier");
      own.earlierAsked.push(query);
      return Promise.resolve(earlier);
    },
  };
}

/** A pacing whose wait passes when a case says so, or when the read that began it lets it go. */
function fixturePacing(waits: Fixture["waits"]): RuntimePacing {
  return {
    wait: (ms, signal) =>
      new Promise((resolve) => {
        waits.push({ ms, signal, pass: resolve });
        signal.addEventListener("abort", () => {
          resolve();
        });
      }),
  };
}

/**
 * The read over doubles. `answers` names each tip's answer by the run of hex
 * that names it, a tip it does not name being held by the port until the case
 * lets it go.
 */
function fixture(
  landed: TicketLanded | undefined,
  declares: readonly ActionReachDeclared[] = [],
  answers: Readonly<Record<string, CommitAncestry>> = {},
  earlier: readonly ActionReachEarlierSuccess[] = [],
): Fixture {
  const authorized: unknown[] = [];
  const stored: string[] = [];
  const earlierAsked: ActionReachEarlierQuery[] = [];
  const asked: CommitAncestryQuestion[] = [];
  const waits: Fixture["waits"] = [];
  const held: ((answer: CommitAncestry) => void)[] = [];
  let allowed = true;
  let nowMs = 0;
  const table = new Map(
    Object.entries(answers).map(([named, answer]) => [commitOf(named), answer]),
  );
  const reaches = ticketActionReaches({
    access: {
      authorize: (who, where, kind) => {
        authorized.push({ who, where, kind });
        return Promise.resolve(allowed ? memberAuthority(who) : undefined);
      },
      authorizeTenant: () => Promise.resolve(undefined),
    },
    store: fixtureStore({ stored, earlierAsked }, landed, declares, earlier),
    ancestry: actionReachAncestry({
      port: {
        ancestry: (put) => {
          asked.push(put);
          const answer = table.get(put.tip);
          return answer === undefined
            ? new Promise((resolve) => held.push(resolve))
            : Promise.resolve(answer);
        },
      },
      monotonicNowMs: () => nowMs,
    }),
    pacing: fixturePacing(waits),
  });
  return {
    reaches,
    authorized,
    stored,
    earlierAsked,
    asked,
    waits,
    release: (answer) => {
      const oldest = held.shift();
      assert.ok(oldest !== undefined, "the port holds no question");
      oldest(answer);
    },
    deny: () => {
      allowed = false;
    },
    pass: (ms) => {
      nowMs += ms;
    },
  };
}

function read(own: Fixture): Promise<TicketActionReach | undefined> {
  return own.reaches.read(principal, partition, ticket);
}

/** Each action's mark by its identity, which is all most cases weigh. */
function marks(
  reach: TicketActionReach | undefined,
): Readonly<Record<string, string>> {
  assert.ok(reach !== undefined && reach.landed === "At");
  return Object.fromEntries(
    reach.actions.map((each) => [each.action, each.mark.reach]),
  );
}

test("a caller the project does not admit to read is answered nothing, and nothing is read for them", async () => {
  const own = fixture(landedAt, [declared("build", "a")], { a: "Ancestor" });
  own.deny();
  assert.equal(await read(own), undefined);
  assert.deepEqual(own.authorized, [
    { who: principal, where: partition, kind: "Read" },
  ]);
  assert.deepEqual(own.stored, []);
  assert.deepEqual(own.asked, []);
  assert.deepEqual(own.waits, []);
});

test("a ticket the project does not have is answered nothing", async () => {
  const own = fixture(undefined);
  assert.equal(await read(own), undefined);
  assert.deepEqual(own.stored, ["landed"]);
});

test("a ticket landed nowhere answers that alone: nothing declared is read and nothing is asked", async () => {
  const own = fixture({ landed: "Nowhere" }, [declared("build", "a")], {
    a: "Ancestor",
  });
  assert.deepEqual(await read(own), { landed: "Nowhere" });
  assert.deepEqual(own.stored, ["landed"]);
  assert.deepEqual(own.asked, []);
  assert.deepEqual(own.waits, []);
});

test("a landed ticket answers its repository, its commit, and each declared action's mark in the order declared", async () => {
  const build = declared("build", "a");
  const own = fixture(
    landedAt,
    [build, declared("deploy"), declared("publish", "b")],
    { a: "Ancestor", b: "Unknown" },
  );
  assert.deepEqual(await read(own), {
    landed: "At",
    repository,
    commit: landedCommit,
    actions: [
      {
        action: "build",
        name: "The build",
        mark: { reach: "Reached", observation: build.newest.success },
      },
      { action: "deploy", name: "The deploy", mark: { reach: "NotYet" } },
      { action: "publish", name: "The publish", mark: { reach: "Unknown" } },
    ],
  });
  assert.deepEqual(own.stored, ["landed", "declared"]);
});

test("every question is the server's own: the ticket's binding, the commit it landed at, and a tip from the action's log", async () => {
  const own = fixture(landedAt, [declared("build", "a")], { a: "Ancestor" });
  await read(own);
  assert.deepEqual(own.asked, [
    { repository: binding, candidate: landedCommit, tip: commitOf("a") },
  ]);
});

test("a repository whose binding is retired answers its commit and no actions, and what it last declared is not read", async () => {
  const own = fixture({ ...landedAt, retired: true }, [declared("build", "a")]);
  assert.deepEqual(await read(own), {
    landed: "At",
    repository,
    commit: landedCommit,
    actions: [],
  });
  assert.deepEqual(own.stored, ["landed"]);
  assert.deepEqual(own.asked, []);
});

test("the successes beneath an action's newest are read for it alone, beneath its ordinal and against when the ticket landed", async () => {
  const beneath = reported(1, "Succeeded", "b");
  const own = fixture(
    landedAt,
    [declared("build", "a"), declared("deploy")],
    { a: "NotAncestor", b: "Ancestor" },
    [{ observation: beneath, sinceLanded: true }],
  );
  const reach = await read(own);
  assert.deepEqual(marks(reach), { build: "RolledBack", deploy: "NotYet" });
  assert.deepEqual(own.earlierAsked, [
    {
      partition,
      action: "build",
      beneath: 2,
      count: actionReachEarlierReadMax,
      since,
    },
  ]);
});

test("a tip two actions share is put to the port once", async () => {
  const own = fixture(
    landedAt,
    [declared("build", "a"), declared("publish", "a")],
    { a: "Ancestor" },
  );
  assert.deepEqual(marks(await read(own)), {
    build: "Reached",
    publish: "Reached",
  });
  assert.equal(own.asked.length, 1);
});

/** More actions than one read may ask about, each with a newest success at a tip of its own that holds the ticket's commit. */
function pastTheAsks(): {
  readonly declares: readonly ActionReachDeclared[];
  readonly answers: Record<string, CommitAncestry>;
} {
  const tips = Array.from({ length: ticketActionReachAsksMax + 4 }, (_, at) =>
    (at + 1).toString(16).padStart(4, "a"),
  );
  return {
    declares: tips.map((tip) => declared(`action-${tip}`, tip)),
    answers: Object.fromEntries(tips.map((tip) => [tip, "Ancestor" as const])),
  };
}

test("one read puts as many questions as it may over all its actions, and the actions past them are unknown", async () => {
  const { declares, answers } = pastTheAsks();
  const own = fixture(landedAt, declares, answers);
  const reach = Object.values(marks(await read(own)));
  assert.equal(own.asked.length, ticketActionReachAsksMax);
  assert.deepEqual(reach, [
    ...declares.slice(0, ticketActionReachAsksMax).map(() => "Reached"),
    ...declares.slice(ticketActionReachAsksMax).map(() => "Unknown"),
  ]);
});

test("an answer already kept costs a read none of its questions, so the reads after one cut short finish it", async () => {
  const { declares, answers } = pastTheAsks();
  const own = fixture(landedAt, declares, answers);
  await read(own);
  const again = Object.values(marks(await read(own)));
  assert.deepEqual(
    again,
    declares.map(() => "Reached"),
  );
  assert.equal(own.asked.length, declares.length);
  await read(own);
  assert.equal(own.asked.length, declares.length);
});

/** As many actions as one read may ask about, each with a newest success at a tip of its own that cannot be decided, ahead by identity of one whose tip holds the ticket's commit. */
function undecidedAhead(): {
  readonly declares: readonly ActionReachDeclared[];
  readonly answers: Record<string, CommitAncestry>;
  readonly held: GitObjectId;
} {
  const lost = Array.from({ length: ticketActionReachAsksMax }, (_, at) =>
    (at + 1).toString(16).padStart(4, "d"),
  );
  return {
    declares: [
      ...lost.map((tip) => declared(`action-${tip}`, tip)),
      declared("zone", "eeee"),
    ],
    answers: {
      ...Object.fromEntries(lost.map((tip) => [tip, "Unknown" as const])),
      eeee: "Ancestor",
    },
    held: commitOf("eeee"),
  };
}

test("a question answered at once from its wait costs a read none of its questions, so the action past as many undecided as a read may put is asked about by a read that comes inside their waits", async () => {
  const { declares, answers, held } = undecidedAhead();
  const own = fixture(landedAt, declares, answers);
  assert.equal(marks(await read(own))["zone"], "Unknown");
  assert.equal(own.asked.length, ticketActionReachAsksMax);
  assert.equal(marks(await read(own))["zone"], "Reached");
  assert.deepEqual(
    own.asked.slice(ticketActionReachAsksMax).map((put) => put.tip),
    [held],
  );
});

test("the exception: reads that come no sooner than the waits pass put the same undecided questions again each time, and the action past them stays unknown", async () => {
  const { declares, answers, held } = undecidedAhead();
  const own = fixture(landedAt, declares, answers);
  for (const reads of [1, 2, 3]) {
    assert.equal(marks(await read(own))["zone"], "Unknown");
    assert.equal(own.asked.length, reads * ticketActionReachAsksMax);
    own.pass(actionReachAncestryDefaults.undecidedWaitSecs * 1000);
  }
  assert.ok(own.asked.every((put) => put.tip !== held));
});

test("the longest reading an action can ask for is taken to its end across reads, and is unknown where a commit past those it may weigh lay beneath it", async () => {
  const success = reported(40, "Succeeded", "a0");
  const failure = reported(41, "Failed", "f0");
  const earlier = Array.from(
    { length: actionReachEarlierSuccessesMax + 1 },
    (_, at): ActionReachEarlierSuccess => ({
      observation: reported(39 - at, "Succeeded", `e${String(at + 10)}`),
      sinceLanded: true,
    }),
  );
  const none = Object.fromEntries(
    [success, failure, ...earlier.map((each) => each.observation)].map(
      (each) => [each.commit, "NotAncestor" as const],
    ),
  );
  const own = fixture(
    landedAt,
    [
      {
        action: "build" as RepositoryActionId,
        name: "The build" as RepositoryActionName,
        newest: { success, report: failure },
      },
    ],
    none,
    earlier,
  );
  assert.deepEqual(marks(await read(own)), { build: "Unknown" });
  assert.equal(own.asked.length, ticketActionReachAsksMax);
  assert.deepEqual(marks(await read(own)), { build: "Unknown" });
  assert.deepEqual(
    own.asked.map((put) => put.tip),
    [
      success,
      failure,
      ...earlier.slice(0, -1).map((each) => each.observation),
    ].map((each) => each.commit),
    "every commit the reading may weigh was asked once, and the one past them never",
  );
  const walked = fixture(
    landedAt,
    [
      {
        action: "build" as RepositoryActionId,
        name: "The build" as RepositoryActionName,
        newest: { success, report: failure },
      },
    ],
    none,
    earlier.slice(0, -1),
  );
  await read(walked);
  assert.deepEqual(marks(await read(walked)), { build: "NotYet" });
});

/** Lets what is already due run, turn by turn, until a condition holds; a case that never comes to it fails rather than waits. */
async function until(holds: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 1000 && !holds(); turn += 1)
    await Promise.resolve();
  assert.ok(holds(), what);
}

test("a read waits on its questions for its stated time and no longer: what is kept is still answered, and nothing more is asked or read", async () => {
  const declares = [declared("deploy", "b"), declared("rig", "e")];
  const own = fixture(landedAt, declares, {
    b: "Ancestor",
    d: "Ancestor",
    e: "NotAncestor",
  });
  assert.deepEqual(marks(await read(own)), {
    deploy: "Reached",
    rig: "NotYet",
  });
  assert.deepEqual(own.stored, ["landed", "declared", "earlier"]);
  assert.equal(own.asked.length, 2);

  declares.unshift(declared("build", "a"));
  declares.push(declared("publish", "d"));
  const cut = read(own);
  await until(() => own.asked.length === 3, "the port was asked of the tip");
  assert.equal(own.waits[1]?.ms, ticketActionReachAnswerSecsMax * 1000);
  assert.equal(own.waits[1]?.signal.aborted, false);
  own.waits[1]?.pass();
  assert.deepEqual(marks(await cut), {
    build: "Unknown",
    deploy: "Reached",
    rig: "Unknown",
    publish: "Unknown",
  });
  assert.equal(own.asked.length, 3);
  assert.deepEqual(own.stored.slice(3), ["landed", "declared"]);

  own.release("Ancestor");
  assert.deepEqual(marks(await read(own)), {
    build: "Reached",
    deploy: "Reached",
    rig: "NotYet",
    publish: "Reached",
  });
  assert.equal(own.asked.length, 4);
});

test("a read that ends inside its time lets its wait go", async () => {
  const own = fixture(landedAt, [declared("build", "a")], { a: "Ancestor" });
  await read(own);
  assert.equal(own.waits.length, 1);
  assert.equal(own.waits[0]?.ms, ticketActionReachAnswerSecsMax * 1000);
  assert.equal(own.waits[0]?.signal.aborted, true);
});

test("more actions than a repository declares is refused rather than read", async () => {
  const own = fixture(
    landedAt,
    Array.from({ length: repositoryDeclarationsMax + 1 }, (_, at) =>
      declared(`action-${String(at)}`),
    ),
  );
  await assert.rejects(read(own), RangeError);
});
