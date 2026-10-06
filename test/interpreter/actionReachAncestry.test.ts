/**
 * What one process keeps of commit ancestry, held to its bounds by counting
 * what reaches the port beneath. The port is a double that records every
 * question put to it, and the clock stands still until a case moves it on, so
 * no case waits on a timer or reads the time.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { gitCommitAncestryDefaults } from "../../src/adapters/git/gitCommitAncestry.ts";
import {
  actionReachAncestry,
  actionReachAncestryDefaults,
  type ActionReachAncestry,
  type ActionReachAncestryOptions,
} from "../../src/interpreter/actionReachAncestry.ts";
import type {
  CommitAncestry,
  CommitAncestryQuestion,
} from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

/** One question, its commits named by a hex digit apiece. */
function question(
  tip: string,
  candidate = "c",
  repository = "https://forge.example/acme/engine.git",
): CommitAncestryQuestion {
  return {
    repository: {
      partition: {
        tenant: asTenantId("tenant"),
        project: asProjectId("project"),
      },
      repository: asRepositoryId(repository),
      recoveryEpoch: asRecoveryEpoch("epoch"),
    },
    candidate: asGitObjectId(candidate.repeat(40)),
    tip: asGitObjectId(tip.repeat(40)),
  };
}

/** A port that answers each tip as its table says, a tip the table does not name left waiting until the case lets it go. */
interface Fixture {
  readonly kept: ActionReachAncestry;
  /** Every tip put to the port, in order, by its digit. */
  readonly asked: string[];
  /** Answers the oldest question the port is still holding. */
  readonly release: (answer: CommitAncestry | Error) => void;
  readonly pass: (ms: number) => void;
}

function fixture(
  answers: Readonly<Record<string, CommitAncestry | Error>>,
  chosen: Partial<ActionReachAncestryOptions> = {},
): Fixture {
  const asked: string[] = [];
  const held: ((answer: CommitAncestry | Error) => void)[] = [];
  let nowMs = 0;
  const kept = actionReachAncestry({
    port: {
      ancestry: (put) => {
        const digit = put.tip.slice(0, 1);
        asked.push(digit);
        const answer = answers[digit];
        if (answer instanceof Error) return Promise.reject(answer);
        if (answer !== undefined) return Promise.resolve(answer);
        return new Promise((resolve, reject) => {
          held.push((given) => {
            if (given instanceof Error) reject(given);
            else resolve(given);
          });
        });
      },
    },
    monotonicNowMs: () => nowMs,
    ...chosen,
  });
  return {
    kept,
    asked,
    release: (answer) => {
      const oldest = held.shift();
      assert.ok(oldest !== undefined, "the port holds no question");
      oldest(answer);
    },
    pass: (ms) => {
      nowMs += ms;
    },
  };
}

const waitMs = actionReachAncestryDefaults.undecidedWaitSecs * 1000;

test("a decided answer is kept and the port is not asked again", async () => {
  const { kept, asked } = fixture({ a: "Ancestor", b: "NotAncestor" });
  assert.equal(kept.decided(question("a")), undefined);
  assert.equal(await kept.ask(question("a")), "Ancestor");
  assert.equal(await kept.ask(question("b")), "NotAncestor");
  for (let again = 0; again < 3; again += 1) {
    assert.equal(await kept.ask(question("a")), "Ancestor");
    assert.equal(await kept.ask(question("b")), "NotAncestor");
  }
  assert.equal(kept.decided(question("a")), "Ancestor");
  assert.equal(kept.decided(question("b")), "NotAncestor");
  assert.deepEqual(asked, ["a", "b"]);
});

test("a question is kept under its repository and both its commits", async () => {
  const { kept, asked } = fixture({ a: "Ancestor", b: "NotAncestor" });
  await kept.ask(question("a"));
  assert.equal(kept.decided(question("a", "d")), undefined);
  assert.equal(kept.decided(question("b")), undefined);
  assert.equal(
    kept.decided(question("a", "c", "https://forge.example/acme/other.git")),
    undefined,
  );
  await kept.ask(question("a", "d"));
  await kept.ask(question("a", "c", "https://forge.example/acme/other.git"));
  assert.deepEqual(asked, ["a", "a", "a"]);
});

test("an undecided question is unknown at once, with nothing asked, until its wait has passed", async () => {
  const { kept, asked, pass } = fixture({ a: "Unknown" });
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.equal(kept.decided(question("a")), undefined);
  for (let again = 0; again < 5; again += 1)
    assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a"]);
  pass(waitMs - 1);
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a"]);
  pass(1);
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a question undecided once and decided after its wait is kept from then on", async () => {
  const { kept, asked, release, pass } = fixture({});
  const first = kept.ask(question("a"));
  release("Unknown");
  assert.equal(await first, "Unknown");
  pass(waitMs);
  const second = kept.ask(question("a"));
  release("Ancestor");
  assert.equal(await second, "Ancestor");
  assert.equal(await kept.ask(question("a")), "Ancestor");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a port that raises is unknown and never a rejection, and is not asked again inside the wait", async () => {
  const { kept, asked, pass } = fixture({ a: new Error("no credential") });
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a"]);
  pass(waitMs);
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a port that throws before it answers is unknown too, and is asked again once the wait has passed", async () => {
  const asked: string[] = [];
  let nowMs = 0;
  const kept = actionReachAncestry({
    port: {
      ancestry: (put) => {
        asked.push(put.tip.slice(0, 1));
        throw new Error("no credential source");
      },
    },
    monotonicNowMs: () => nowMs,
  });
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a"]);
  nowMs += waitMs;
  assert.equal(await kept.ask(question("a")), "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a question asked again while in flight joins that asking", async () => {
  const { kept, asked, release } = fixture({});
  const askers = [1, 2, 3].map(() => kept.ask(question("a")));
  assert.deepEqual(asked, ["a"]);
  release("Ancestor");
  assert.deepEqual(await Promise.all(askers), [
    "Ancestor",
    "Ancestor",
    "Ancestor",
  ]);
  assert.deepEqual(asked, ["a"]);
});

test("a question past those in flight is unknown at once, asks nothing, and begins no wait", async () => {
  const { kept, asked, release } = fixture({}, { asksInFlightMax: 2 });
  const flying = [kept.ask(question("a")), kept.ask(question("b"))];
  assert.equal(await kept.ask(question("d")), "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  release("Ancestor");
  release("NotAncestor");
  await Promise.all(flying);
  const due = kept.ask(question("d"));
  assert.deepEqual(asked, ["a", "b", "d"]);
  release("Ancestor");
  assert.equal(await due, "Ancestor");
});

test("a question past those undecided is unknown at once and asks nothing, those in flight counted among them", async () => {
  const { kept, asked, release, pass } = fixture({}, { undecidedMax: 2 });
  const first = kept.ask(question("a"));
  release("Unknown");
  await first;
  const flying = kept.ask(question("b"));
  for (const tip of ["d", "e"])
    assert.equal(await kept.ask(question(tip)), "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  release("Unknown");
  await flying;
  assert.equal(await kept.ask(question("d")), "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  pass(waitMs);
  const due = kept.ask(question("d"));
  assert.deepEqual(asked, ["a", "b", "d"]);
  release("Ancestor");
  assert.equal(await due, "Ancestor");
});

test("a decided question leaves the undecided count, so deciding makes room", async () => {
  const { kept, asked } = fixture(
    { a: "Ancestor", b: "NotAncestor", d: "Ancestor" },
    { undecidedMax: 1 },
  );
  for (const tip of ["a", "b", "d"]) await kept.ask(question(tip));
  assert.deepEqual(asked, ["a", "b", "d"]);
});

test("the decided answers kept are held to their count, the one decided first forgotten for one more", async () => {
  const { kept, asked } = fixture(
    { a: "Ancestor", b: "NotAncestor", d: "Ancestor" },
    { decidedMax: 2 },
  );
  for (const tip of ["a", "b", "d"]) await kept.ask(question(tip));
  assert.equal(kept.decided(question("a")), undefined);
  assert.equal(kept.decided(question("b")), "NotAncestor");
  assert.equal(kept.decided(question("d")), "Ancestor");
  await kept.ask(question("a"));
  assert.deepEqual(asked, ["a", "b", "d", "a"]);
  assert.equal(kept.decided(question("b")), undefined);
});

test("a bound or a wait that is not a positive integer refuses the composition", () => {
  for (const chosen of [
    { decidedMax: 0 },
    { undecidedMax: 0 },
    { undecidedWaitSecs: 0 },
    { asksInFlightMax: 0 },
    { decidedMax: 1.5 },
    { undecidedMax: -1 },
    { undecidedWaitSecs: Number.NaN },
    { asksInFlightMax: Number.POSITIVE_INFINITY },
  ])
    assert.throws(
      () => fixture({}, chosen),
      RangeError,
      JSON.stringify(chosen),
    );
});

/**
 * The adapter beneath forgets the wait of the tip that began one first once it
 * keeps as many as it may, and a tip whose wait it forgot is fetched again at
 * once. Each undecided place here is taken by one tip for a whole wait of this
 * module's, so the tips this module can put to the adapter inside one of the
 * adapter's waits are its places times the turns one place has in that time.
 */
test("the tips put to the adapter inside one of its waits are fewer than the waits it keeps", () => {
  const { undecidedMax, undecidedWaitSecs } = actionReachAncestryDefaults;
  const { refetchWaitSecs, refetchWaitsMax } = gitCommitAncestryDefaults;
  const turns = Math.ceil(refetchWaitSecs / undecidedWaitSecs) + 1;
  assert.ok(undecidedMax * turns <= refetchWaitsMax);
});
