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
import { ticketActionReachAsksMax } from "../../src/interpreter/ticketActionReach.ts";

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

const otherRepository = "https://forge.example/acme/other.git";

/** A question of its own for each number: the tip named, in the repository named, about a candidate no other number names. */
function numbered(
  at: number,
  tip: string,
  repository?: string,
): CommitAncestryQuestion {
  return {
    ...question(tip, "c", repository),
    candidate: asGitObjectId(at.toString(16).padStart(40, "0")),
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
  assert.equal(await kept.ask(question("a")).answer, "Ancestor");
  assert.equal(await kept.ask(question("b")).answer, "NotAncestor");
  for (let again = 0; again < 3; again += 1) {
    assert.equal(await kept.ask(question("a")).answer, "Ancestor");
    assert.equal(await kept.ask(question("b")).answer, "NotAncestor");
  }
  assert.equal(kept.decided(question("a")), "Ancestor");
  assert.equal(kept.decided(question("b")), "NotAncestor");
  assert.deepEqual(asked, ["a", "b"]);
});

test("a question is kept under its repository and both its commits", async () => {
  const { kept, asked } = fixture({ a: "Ancestor", b: "NotAncestor" });
  await kept.ask(question("a")).answer;
  assert.equal(kept.decided(question("a", "d")), undefined);
  assert.equal(kept.decided(question("b")), undefined);
  assert.equal(
    kept.decided(question("a", "c", "https://forge.example/acme/other.git")),
    undefined,
  );
  await kept.ask(question("a", "d")).answer;
  await kept.ask(question("a", "c", "https://forge.example/acme/other.git"))
    .answer;
  assert.deepEqual(asked, ["a", "a", "a"]);
});

test("an undecided question is unknown at once, with nothing asked, until its wait has passed", async () => {
  const { kept, asked, pass } = fixture({ a: "Unknown" });
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.equal(kept.decided(question("a")), undefined);
  for (let again = 0; again < 5; again += 1)
    assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a"]);
  pass(waitMs - 1);
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a"]);
  pass(1);
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a question undecided once and decided after its wait is kept from then on", async () => {
  const { kept, asked, release, pass } = fixture({});
  const first = kept.ask(question("a")).answer;
  release("Unknown");
  assert.equal(await first, "Unknown");
  pass(waitMs);
  const second = kept.ask(question("a")).answer;
  release("Ancestor");
  assert.equal(await second, "Ancestor");
  assert.equal(await kept.ask(question("a")).answer, "Ancestor");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a port that raises is unknown and never a rejection, and is not asked again inside the wait", async () => {
  const { kept, asked, pass } = fixture({ a: new Error("no credential") });
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a"]);
  pass(waitMs);
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
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
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a"]);
  nowMs += waitMs;
  assert.equal(await kept.ask(question("a")).answer, "Unknown");
  assert.deepEqual(asked, ["a", "a"]);
});

test("a question asked again while in flight joins that asking", async () => {
  const { kept, asked, release } = fixture({});
  const askers = [1, 2, 3].map(() => kept.ask(question("a")).answer);
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
  const flying = [
    kept.ask(question("a")).answer,
    kept.ask(question("b")).answer,
  ];
  assert.equal(await kept.ask(question("d")).answer, "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  release("Ancestor");
  release("NotAncestor");
  await Promise.all(flying);
  const due = kept.ask(question("d")).answer;
  assert.deepEqual(asked, ["a", "b", "d"]);
  release("Ancestor");
  assert.equal(await due, "Ancestor");
});

test("a question past those undecided is unknown at once and asks nothing, those in flight counted among them", async () => {
  const { kept, asked, release, pass } = fixture({}, { undecidedMax: 2 });
  const first = kept.ask(question("a")).answer;
  release("Unknown");
  await first;
  const flying = kept.ask(question("b")).answer;
  for (const tip of ["d", "e"])
    assert.equal(await kept.ask(question(tip)).answer, "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  release("Unknown");
  await flying;
  assert.equal(await kept.ask(question("d")).answer, "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  pass(waitMs);
  const due = kept.ask(question("d")).answer;
  assert.deepEqual(asked, ["a", "b", "d"]);
  release("Ancestor");
  assert.equal(await due, "Ancestor");
});

test("one repository's undecided questions, as many as may be undecided at once, leave another repository's question asked", async () => {
  const { kept, asked } = fixture({ a: "Unknown", b: "Ancestor" });
  for (let at = 0; at < actionReachAncestryDefaults.undecidedMax; at += 1)
    assert.equal(await kept.ask(numbered(at, "a")).answer, "Unknown");
  assert.equal(
    await kept.ask(question("b", "c", otherRepository)).answer,
    "Ancestor",
  );
  assert.equal(asked.filter((tip) => tip === "b").length, 1);
});

test("a question past those of its repository undecided is unknown at once and asks nothing, those in flight counted among them, and another repository's is asked", async () => {
  const { kept, asked, release, pass } = fixture(
    {},
    { undecidedRepositoryMax: 2 },
  );
  const first = kept.ask(question("a")).answer;
  release("Unknown");
  await first;
  const flying = kept.ask(question("b")).answer;
  assert.equal(await kept.ask(question("d")).answer, "Unknown");
  assert.deepEqual(asked, ["a", "b"]);
  const other = kept.ask(question("d", "c", otherRepository)).answer;
  assert.deepEqual(asked, ["a", "b", "d"]);
  release("Unknown");
  await flying;
  assert.equal(await kept.ask(question("e")).answer, "Unknown");
  release("Ancestor");
  assert.equal(await other, "Ancestor");
  assert.deepEqual(asked, ["a", "b", "d"]);
  pass(waitMs);
  const due = kept.ask(question("e")).answer;
  assert.deepEqual(asked, ["a", "b", "d", "e"]);
  release("Ancestor");
  assert.equal(await due, "Ancestor");
});

test("the count over every repository holds whatever room each repository's own leaves", async () => {
  const { kept, asked } = fixture(
    { a: "Unknown" },
    { undecidedMax: 2, undecidedRepositoryMax: 1 },
  );
  const repositories = ["one", "two", "three"].map(
    (named) => `https://forge.example/acme/${named}.git`,
  );
  for (const repository of repositories)
    assert.equal(
      await kept.ask(question("a", "c", repository)).answer,
      "Unknown",
    );
  assert.deepEqual(asked, ["a", "a"]);
});

test("an asking says whether it put its question to the port: the one that began it did, and one joined, kept, inside its wait or refused for a count did not", async () => {
  const { kept, asked, release } = fixture(
    { b: "Unknown" },
    { asksInFlightMax: 1, undecidedRepositoryMax: 2 },
  );
  const began = kept.ask(question("a"));
  assert.equal(began.put, true);
  assert.equal(kept.ask(question("a")).put, false, "joined");
  assert.equal(kept.ask(question("d")).put, false, "past those in flight");
  release("Ancestor");
  await began.answer;
  assert.equal(kept.ask(question("a")).put, false, "kept");
  const undecided = kept.ask(question("b"));
  assert.equal(undecided.put, true);
  await undecided.answer;
  assert.equal(kept.ask(question("b")).put, false, "inside its wait");
  await kept.ask(numbered(1, "b")).answer;
  assert.equal(kept.ask(question("d")).put, false, "past those undecided");
  assert.deepEqual(asked, ["a", "b", "b"]);
});

test("a decided question leaves both undecided counts, so deciding makes room", async () => {
  for (const chosen of [{ undecidedMax: 1 }, { undecidedRepositoryMax: 1 }]) {
    const { kept, asked } = fixture(
      { a: "Ancestor", b: "NotAncestor", d: "Ancestor" },
      chosen,
    );
    for (const tip of ["a", "b", "d"]) await kept.ask(question(tip)).answer;
    assert.deepEqual(asked, ["a", "b", "d"], JSON.stringify(chosen));
  }
});

test("the decided answers kept are held to their count, the one decided first forgotten for one more", async () => {
  const { kept, asked } = fixture(
    { a: "Ancestor", b: "NotAncestor", d: "Ancestor" },
    { decidedMax: 2 },
  );
  for (const tip of ["a", "b", "d"]) await kept.ask(question(tip)).answer;
  assert.equal(kept.decided(question("a")), undefined);
  assert.equal(kept.decided(question("b")), "NotAncestor");
  assert.equal(kept.decided(question("d")), "Ancestor");
  await kept.ask(question("a")).answer;
  assert.deepEqual(asked, ["a", "b", "d", "a"]);
  assert.equal(kept.decided(question("b")), undefined);
});

test("a bound or a wait that is not a positive integer refuses the composition", () => {
  for (const chosen of [
    { decidedMax: 0 },
    { undecidedMax: 0 },
    { undecidedRepositoryMax: 0 },
    { undecidedWaitSecs: 0 },
    { asksInFlightMax: 0 },
    { decidedMax: 1.5 },
    { undecidedMax: -1 },
    { undecidedRepositoryMax: 1.5 },
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

/**
 * A read's questions are all of one repository, so a count of that
 * repository's own above what one read may put leaves a place for the
 * questions past a read's worth that could not be decided. What it leaves of
 * the count over all is no fewer than one read may put, so one repository at
 * its count is never what refuses a read of another.
 */
test("one repository's undecided questions may be more than one read puts, and leave the rest no fewer places than one read puts", () => {
  const { undecidedMax, undecidedRepositoryMax } = actionReachAncestryDefaults;
  assert.ok(undecidedRepositoryMax > ticketActionReachAsksMax);
  assert.ok(undecidedMax - undecidedRepositoryMax >= ticketActionReachAsksMax);
});
