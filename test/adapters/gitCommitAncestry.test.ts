/**
 * The commit ancestry adapter against real repositories: a remote that serves a
 * pack whole, one that stalls part-way through it, askers that overlap, and a
 * scratch whose objects stop being readable under the refs that name them.
 * What an asker is answered once a bound has passed is
 * `test/adapters/gitCommitAncestryBounds.test.ts`'s.
 *
 * A WAIT PASSES BY A CLOCK THE SUITE MOVES. A case in which a fetch fails and
 * another is then to be begun, or not, hands the adapter a clock and moves it
 * by hand, so what a wait held back is read off the fetches counted and never
 * off time that went by.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { gitCommitAncestryDefaults } from "../../src/adapters/git/gitCommitAncestry.ts";
import type {
  CommitAncestryPort,
  CommitAncestryQuestion,
} from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  type CredentialResolved,
  type GitObjectId,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";

import {
  type Fixture,
  fixtureAnswers,
  fixtureCommit,
  fixtureCredentials,
  fixtureFaulted,
  fixtureGit,
  fixtureHistoryHeld,
  fixtureNewer,
  fixtureOpen,
  fixturePort,
  fixtureQuestion,
  fixtureReads,
  fixtureRecorded,
  fixtureRecordedCount,
  fixtureScratchRepository,
  fixtureSecret,
  fixtureServe,
  fixtureServed,
  fixtureServing,
  fixtureTwin,
  fixtureUntil,
} from "./gitCommitAncestryFixture.ts";

/** Writes one commit of the seed into the scratch as an object alone, without what it descends from. */
function fixtureAlone(fixture: Fixture, commit: GitObjectId): void {
  execFileSync(
    "git",
    [
      "-C",
      fixtureScratchRepository(fixture),
      "hash-object",
      "-t",
      "commit",
      "-w",
      "--stdin",
    ],
    {
      input: execFileSync("git", [
        "-C",
        fixture.seed,
        "cat-file",
        "commit",
        commit,
      ]),
    },
  );
}

/**
 * Leaves the scratch as a long-lived one comes to be, the first tip's history
 * in one pack and a newer tip arrived loose over it, and answers that newer
 * tip.
 */
async function fixtureAged(
  fixture: Fixture,
  port: CommitAncestryPort,
): Promise<GitObjectId> {
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  fixtureGit(fixtureScratchRepository(fixture), "repack", "-adq");
  const newer = fixtureNewer(fixture);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate, newer)),
    "Ancestor",
  );
  return newer;
}

/** The one pack an aged scratch keeps its older history in: its directory and the files of it by their endings. */
function fixturePack(fixture: Fixture): {
  readonly directory: string;
  readonly ending: (ending: string) => string;
} {
  const directory = join(fixtureScratchRepository(fixture), "objects", "pack");
  return {
    directory,
    ending: (ending) => {
      const named = readdirSync(directory).find((name) =>
        name.endsWith(ending),
      );
      assert.ok(named !== undefined);
      return join(directory, named);
    },
  };
}

/** The ways an aged scratch's packed history stops being readable while its refs stand, each returning what undoes it. */
const fixtureFaults: Readonly<
  Record<string, (fixture: Fixture) => () => void>
> = {
  "its pack's index cannot be read": (fixture) => {
    const index = fixturePack(fixture).ending(".idx");
    chmodSync(index, 0o000);
    return () => {
      chmodSync(index, 0o600);
    };
  },
  "its pack cannot be read": (fixture) => {
    const pack = fixturePack(fixture).ending(".pack");
    chmodSync(pack, 0o000);
    return () => {
      chmodSync(pack, 0o600);
    };
  },
  "its pack directory cannot be read": (fixture) => {
    const { directory } = fixturePack(fixture);
    chmodSync(directory, 0o000);
    return () => {
      chmodSync(directory, 0o700);
    };
  },
  "its pack is gone": (fixture) => {
    const { directory } = fixturePack(fixture);
    const aside = join(fixture.directory, "aside");
    renameSync(directory, aside);
    return () => {
      renameSync(aside, directory);
    };
  },
};

/**
 * A credential source that counts how often it was asked, which is once for
 * each fetch begun. It refuses every repository a credential, the first ask
 * answered instead with what a test hands it.
 */
function fixtureCounted(first?: Promise<CredentialResolved>): {
  readonly credentials: RepositoryCredentialPort;
  readonly asked: () => number;
} {
  let asked = 0;
  return {
    credentials: {
      credential: () => {
        asked += 1;
        if (asked === 1 && first !== undefined) return first;
        return Promise.resolve({ resolved: "Denied" });
      },
    },
    asked: () => asked,
  };
}

/** A clock that stands still until a test moves it on, which is the one way a wait passes here. */
function fixtureClock(): {
  readonly monotonicNowMs: () => number;
  readonly pass: (ms: number) => void;
} {
  let nowMs = 0;
  return {
    monotonicNowMs: () => nowMs,
    pass: (ms) => {
      nowMs += ms;
    },
  };
}

/** The wait a port naming none gives a tip whose fetch failed, as its clock counts it. */
const fixtureRefetchWaitMs = gitCommitAncestryDefaults.refetchWaitSecs * 1000;

test("a commit the tip descends from is an ancestor", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.base)),
    "Ancestor",
  );
});

test("a commit is its own ancestor", async (t) => {
  const fixture = fixtureOpen(t);
  assert.equal(
    await fixturePort(fixture).ancestry(fixtureQuestion(fixture, fixture.tip)),
    "Ancestor",
  );
});

test("a commit the scratch holds beside the tip's history is not an ancestor", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.base));
  assert.ok(
    fixtureAnswers(
      fixtureScratchRepository(fixture),
      "cat-file",
      "-e",
      fixture.tip,
    ),
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.tip, fixture.base)),
    "NotAncestor",
  );
});

test("a commit the tip's whole history does not hold is not an ancestor", async (t) => {
  const fixture = fixtureOpen(t);
  assert.equal(
    await fixturePort(fixture).ancestry(
      fixtureQuestion(fixture, fixture.stray),
    ),
    "NotAncestor",
  );
});

test("a tip the remote no longer serves is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const gone = fixtureCommit(fixture.seed, "gone");
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "main:main");
  fixtureGit(fixture.remote, "update-ref", "refs/heads/main", fixture.tip);
  fixtureGit(fixture.remote, "gc", "-q", "--prune=now");
  assert.ok(!fixtureAnswers(fixture.remote, "cat-file", "-e", gone));

  assert.equal(
    await fixturePort(fixture).ancestry(
      fixtureQuestion(fixture, fixture.candidate, gone),
    ),
    "Unknown",
  );
});

test("a repository nothing can reach is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  assert.equal(
    await fixturePort(fixture).ancestry(
      fixtureQuestion(
        fixture,
        fixture.candidate,
        fixture.tip,
        join(fixture.directory, "missing.git"),
      ),
    ),
    "Unknown",
  );
});

test("a scratch removed under the live adapter is unknown, for a question it had answered too", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  rmSync(fixture.scratch, { recursive: true, force: true });

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
});

test("an identity of the width this repository does not address is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const wide = asGitObjectId("f".repeat(64));
  assert.equal(await port.ancestry(fixtureQuestion(fixture, wide)), "Unknown");
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate, wide)),
    "Unknown",
  );
});

test("a tip that names no commit is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const tree = fixtureGit(fixture.seed, "rev-parse", `${fixture.tip}^{tree}`);
  fixtureGit(fixture.seed, "tag", "-a", "-m", "tagged", "tagged", fixture.tip);
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "tagged");
  const tag = fixtureGit(fixture.seed, "rev-parse", "tagged");

  assert.equal(
    await port.ancestry(
      fixtureQuestion(fixture, fixture.stray, asGitObjectId(tree)),
    ),
    "Unknown",
  );
  assert.equal(
    await port.ancestry(
      fixtureQuestion(fixture, fixture.candidate, asGitObjectId(tag)),
    ),
    "Unknown",
  );
});

test("a candidate the scratch holds as something other than a commit is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const tree = fixtureGit(fixture.seed, "rev-parse", `${fixture.tip}^{tree}`);
  assert.equal(
    await fixturePort(fixture).ancestry(
      fixtureQuestion(fixture, asGitObjectId(tree)),
    ),
    "Unknown",
  );
});

test("a candidate that is a commit here without the commits it descends from is never an ancestor", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  fixtureGit(fixture.seed, "checkout", "-q", "stray");
  const beyond = fixtureCommit(fixture.seed, "beyond");
  fixtureAlone(fixture, beyond);

  assert.notEqual(
    await port.ancestry(fixtureQuestion(fixture, beyond)),
    "Ancestor",
  );
});

test("a tag is never answered for the commit it peels to, held or not", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  fixtureGit(fixture.seed, "tag", "-a", "-m", "tagged", "tagged", fixture.base);
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "tagged");
  const tag = asGitObjectId(fixtureGit(fixture.seed, "rev-parse", "tagged"));
  const scratch = fixtureScratchRepository(fixture);

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, tag)),
    "NotAncestor",
  );
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate, tag));
  assert.ok(fixtureAnswers(scratch, "cat-file", "-e", tag));
  assert.equal(await port.ancestry(fixtureQuestion(fixture, tag)), "Unknown");
});

for (const [fault, inflict] of Object.entries(fixtureFaults)) {
  test(`a commit in the tip's history is unknown while ${fault}, and an ancestor once that has passed`, async (t) => {
    const fixture = fixtureOpen(t);
    const port = fixturePort(fixture);
    const question = fixtureQuestion(
      fixture,
      fixture.candidate,
      await fixtureAged(fixture, port),
    );
    const undo = inflict(fixture);
    try {
      assert.equal(await port.ancestry(question), "Unknown");
    } finally {
      undo();
    }
    assert.equal(await port.ancestry(question), "Ancestor");
  });
}

test("a tip whose ref stands over history that is gone is fetched again, and held again", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { environment: fixtureRecorded(fixture) });
  const question = fixtureQuestion(fixture, fixture.candidate);
  assert.equal(await port.ancestry(question), "Ancestor");
  const scratch = fixtureScratchRepository(fixture);
  fixtureGit(scratch, "repack", "-adq");
  rmSync(join(scratch, "objects", "pack"), { recursive: true, force: true });
  assert.ok(fixtureHistoryHeld(fixture, fixture.tip));
  assert.ok(!fixtureAnswers(scratch, "cat-file", "-e", fixture.tip));

  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(fixtureRecordedCount(fixture, "fetch"), 2);
});

for (const [told, inherited] of [
  ["left to itself", {}],
  ["told by its environment to read one", { GIT_TEST_COMMIT_GRAPH: "1" }],
] as const) {
  test(`a commit-graph left over a pack that is gone does not answer for the commits in it, git ${told}`, async (t) => {
    const fixture = fixtureOpen(t);
    const port = fixturePort(fixture, {
      environment: {
        ...process.env,
        GIT_CONFIG_GLOBAL: join(fixture.directory, "gitconfig"),
        ...inherited,
      },
    });
    const newer = await fixtureAged(fixture, port);
    const scratch = fixtureScratchRepository(fixture);
    fixtureGit(scratch, "commit-graph", "write", "--reachable");
    rmSync(join(scratch, "objects", "pack"), { recursive: true, force: true });

    assert.equal(
      await port.ancestry(fixtureQuestion(fixture, fixture.candidate, newer)),
      "Unknown",
    );
  });
}

test("a replace ref giving the tip another commit's history is not what an answer is read through", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  fixtureAlone(fixture, fixture.stray);
  fixtureGit(
    fixtureScratchRepository(fixture),
    "replace",
    "--graft",
    fixture.tip,
    fixture.stray,
  );

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.stray)),
    "NotAncestor",
  );
});

test("a commit-graph that names a commit of the tip's history wrongly is not what the answer is read from", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  fixtureNewer(fixture);
  const question = fixtureQuestion(
    fixture,
    fixture.candidate,
    fixtureNewer(fixture, "newest"),
  );
  assert.equal(await port.ancestry(question), "Ancestor");
  const scratch = fixtureScratchRepository(fixture);
  fixtureGit(scratch, "commit-graph", "write", "--reachable");
  const graph = join(scratch, "objects", "info", "commit-graph");
  const damaged = readFileSync(graph);
  const identity = Buffer.from(fixture.candidate, "hex");
  const last = damaged.indexOf(identity) + identity.length - 1;
  assert.ok(last >= identity.length);
  damaged.writeUInt8(damaged.readUInt8(last) ^ 1, last);
  rmSync(graph);
  writeFileSync(graph, damaged);

  assert.equal(await port.ancestry(question), "Ancestor");
});

test("a no from git is unknown while a commit far under the tip cannot be read, and a finding once it can", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const newer = fixtureNewer(fixture);
  const newest = fixtureNewer(fixture, "newest");
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate, newest));
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate, newer));
  const scratch = fixtureScratchRepository(fixture);
  const under = join(
    scratch,
    "objects",
    fixture.candidate.slice(0, 2),
    fixture.candidate.slice(2),
  );
  const aside = join(fixture.directory, "aside");
  renameSync(under, aside);

  try {
    assert.equal(
      await port.ancestry(fixtureQuestion(fixture, newest, newer)),
      "Unknown",
    );
  } finally {
    renameSync(aside, under);
  }
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, newest, newer)),
    "NotAncestor",
  );
});

for (const [verb, asked, answer] of fixtureReads) {
  for (const [fault, ending] of [
    ["Killed", "ended by a signal before it looked"],
    ["Failed", "that exited as neither its yes nor its no"],
  ] as const) {
    test(`a ${verb} ${ending} decides nothing and begins no fetch, and the next ask answers`, async (t) => {
      const fixture = fixtureOpen(t);
      const port = fixturePort(fixture, {
        environment: fixtureRecorded(fixture),
      });
      const question = fixtureQuestion(fixture, fixture[asked]);
      assert.equal(await port.ancestry(question), answer);
      fixtureFaulted(fixture, verb, fault);
      assert.equal(await port.ancestry(question), "Unknown");
      fixtureFaulted(fixture, verb, "Whole");

      assert.equal(await port.ancestry(question), answer);
      assert.equal(fixtureRecordedCount(fixture, "fetch"), 1);
    });
  }
}

test("a lookup of the candidate stopped at its bound decides nothing, and the next ask answers", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    environment: fixtureRecorded(fixture),
    localTimeoutSecsMax: 1,
  });
  const question = fixtureQuestion(fixture, fixture.candidate);
  assert.equal(await port.ancestry(question), "Ancestor");
  fixtureFaulted(fixture, "cat-file", "Stalled");
  assert.equal(await port.ancestry(question), "Unknown");
  fixtureFaulted(fixture, "cat-file", "Whole");

  assert.equal(await port.ancestry(question), "Ancestor");
});

test("a git that cannot be run is unknown and raises nothing, for a tip held, a repository not yet opened and a fetch alike", async (t) => {
  const fixture = fixtureOpen(t);
  const environment: Record<string, string | undefined> = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(fixture.directory, "gitconfig"),
  };
  const found = environment["PATH"];
  let lostAtFetch = false;
  const clock = fixtureClock();
  const port = fixturePort(fixture, {
    environment,
    monotonicNowMs: clock.monotonicNowMs,
    credentials: {
      credential: () => {
        if (lostAtFetch) environment["PATH"] = fixture.directory;
        return Promise.resolve({ resolved: "Denied" });
      },
    },
  });
  const held = fixtureQuestion(fixture, fixture.candidate);
  const twin = fixtureQuestion(
    fixture,
    fixture.candidate,
    fixture.tip,
    fixtureTwin(fixture),
  );
  assert.equal(await port.ancestry(held), "Ancestor");
  environment["PATH"] = fixture.directory;
  assert.equal(await port.ancestry(held), "Unknown");
  assert.equal(await port.ancestry(twin), "Unknown");
  environment["PATH"] = found;
  lostAtFetch = true;
  assert.equal(await port.ancestry(twin), "Unknown");
  environment["PATH"] = found;
  lostAtFetch = false;
  clock.pass(fixtureRefetchWaitMs);

  assert.equal(await port.ancestry(twin), "Ancestor");
  assert.equal(await port.ancestry(held), "Ancestor");
});

test("a tip another ref named before its history arrived is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const scratch = fixtureScratchRepository(fixture);
  execFileSync("git", ["init", "-q", "--bare", scratch]);
  fixtureAlone(fixture, fixture.tip);
  fixtureGit(scratch, "update-ref", "refs/chuggy/candidate/tip", fixture.tip);

  assert.equal(
    await fixturePort(fixture).ancestry(
      fixtureQuestion(fixture, fixture.candidate),
    ),
    "Unknown",
  );
  assert.equal(
    fixtureGit(scratch, "rev-parse", `refs/chuggy/history/${fixture.tip}`),
    fixture.tip,
  );
  assert.equal(fixtureServed(fixture), 0);
});

test("a credential source that could not answer is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    credentials: fixtureCredentials({ resolved: "Unavailable" }),
  });
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
});

test("a credential source that raises is what every asker waiting on that fetch is raised, and the next ask fetches", async (t) => {
  const fixture = fixtureOpen(t);
  let down = true;
  const port = fixturePort(fixture, {
    credentials: {
      credential: () =>
        down
          ? Promise.reject(new Error("source down"))
          : Promise.resolve({ resolved: "Denied" }),
    },
  });
  const question = fixtureQuestion(fixture, fixture.candidate);
  const raised = await Promise.allSettled([
    port.ancestry(question),
    port.ancestry(question),
  ]);
  assert.deepEqual(
    raised.map((asked) => asked.status === "rejected" && String(asked.reason)),
    ["Error: source down", "Error: source down"],
  );
  down = false;

  assert.equal(await port.ancestry(question), "Ancestor");
});

test("a repository the source refuses a credential for is fetched without one", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    credentials: fixtureCredentials({ resolved: "Denied" }),
  });
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.match(
    readFileSync(join(fixture.directory, "credential"), "utf8"),
    /^password=$/mu,
  );
});

test("the fetch carries the credential the source resolved", async (t) => {
  const fixture = fixtureOpen(t);
  await fixturePort(fixture).ancestry(
    fixtureQuestion(fixture, fixture.candidate),
  );
  assert.match(
    readFileSync(join(fixture.directory, "credential"), "utf8"),
    new RegExp(`^password=${fixtureSecret}$`, "mu"),
  );
});

test("a fetch stopped part-way writes no ref for its tip, and an ask once its wait has passed answers from a whole one", async (t) => {
  const fixture = fixtureOpen(t);
  const clock = fixtureClock();
  const port = fixturePort(fixture, {
    remoteTimeoutSecsMax: 2,
    monotonicNowMs: clock.monotonicNowMs,
  });
  fixtureServe(fixture, "Stalled");
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  assert.equal(
    fixtureGit(fixtureScratchRepository(fixture), "for-each-ref"),
    "",
  );

  fixtureServe(fixture, "Whole");
  clock.pass(fixtureRefetchWaitMs);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
});

test("a second asker during a slowed fetch waits on it without reading the scratch and starts no other", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { environment: fixtureRecorded(fixture) });
  fixtureServe(fixture, "Slowed");
  const first = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureServing(fixture, 1);
  assert.equal(
    fixtureGit(fixtureScratchRepository(fixture), "for-each-ref"),
    "",
  );
  const second = port.ancestry(fixtureQuestion(fixture, fixture.candidate));

  assert.deepEqual(await Promise.all([first, second]), [
    "Ancestor",
    "Ancestor",
  ]);
  assert.equal(fixtureServed(fixture), 1);
  assert.equal(fixtureRecordedCount(fixture, "rev-parse"), 2);
});

test("many askers at once are each answered from one fetch", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const round = [fixture.candidate, fixture.stray, fixture.base, fixture.tip];

  assert.deepEqual(
    await Promise.all(
      [...round, ...round, ...round].map((candidate) =>
        port.ancestry(fixtureQuestion(fixture, candidate)),
      ),
    ),
    Array.from({ length: 3 }, () => [
      "Ancestor",
      "NotAncestor",
      "Ancestor",
      "Ancestor",
    ]).flat(),
  );
  assert.equal(fixtureServed(fixture), 1);
});

test("askers at once of a tip that cannot be fetched share the one attempt at it", async (t) => {
  const fixture = fixtureOpen(t);
  let resolutions = 0;
  const port = fixturePort(fixture, {
    credentials: {
      credential: async () => {
        resolutions += 1;
        await sleep(500);
        return { resolved: "Denied" };
      },
    },
  });
  const question = fixtureQuestion(
    fixture,
    fixture.candidate,
    fixture.tip,
    join(fixture.directory, "missing.git"),
  );

  assert.deepEqual(
    await Promise.all(Array.from({ length: 6 }, () => port.ancestry(question))),
    Array.from({ length: 6 }, () => "Unknown"),
  );
  assert.equal(resolutions, 1);
});

test("two repositories holding one tip are each fetched for themselves", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const twin = fixtureTwin(fixture);

  assert.deepEqual(
    await Promise.all([
      port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
      port.ancestry(
        fixtureQuestion(fixture, fixture.candidate, fixture.tip, twin),
      ),
    ]),
    ["Ancestor", "Ancestor"],
  );
});

test("a tip asked for while as many fetches as may run already are is unknown until one has ended", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { fetchesInFlightMax: 1 });
  const twin = fixtureQuestion(
    fixture,
    fixture.candidate,
    fixture.tip,
    fixtureTwin(fixture),
  );
  fixtureServe(fixture, "Slowed");
  const first = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureServing(fixture, 1);

  assert.equal(await port.ancestry(twin), "Unknown");
  assert.equal(await first, "Ancestor");
  fixtureServe(fixture, "Whole");
  assert.equal(await port.ancestry(twin), "Ancestor");
});

test("a tip already held is answered while as many fetches as may run already are", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { fetchesInFlightMax: 1 });
  const twin = fixtureTwin(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  fixtureServe(fixture, "Slowed");
  const slowed = port.ancestry(
    fixtureQuestion(fixture, fixture.candidate, fixture.tip, twin),
  );
  await fixtureServing(fixture, 2);

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.stray)),
    "NotAncestor",
  );
  assert.equal(
    fixtureGit(fixtureScratchRepository(fixture, twin), "for-each-ref"),
    "",
  );
  assert.equal(await slowed, "Ancestor");
});

test("a second tip of a repository waits for the fetch of the first before its own begins", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const newer = fixtureNewer(fixture);
  fixtureServe(fixture, "Slowed");
  const first = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureServing(fixture, 1);
  fixtureServe(fixture, "Whole");
  const second = port.ancestry(
    fixtureQuestion(fixture, fixture.candidate, newer),
  );
  await sleep(500);
  assert.equal(fixtureServed(fixture), 1);

  assert.deepEqual(await Promise.all([first, second]), [
    "Ancestor",
    "Ancestor",
  ]);
  assert.equal(fixtureServed(fixture), 2);
});

test("a tip already held is answered while another tip of its repository is being fetched", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  const newer = fixtureNewer(fixture);
  fixtureServe(fixture, "Slowed");
  const slowed = port.ancestry(
    fixtureQuestion(fixture, fixture.candidate, newer),
  );
  await fixtureServing(fixture, 2);

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.stray)),
    "NotAncestor",
  );
  assert.ok(!fixtureHistoryHeld(fixture, newer));
  assert.equal(await slowed, "Ancestor");
});

/** A question about the fixture's tip in a repository that is not there until `fixtureLaterComes` has made it. */
function fixtureLater(fixture: Fixture): CommitAncestryQuestion {
  return fixtureQuestion(
    fixture,
    fixture.candidate,
    fixture.tip,
    join(fixture.directory, "later.git"),
  );
}

function fixtureLaterComes(fixture: Fixture): void {
  execFileSync("git", [
    "clone",
    "-q",
    "--bare",
    fixture.remote,
    join(fixture.directory, "later.git"),
  ]);
}

test("a tip whose fetch failed is asked of no remote and no credential source until its wait has passed, and is fetched then", async (t) => {
  const fixture = fixtureOpen(t);
  const clock = fixtureClock();
  const counted = fixtureCounted();
  const port = fixturePort(fixture, {
    refetchWaitSecs: 7,
    monotonicNowMs: clock.monotonicNowMs,
    credentials: counted.credentials,
  });
  const question = fixtureLater(fixture);
  assert.equal(await port.ancestry(question), "Unknown");
  fixtureLaterComes(fixture);
  clock.pass(7 * 1000 - 1);
  assert.equal(await port.ancestry(question), "Unknown");
  assert.deepEqual([counted.asked(), fixtureServed(fixture)], [1, 0]);

  clock.pass(1);
  assert.equal(await port.ancestry(question), "Ancestor");
  assert.deepEqual([counted.asked(), fixtureServed(fixture)], [2, 1]);
});

/**
 * Waits for the one fetch a port may run at once to have ended, by asking about
 * a second repository until that one is fetched in its turn. An ask about the
 * tip in flight would wait on the fetch and be told its end, which a case about
 * a fetch nobody is waiting on cannot have.
 */
function fixtureTurnGivenBack(
  port: CommitAncestryPort,
  twin: CommitAncestryQuestion,
): Promise<void> {
  return fixtureUntil(
    "the turn a fetch gives back at its end",
    async () => (await port.ancestry(twin)) === "Ancestor",
  );
}

test("a fetch that fails with no asker left waiting on it begins its tip's wait all the same", async (t) => {
  const fixture = fixtureOpen(t);
  const clock = fixtureClock();
  const counted = fixtureCounted();
  const port = fixturePort(fixture, {
    answerTimeoutSecsMax: 2,
    remoteTimeoutSecsMax: 3,
    fetchesInFlightMax: 1,
    monotonicNowMs: clock.monotonicNowMs,
    credentials: counted.credentials,
  });
  const question = fixtureQuestion(fixture, fixture.candidate);
  const twin = fixtureQuestion(
    fixture,
    fixture.candidate,
    fixture.tip,
    fixtureTwin(fixture),
  );
  fixtureServe(fixture, "Stalled");
  const stalled = port.ancestry(question);
  await fixtureServing(fixture, 1);
  fixtureServe(fixture, "Whole");
  assert.equal(await stalled, "Unknown");
  await fixtureTurnGivenBack(port, twin);

  assert.equal(await port.ancestry(question), "Unknown");
  assert.deepEqual([counted.asked(), fixtureServed(fixture)], [2, 2]);
  clock.pass(fixtureRefetchWaitMs);
  assert.equal(await port.ancestry(question), "Ancestor");
  assert.deepEqual([counted.asked(), fixtureServed(fixture)], [3, 3]);
});

for (const [failing, first] of [
  [
    "could not answer",
    Promise.resolve<CredentialResolved>({ resolved: "Unavailable" }),
  ],
  [
    "never answered inside the remote bound",
    new Promise<never>(() => undefined),
  ],
] as const) {
  test(`a credential source that ${failing} begins its tip's wait, and is asked again once that has passed`, async (t) => {
    const fixture = fixtureOpen(t);
    const clock = fixtureClock();
    const counted = fixtureCounted(first);
    const port = fixturePort(fixture, {
      remoteTimeoutSecsMax: 2,
      monotonicNowMs: clock.monotonicNowMs,
      credentials: counted.credentials,
    });
    const question = fixtureQuestion(fixture, fixture.candidate);
    assert.equal(await port.ancestry(question), "Unknown");
    assert.equal(await port.ancestry(question), "Unknown");
    assert.equal(counted.asked(), 1);

    clock.pass(fixtureRefetchWaitMs);
    assert.equal(await port.ancestry(question), "Ancestor");
    assert.equal(counted.asked(), 2);
  });
}

test("a wait is its own tip's in its own repository, and another tip or another repository is fetched inside it", async (t) => {
  const fixture = fixtureOpen(t);
  const counted = fixtureCounted();
  const port = fixturePort(fixture, {
    monotonicNowMs: fixtureClock().monotonicNowMs,
    credentials: counted.credentials,
  });
  assert.equal(await port.ancestry(fixtureLater(fixture)), "Unknown");
  assert.equal(
    await port.ancestry(
      fixtureQuestion(fixture, fixture.candidate, fixture.stray),
    ),
    "Unknown",
  );
  assert.equal(counted.asked(), 2);

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.equal(counted.asked(), 3);
});

test("an asker waiting behind a fetch that fails for another tip goes on to a fetch of its own", async (t) => {
  const fixture = fixtureOpen(t);
  let asked = 0;
  const port = fixturePort(fixture, {
    monotonicNowMs: fixtureClock().monotonicNowMs,
    credentials: {
      credential: async () => {
        asked += 1;
        if (asked === 1) await sleep(500);
        return { resolved: "Denied" };
      },
    },
  });
  const first = port.ancestry(
    fixtureQuestion(fixture, fixture.candidate, fixture.stray),
  );
  await fixtureUntil("the fetch", () => asked === 1);
  const second = port.ancestry(fixtureQuestion(fixture, fixture.candidate));

  assert.deepEqual(await Promise.all([first, second]), ["Unknown", "Ancestor"]);
  assert.equal(asked, 2);
});

test("an ask inside its tip's wait is answered at once while another tip of its repository is being fetched", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    monotonicNowMs: fixtureClock().monotonicNowMs,
  });
  const unserved = fixtureQuestion(fixture, fixture.candidate, fixture.stray);
  assert.equal(await port.ancestry(unserved), "Unknown");
  const served = fixtureServed(fixture);
  fixtureServe(fixture, "Slowed");
  const slowed = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureServing(fixture, served + 1);

  assert.equal(await port.ancestry(unserved), "Unknown");
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));
  assert.equal(await slowed, "Ancestor");
});

test("a tip that came to be held inside its wait is answered from the scratch", async (t) => {
  const fixture = fixtureOpen(t);
  const counted = fixtureCounted();
  const waiting = fixturePort(fixture, {
    monotonicNowMs: fixtureClock().monotonicNowMs,
    credentials: counted.credentials,
  });
  const question = fixtureLater(fixture);
  assert.equal(await waiting.ancestry(question), "Unknown");
  fixtureLaterComes(fixture);
  assert.equal(await fixturePort(fixture).ancestry(question), "Ancestor");

  assert.equal(await waiting.ancestry(question), "Ancestor");
  assert.equal(counted.asked(), 1);
});

test("an ask inside its tip's wait is unknown though a later tip's fetch has brought that tip's whole history, and is answered once the wait has passed", async (t) => {
  const fixture = fixtureOpen(t);
  const clock = fixtureClock();
  const counted = fixtureCounted();
  const port = fixturePort(fixture, {
    monotonicNowMs: clock.monotonicNowMs,
    credentials: counted.credentials,
  });
  const question = fixtureLater(fixture);
  const { repository } = question.repository;
  assert.equal(await port.ancestry(question), "Unknown");
  const newer = fixtureNewer(fixture);
  fixtureLaterComes(fixture);
  assert.equal(
    await port.ancestry(
      fixtureQuestion(fixture, fixture.candidate, newer, repository),
    ),
    "Ancestor",
  );
  assert.ok(
    fixtureAnswers(
      fixtureScratchRepository(fixture, repository),
      "merge-base",
      "--is-ancestor",
      fixture.candidate,
      fixture.tip,
    ),
  );

  assert.equal(await port.ancestry(question), "Unknown");
  assert.equal(counted.asked(), 2);
  clock.pass(fixtureRefetchWaitMs);
  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(counted.asked(), 3);
});

test("a fetch that landed once its tip's wait had passed leaves no wait, and the tip is fetched at once when it stops being held", async (t) => {
  const fixture = fixtureOpen(t);
  const clock = fixtureClock();
  const counted = fixtureCounted();
  const port = fixturePort(fixture, {
    monotonicNowMs: clock.monotonicNowMs,
    credentials: counted.credentials,
  });
  const question = fixtureLater(fixture);
  assert.equal(await port.ancestry(question), "Unknown");
  fixtureLaterComes(fixture);
  clock.pass(fixtureRefetchWaitMs);
  assert.equal(await port.ancestry(question), "Ancestor");
  fixtureGit(
    fixtureScratchRepository(fixture, question.repository.repository),
    "update-ref",
    "-d",
    `refs/chuggy/history/${fixture.tip}`,
  );

  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(counted.asked(), 3);
});

test("the waits kept are as many as may be, and the one begun before the others is forgotten for one more", async (t) => {
  const fixture = fixtureOpen(t);
  const clock = fixtureClock();
  const counted = fixtureCounted();
  const port = fixturePort(fixture, {
    refetchWaitsMax: 3,
    monotonicNowMs: clock.monotonicNowMs,
    credentials: counted.credentials,
  });
  const asks = async (...tips: readonly GitObjectId[]): Promise<number> => {
    for (const tip of tips) {
      const question = fixtureQuestion(
        fixture,
        fixture.candidate,
        tip,
        join(fixture.directory, "missing.git"),
      );
      assert.equal(await port.ancestry(question), "Unknown");
    }
    return counted.asked();
  };
  const { base: first, candidate: second, stray: third, tip: fourth } = fixture;
  assert.equal(await asks(first, second), 2);
  clock.pass(fixtureRefetchWaitMs);
  assert.equal(await asks(first, third, fourth), 5);
  assert.equal(await asks(first, third, fourth), 5);

  assert.equal(await asks(second, first), 7);
});

test("a bound or a wait of the adapter's own that is no positive integer is refused", (t) => {
  const fixture = fixtureOpen(t);
  for (const bound of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => fixturePort(fixture, { fetchesInFlightMax: bound }),
      RangeError,
    );
    assert.throws(
      () => fixturePort(fixture, { answerTimeoutSecsMax: bound }),
      RangeError,
    );
    assert.throws(
      () => fixturePort(fixture, { fetchWaitersMax: bound }),
      RangeError,
    );
    assert.throws(
      () => fixturePort(fixture, { refetchWaitSecs: bound }),
      RangeError,
    );
    assert.throws(
      () => fixturePort(fixture, { refetchWaitsMax: bound }),
      RangeError,
    );
  }
});
