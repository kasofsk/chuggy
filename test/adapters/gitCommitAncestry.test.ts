/**
 * The commit ancestry adapter against real repositories: a remote that serves a
 * pack whole, one that stalls part-way through it, and askers that overlap.
 *
 * THE REMOTE IS SLOWED WHERE GIT ITSELF HANDS OVER A PACK. `uploadpack`'s own
 * hook stands between the remote's objects and the fetch, so a stalled or
 * slowed transfer here is a real fetch left part-way and not a stand-in for
 * one. It runs inside the fetch that asked, so every pack the remote built is
 * a line the suite can count and the credential that fetch was given is there
 * to be read.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  gitCommitAncestry,
  gitCommitAncestryDefaults,
  type GitCommitAncestryOptions,
} from "../../src/adapters/git/gitCommitAncestry.ts";
import { scratchDigestOf } from "../../src/adapters/git/gitScratch.ts";
import type {
  CommitAncestryPort,
  CommitAncestryQuestion,
} from "../../src/interpreter/commitAncestry.ts";
import {
  asGitObjectId,
  asRepositoryCredential,
  asRepositoryId,
  type CredentialResolved,
  type GitObjectId,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

/** The secret the fixture's credential source hands out. */
const fixtureSecret = "fixture-secret-a1b2c3";

/** How a fixture's remote hands a pack over. */
type FixtureServing = "Whole" | "Stalled" | "Slowed";

/**
 * What the remote runs in place of building a pack directly. It lets the
 * pack's opening through and then stalls or pauses, which is far enough for
 * the tip commit and not for what it descends from — the stopped-fetch test
 * reads that off the scratch rather than taking it from here.
 */
const fixtureServeText = [
  "#!/bin/sh",
  'here=$(dirname "$0")',
  'echo served >> "$here/served"',
  '"$here/scratch/credential-helper" get > "$here/credential"',
  'case "$(cat "$here/serving")" in',
  'Stalled) "$@" | { dd bs=1 count=600 2>/dev/null; sleep 60; } ;;',
  'Slowed) "$@" | { dd bs=1 count=600 2>/dev/null; sleep 2; cat; } ;;',
  '*) exec "$@" ;;',
  "esac",
  "",
].join("\n");

/** One fixture: a bare origin holding a merge of one branch, a commit it never received, and the scratch the adapter opens. */
interface Fixture {
  readonly directory: string;
  readonly remote: string;
  readonly seed: string;
  readonly scratch: string;
  readonly base: GitObjectId;
  readonly candidate: GitObjectId;
  readonly stray: GitObjectId;
  readonly tip: GitObjectId;
}

function fixtureGit(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", directory, "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  ).trim();
}

/** Whether git answers one question about a repository with success, asked directly so a test sees what was left there. */
function fixtureAnswers(directory: string, ...args: string[]): boolean {
  try {
    execFileSync("git", ["-C", directory, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** One commit over whatever is checked out, its message too long and too random to fit in a pack's opening beside the tip. */
function fixtureCommit(seed: string, file: string): GitObjectId {
  writeFileSync(join(seed, file), `${file}\n`);
  fixtureGit(seed, "add", "-A");
  fixtureGit(
    seed,
    "commit",
    "-qm",
    `${file} ${randomBytes(1024).toString("hex")}`,
  );
  return asGitObjectId(fixtureGit(seed, "rev-parse", "HEAD"));
}

/** The history every test asks about: a base, a branch merged over it as the tip, and a stray commit the remote is never sent. */
function fixtureHistory(
  seed: string,
  remote: string,
): Pick<Fixture, "base" | "candidate" | "stray" | "tip"> {
  const base = fixtureCommit(seed, "base");
  fixtureGit(seed, "checkout", "-q", "-b", "stray");
  const stray = fixtureCommit(seed, "stray");
  fixtureGit(seed, "checkout", "-q", "-b", "work", base);
  const candidate = fixtureCommit(seed, "candidate");
  fixtureGit(seed, "checkout", "-q", "main");
  fixtureGit(seed, "merge", "-q", "--no-ff", "-m", "tip", "work");
  const tip = asGitObjectId(fixtureGit(seed, "rev-parse", "HEAD"));
  fixtureGit(seed, "push", "-q", remote, "main:main");
  return { base, candidate, stray, tip };
}

// jscpd:ignore-start -- this suite owns its real repository lifecycle
function fixtureRepositories(
  t: TestContext,
): Pick<Fixture, "directory" | "remote" | "seed"> {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-ancestry-git-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const remote = join(directory, "origin.git");
  const seed = join(directory, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  fixtureGit(seed, "config", "user.name", "fixture");
  fixtureGit(seed, "config", "user.email", "fixture@example.test");
  return { directory, remote, seed };
}
// jscpd:ignore-end -- fixture lifecycle region ends

/**
 * What the remote's git is configured with. Its packs go through the serving
 * script and carry no deltas, so the tip commit opens one, and it honours a
 * filter, so a fetch that asked for less than everything would be given less.
 */
function fixtureConfigurationText(directory: string): string {
  return [
    "[uploadpack]",
    `\tpackObjectsHook = ${join(directory, "serve")}`,
    "\tallowFilter = true",
    "[pack]",
    "\twindow = 0",
    "",
  ].join("\n");
}

function fixtureOpen(t: TestContext): Fixture {
  const { directory, remote, seed } = fixtureRepositories(t);
  writeFileSync(join(directory, "serve"), fixtureServeText, { mode: 0o755 });
  writeFileSync(join(directory, "serving"), "Whole");
  writeFileSync(
    join(directory, "gitconfig"),
    fixtureConfigurationText(directory),
  );
  return {
    directory,
    remote,
    seed,
    scratch: join(directory, "scratch"),
    ...fixtureHistory(seed, remote),
  };
}

function fixtureServe(fixture: Fixture, serving: FixtureServing): void {
  writeFileSync(join(fixture.directory, "serving"), serving);
}

/** How many packs the remote has built, which is how many fetches actually transferred anything. */
function fixtureServed(fixture: Fixture): number {
  const served = join(fixture.directory, "served");
  if (!existsSync(served)) return 0;
  return readFileSync(served, "utf8").split("\n").filter(Boolean).length;
}

/** The scratch's own repository for one remote, where a test reads what a fetch left. */
function fixtureScratchRepository(
  fixture: Fixture,
  repository: string = fixture.remote,
): string {
  return join(fixture.scratch, scratchDigestOf(repository));
}

/** Waits for the tip commit to stand in one remote's scratch, which is the middle of a slowed fetch. */
async function fixtureTipArrived(
  fixture: Fixture,
  repository: string = fixture.remote,
): Promise<void> {
  const scratch = fixtureScratchRepository(fixture, repository);
  for (let waits = 0; waits < 400; waits += 1) {
    if (fixtureAnswers(scratch, "cat-file", "-e", fixture.tip)) return;
    await sleep(25);
  }
  assert.fail("the fetch never brought the tip in");
}

/** A second remote holding the same history, which is a second repository to the adapter. */
function fixtureTwin(fixture: Fixture): string {
  const twin = join(fixture.directory, "twin.git");
  execFileSync("git", ["clone", "-q", "--bare", fixture.remote, twin]);
  return twin;
}

function fixtureCredentials(
  resolved: CredentialResolved,
): RepositoryCredentialPort {
  return { credential: () => Promise.resolve(resolved) };
}

function fixturePort(
  fixture: Fixture,
  chosen: Partial<GitCommitAncestryOptions> = {},
): CommitAncestryPort {
  return gitCommitAncestry({
    scratchDirectory: fixture.scratch,
    identity: { name: "chug", email: "chug@example.test" },
    environment: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(fixture.directory, "gitconfig"),
    },
    credentials: fixtureCredentials({
      resolved: "Credential",
      credential: asRepositoryCredential(fixtureSecret),
    }),
    ...chosen,
  });
}

function fixtureQuestion(
  fixture: Fixture,
  candidate: GitObjectId,
  tip: GitObjectId = fixture.tip,
  repository: string = fixture.remote,
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
    candidate,
    tip,
  };
}

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

test("a scratch removed under the live adapter is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  rmSync(fixture.scratch, { recursive: true, force: true });

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.stray)),
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

test("a candidate that names no commit is unknown", async (t) => {
  const fixture = fixtureOpen(t);
  const tree = fixtureGit(fixture.seed, "rev-parse", `${fixture.tip}^{tree}`);
  assert.equal(
    await fixturePort(fixture).ancestry(
      fixtureQuestion(fixture, asGitObjectId(tree)),
    ),
    "Unknown",
  );
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

test("a fetch stopped part-way leaves the tip without its history, and the next ask answers from a whole one", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { remoteTimeoutSecsMax: 2 });
  const scratch = fixtureScratchRepository(fixture);
  fixtureServe(fixture, "Stalled");
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  assert.ok(fixtureAnswers(scratch, "cat-file", "-e", fixture.tip));
  assert.ok(!fixtureAnswers(scratch, "cat-file", "-e", fixture.candidate));
  assert.equal(fixtureGit(scratch, "for-each-ref"), "");

  fixtureServe(fixture, "Whole");
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
});

test("a second asker during a slowed fetch waits on it and starts no other", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  fixtureServe(fixture, "Slowed");
  const first = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureTipArrived(fixture);
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
  await fixtureTipArrived(fixture);

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
  await fixtureTipArrived(fixture, twin);

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

test("a remote that stalls is unknown once the bound the adapter was given has passed", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { remoteTimeoutSecsMax: 1 });
  fixtureServe(fixture, "Stalled");
  const asked = performance.now();
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  const waitedMs = performance.now() - asked;
  assert.ok(waitedMs >= 1000);
  assert.ok(waitedMs < gitCommitAncestryDefaults.remoteTimeoutSecsMax * 1000);
});

test("an unknown is not remembered", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const later = join(fixture.directory, "later.git");
  const question = fixtureQuestion(
    fixture,
    fixture.candidate,
    fixture.tip,
    later,
  );
  assert.equal(await port.ancestry(question), "Unknown");

  execFileSync("git", ["clone", "-q", "--bare", fixture.remote, later]);
  assert.equal(await port.ancestry(question), "Ancestor");
});

test("a decided answer outlives the scratch it was read from", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await port.ancestry(fixtureQuestion(fixture, fixture.stray));
  rmSync(fixture.scratch, { recursive: true, force: true });

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.stray)),
    "NotAncestor",
  );
});

test("an answer is remembered for the repository it was read from and no other", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));

  assert.equal(
    await port.ancestry(
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

test("the oldest remembered answer leaves once the count is past its bound", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { rememberedAnswersMax: 1 });
  await port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await port.ancestry(fixtureQuestion(fixture, fixture.stray));
  rmSync(fixture.scratch, { recursive: true, force: true });

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.stray)),
    "NotAncestor",
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
});

test("a count that is no positive integer is refused", (t) => {
  const fixture = fixtureOpen(t);
  for (const count of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => fixturePort(fixture, { fetchesInFlightMax: count }),
      RangeError,
    );
    assert.throws(
      () => fixturePort(fixture, { rememberedAnswersMax: count }),
      RangeError,
    );
  }
});
