/**
 * The commit ancestry adapter against real repositories: a remote that serves a
 * pack whole, one that stalls part-way through it, askers that overlap, and a
 * scratch whose objects stop being readable under the refs that name them.
 *
 * THE REMOTE IS SLOWED WHERE GIT ITSELF HANDS OVER A PACK. `uploadpack`'s own
 * hook stands between the remote's objects and the fetch, so a stalled or
 * slowed transfer here is a real fetch left part-way and not a stand-in for
 * one. It runs inside the fetch that asked, so every pack the remote built is
 * a line the suite can count and the credential that fetch was given is there
 * to be read.
 *
 * THE ADAPTER'S OWN CALLS ARE COUNTED AND FAULTED AT ITS GIT. Where a test says
 * how many reads were made, or has one of them die or outlast its bound, a
 * script named `git` stands in front of the real one on the adapter's path
 * alone. What the adapter did is then read off the calls it made rather than
 * off how long it took.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  gitCommitAncestry,
  type GitCommitAncestryOptions,
} from "../../src/adapters/git/gitCommitAncestry.ts";
import type { GitEnvironment } from "../../src/adapters/git/gitRun.ts";
import { scratchDigestOf } from "../../src/adapters/git/gitScratch.ts";
import type {
  CommitAncestry,
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
 * What the remote runs in place of building a pack directly. It takes how it is
 * to serve, writes that it has begun, lets the pack's opening through and then
 * stalls or pauses, which leaves the fetch that asked part-way through its
 * transfer.
 */
const fixtureServeText = [
  "#!/bin/sh",
  'here=$(dirname "$0")',
  'read serving secs < "$here/serving"',
  'echo served >> "$here/served"',
  '"$here/scratch/credential-helper" get > "$here/credential"',
  'case "$serving" in',
  'Stalled) "$@" | { dd bs=1 count=600 2>/dev/null; sleep 60; } ;;',
  'Slowed) "$@" | { dd bs=1 count=600 2>/dev/null; sleep "$secs"; cat; } ;;',
  '*) exec "$@" ;;',
  "esac",
  "",
].join("\n");

/** The verbs the adapter reads and fills a scratch with, which are the calls a recording git counts. */
type FixtureVerb =
  "fetch" | "rev-parse" | "cat-file" | "merge-base" | "rev-list";

/** How one verb's calls go through a recording git: as git has them, ended by a signal or by git's own code for a failure before git ran, or begun only after a pause. */
type FixtureFault = "Whole" | "Killed" | "Failed" | "Stalled";

/**
 * A git in front of the real one. It writes the verb of every call the adapter
 * makes as a line, and the calls of the one verb the fixture names die before
 * git has run or reach it late, a late one writing a line once it has ended.
 */
function fixtureRecordingText(git: string): string {
  return [
    "#!/bin/sh",
    'here=$(dirname "$0")',
    'read faulted fault < "$here/faulted"',
    'for arg in "$@"; do',
    '  case "$arg" in',
    "  fetch | rev-parse | cat-file | merge-base | rev-list)",
    '    echo "$arg" >> "$here/calls"',
    '    [ "$arg" = "$faulted" ] || break',
    '    case "$fault" in',
    "    Killed) kill -KILL $$ ;;",
    "    Failed) exit 128 ;;",
    `    Stalled) sleep 3; '${git}' "$@"; code=$?; echo ended >> "$here/calls"; exit $code ;;`,
    "    esac",
    "    break ;;",
    "  esac",
    "done",
    `exec '${git}' "$@"`,
    "",
  ].join("\n");
}

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
  writeFileSync(join(directory, "serving"), "Whole\n");
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

/** Has the remote hand its packs over one way from here on, a slowed one pausing for the seconds given. */
function fixtureServe(
  fixture: Fixture,
  serving: FixtureServing,
  slowedSecs = 2,
): void {
  writeFileSync(
    join(fixture.directory, "serving"),
    `${serving} ${String(slowedSecs)}\n`,
  );
}

/** Has the calls of one verb go through the recording git one way from here on. */
function fixtureFaulted(
  fixture: Fixture,
  verb: FixtureVerb,
  fault: FixtureFault,
): void {
  writeFileSync(
    join(fixture.directory, "recording", "faulted"),
    `${verb} ${fault}\n`,
  );
}

/** The environment of a port whose every git call goes through a recording git, which nothing is faulted at until a test says so. */
function fixtureRecorded(fixture: Fixture): GitEnvironment {
  const recording = join(fixture.directory, "recording");
  mkdirSync(recording);
  const git = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(join(recording, "git"), fixtureRecordingText(git), {
    mode: 0o755,
  });
  fixtureFaulted(fixture, "fetch", "Whole");
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(fixture.directory, "gitconfig"),
    PATH: `${recording}:${process.env["PATH"] ?? ""}`,
  };
}

/** What the recording git has written, in order: the verb of each call, and `ended` for each late call that has ended. */
function fixtureRecordedLines(fixture: Fixture): readonly string[] {
  const calls = join(fixture.directory, "recording", "calls");
  if (!existsSync(calls)) return [];
  return readFileSync(calls, "utf8").split("\n").filter(Boolean);
}

function fixtureRecordedCount(
  fixture: Fixture,
  line: FixtureVerb | "ended",
): number {
  return fixtureRecordedLines(fixture).filter((written) => written === line)
    .length;
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

/** Waits for something a fetch in flight brings about, failing where it never comes. */
async function fixtureUntil(
  awaited: string,
  came: () => boolean,
): Promise<void> {
  for (let waits = 0; waits < 400; waits += 1) {
    if (came()) return;
    await sleep(25);
  }
  assert.fail(`${awaited} never came`);
}

/**
 * Waits for the remote to have begun handing over as many packs as given, which
 * for a slowed fetch is its middle. The remote has taken how it serves that
 * pack by then, so a test may say how the next is served.
 */
function fixtureServing(fixture: Fixture, served: number): Promise<void> {
  return fixtureUntil("the fetch", () => fixtureServed(fixture) === served);
}

/** Whether a completed fetch has written the ref that says one tip's history is held. */
function fixtureHistoryHeld(fixture: Fixture, tip: GitObjectId): boolean {
  return fixtureAnswers(
    fixtureScratchRepository(fixture),
    "rev-parse",
    "--quiet",
    "--verify",
    `refs/chuggy/history/${tip}`,
  );
}

/** One more commit on the remote's branch, which is a further tip of the same repository. */
function fixtureNewer(fixture: Fixture, file = "newer"): GitObjectId {
  const newer = fixtureCommit(fixture.seed, file);
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "main:main");
  return newer;
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

/** A second remote holding the same history, which is a second repository to the adapter. */
function fixtureTwin(fixture: Fixture): string {
  const twin = join(fixture.directory, "twin.git");
  execFileSync("git", ["clone", "-q", "--bare", fixture.remote, twin]);
  return twin;
}

/** The reads an ask makes of a held tip, in the order it makes them: for a candidate in the tip's history, and for one the scratch does not hold. */
const fixtureAskReads: Readonly<
  Record<"candidate" | "stray", readonly FixtureVerb[]>
> = {
  candidate: ["rev-parse", "cat-file", "merge-base"],
  stray: ["rev-parse", "cat-file", "rev-list"],
};

/** Each read the adapter makes of a scratch, beside a candidate whose answer rests on that read and the answer. */
const fixtureReads: readonly (readonly [
  FixtureVerb,
  "candidate" | "stray",
  CommitAncestry,
])[] = [
  ["rev-parse", "candidate", "Ancestor"],
  ["cat-file", "candidate", "Ancestor"],
  ["merge-base", "candidate", "Ancestor"],
  ["rev-list", "stray", "NotAncestor"],
];

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

test("a commit-graph left over a pack that is gone does not answer for the commits in it", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const newer = await fixtureAged(fixture, port);
  const scratch = fixtureScratchRepository(fixture);
  fixtureGit(scratch, "commit-graph", "write", "--reachable");
  rmSync(join(scratch, "objects", "pack"), { recursive: true, force: true });

  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate, newer)),
    "Unknown",
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
  const port = fixturePort(fixture, {
    environment,
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

test("a fetch stopped part-way writes no ref for its tip, and the next ask answers from a whole one", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { remoteTimeoutSecsMax: 2 });
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

test("an asker is answered unknown at its own bound, and the fetch it began goes on to hold the tip", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { answerTimeoutSecsMax: 2 });
  fixtureServe(fixture, "Slowed", 3);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));

  await fixtureUntil("the tip's history", () =>
    fixtureHistoryHeld(fixture, fixture.tip),
  );
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Ancestor",
  );
  assert.equal(fixtureServed(fixture), 1);
});

for (const [verb, asked, answer] of fixtureReads) {
  test(`an asker is answered unknown at its own bound while its ${verb} is still running, and nothing more is read for it`, async (t) => {
    const fixture = fixtureOpen(t);
    const environment = fixtureRecorded(fixture);
    const patient = fixturePort(fixture, { environment });
    const port = fixturePort(fixture, { environment, answerTimeoutSecsMax: 1 });
    const question = fixtureQuestion(fixture, fixture[asked]);
    const reads = fixtureAskReads[asked];
    assert.equal(await patient.ancestry(question), answer);
    const before = fixtureRecordedLines(fixture).length;
    fixtureFaulted(fixture, verb, "Stalled");
    assert.equal(await port.ancestry(question), "Unknown");
    fixtureFaulted(fixture, verb, "Whole");
    await fixtureUntil(
      "the read's end",
      () => fixtureRecordedCount(fixture, "ended") === 1,
    );

    assert.equal(await patient.ancestry(question), answer);
    assert.deepEqual(fixtureRecordedLines(fixture).slice(before), [
      ...reads.slice(0, reads.indexOf(verb) + 1),
      "ended",
      ...reads,
    ]);
  });
}

test("askers whose bound has passed read nothing once the fetch they waited on lands", async (t) => {
  const fixture = fixtureOpen(t);
  const environment = fixtureRecorded(fixture);
  const port = fixturePort(fixture, { environment, answerTimeoutSecsMax: 1 });
  const question = fixtureQuestion(fixture, fixture.candidate);
  fixtureServe(fixture, "Slowed");
  assert.deepEqual(
    await Promise.all(Array.from({ length: 5 }, () => port.ancestry(question))),
    Array.from({ length: 5 }, () => "Unknown"),
  );
  await fixtureUntil("the tip's history", () =>
    fixtureHistoryHeld(fixture, fixture.tip),
  );

  assert.equal(
    await fixturePort(fixture, { environment }).ancestry(question),
    "Ancestor",
  );
  assert.equal(fixtureRecordedCount(fixture, "cat-file"), 1);
  assert.equal(fixtureRecordedCount(fixture, "merge-base"), 1);
});

test("a fetch takes as many waiters as may wait on one, and an asker past them is unknown at once", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { fetchWaitersMax: 2 });
  const question = fixtureQuestion(fixture, fixture.candidate);
  fixtureServe(fixture, "Slowed");
  const waiting = [port.ancestry(question), port.ancestry(question)];
  await fixtureServing(fixture, 1);

  assert.equal(await port.ancestry(question), "Unknown");
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));
  assert.deepEqual(await Promise.all(waiting), ["Ancestor", "Ancestor"]);
});

test("an asker whose bound has passed leaves its place among a fetch's waiters to another", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    answerTimeoutSecsMax: 4,
    fetchWaitersMax: 1,
  });
  const question = fixtureQuestion(fixture, fixture.candidate);
  fixtureServe(fixture, "Slowed", 5);
  assert.equal(await port.ancestry(question), "Unknown");

  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(fixtureServed(fixture), 1);
});

test("an ask that has been answered leaves no timer of its own running", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const question = fixtureQuestion(fixture, fixture.candidate);
  const timers = (): number =>
    process.getActiveResourcesInfo().filter((held) => held === "Timeout")
      .length;
  const before = timers();
  assert.equal(await port.ancestry(question), "Ancestor");
  assert.equal(await port.ancestry(question), "Ancestor");

  assert.equal(timers(), before);
});

test("an asker whose bound passed while another tip was being fetched begins no fetch of its own", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, { answerTimeoutSecsMax: 1 });
  const newer = fixtureNewer(fixture);
  fixtureServe(fixture, "Slowed");
  const first = port.ancestry(fixtureQuestion(fixture, fixture.candidate));
  await fixtureServing(fixture, 1);
  fixtureServe(fixture, "Whole");
  const second = port.ancestry(
    fixtureQuestion(fixture, fixture.candidate, newer),
  );
  assert.deepEqual(await Promise.all([first, second]), ["Unknown", "Unknown"]);

  await fixtureUntil("the tip's history", () =>
    fixtureHistoryHeld(fixture, fixture.tip),
  );
  await sleep(500);
  assert.equal(fixtureServed(fixture), 1);
});

test("a credential source that never answers gives its repository's turn back once the remote bound has passed", async (t) => {
  const fixture = fixtureOpen(t);
  const twin = fixtureTwin(fixture);
  const port = fixturePort(fixture, {
    remoteTimeoutSecsMax: 1,
    answerTimeoutSecsMax: 3,
    fetchesInFlightMax: 1,
    credentials: {
      credential: (binding) =>
        binding.repository === fixture.remote
          ? new Promise<never>(() => undefined)
          : Promise.resolve({ resolved: "Denied" }),
    },
  });
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );

  assert.equal(
    await port.ancestry(
      fixtureQuestion(fixture, fixture.candidate, fixture.tip, twin),
    ),
    "Ancestor",
  );
});

test("the wait for a credential comes out of the time the transfer is given", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture, {
    remoteTimeoutSecsMax: 4,
    credentials: {
      credential: async () => {
        await sleep(2000);
        return { resolved: "Denied" };
      },
    },
  });
  fixtureServe(fixture, "Slowed", 3);
  assert.equal(
    await port.ancestry(fixtureQuestion(fixture, fixture.candidate)),
    "Unknown",
  );
  assert.equal(fixtureServed(fixture), 1);
  assert.ok(!fixtureHistoryHeld(fixture, fixture.tip));
});

test("a repository that could not be reached is asked again once it can be", async (t) => {
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

test("a bound of the adapter's own that is no positive integer is refused", (t) => {
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
  }
});
