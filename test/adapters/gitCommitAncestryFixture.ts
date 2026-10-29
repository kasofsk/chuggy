/**
 * The real repositories the commit ancestry suites ask about, the remote that
 * serves them and the git the adapter asks them through.
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
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
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

import {
  gitStandInFaulted,
  gitStandInLines,
  gitStandInOpen,
  type GitStandInFault,
} from "./gitStandIn.ts";

/** The secret the fixture's credential source hands out. */
export const fixtureSecret = "fixture-secret-a1b2c3";

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
const fixtureVerbs = [
  "fetch",
  "rev-parse",
  "cat-file",
  "merge-base",
  "rev-list",
] as const;
export type FixtureVerb = (typeof fixtureVerbs)[number];

/** One fixture: a bare origin holding a merge of one branch, a commit it never received, and the scratch the adapter opens. */
export interface Fixture {
  readonly directory: string;
  readonly remote: string;
  readonly seed: string;
  readonly scratch: string;
  readonly base: GitObjectId;
  readonly candidate: GitObjectId;
  readonly stray: GitObjectId;
  readonly tip: GitObjectId;
}

export function fixtureGit(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", directory, "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  ).trim();
}

/** Whether git answers one question about a repository with success, asked directly so a test sees what was left there. */
export function fixtureAnswers(directory: string, ...args: string[]): boolean {
  try {
    execFileSync("git", ["-C", directory, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** One commit over whatever is checked out, its message too long and too random to fit in a pack's opening beside the tip. */
export function fixtureCommit(seed: string, file: string): GitObjectId {
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

export function fixtureOpen(t: TestContext): Fixture {
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
export function fixtureServe(
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
export function fixtureFaulted(
  fixture: Fixture,
  verb: FixtureVerb,
  fault: GitStandInFault,
): void {
  gitStandInFaulted(join(fixture.directory, "recording"), verb, fault);
}

/** The environment of a port whose every git call goes through a recording git, which nothing is faulted at until a test says so. */
export function fixtureRecorded(fixture: Fixture): GitEnvironment {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(fixture.directory, "gitconfig"),
    PATH: gitStandInOpen(join(fixture.directory, "recording"), fixtureVerbs),
  };
}

/** What the recording git has written, in order: the verb of each call, and `ended` for each late call that has ended. */
export function fixtureRecordedLines(fixture: Fixture): readonly string[] {
  return gitStandInLines(join(fixture.directory, "recording"));
}

export function fixtureRecordedCount(
  fixture: Fixture,
  line: FixtureVerb | "ended",
): number {
  return fixtureRecordedLines(fixture).filter((written) => written === line)
    .length;
}

/** How many packs the remote has built, which is how many fetches actually transferred anything. */
export function fixtureServed(fixture: Fixture): number {
  const served = join(fixture.directory, "served");
  if (!existsSync(served)) return 0;
  return readFileSync(served, "utf8").split("\n").filter(Boolean).length;
}

/** The scratch's own repository for one remote, where a test reads what a fetch left. */
export function fixtureScratchRepository(
  fixture: Fixture,
  repository: string = fixture.remote,
): string {
  return join(fixture.scratch, scratchDigestOf(repository));
}

/** Waits for something a fetch in flight brings about, failing where it never comes. */
export async function fixtureUntil(
  awaited: string,
  came: () => boolean | Promise<boolean>,
): Promise<void> {
  for (let waits = 0; waits < 400; waits += 1) {
    if (await came()) return;
    await sleep(25);
  }
  assert.fail(`${awaited} never came`);
}

/**
 * Waits for the remote to have begun handing over as many packs as given, which
 * for a slowed fetch is its middle. The remote has taken how it serves that
 * pack by then, so a test may say how the next is served.
 */
export function fixtureServing(
  fixture: Fixture,
  served: number,
): Promise<void> {
  return fixtureUntil("the fetch", () => fixtureServed(fixture) === served);
}

/** Whether a completed fetch has written the ref that says one tip's history is held. */
export function fixtureHistoryHeld(
  fixture: Fixture,
  tip: GitObjectId,
): boolean {
  return fixtureAnswers(
    fixtureScratchRepository(fixture),
    "rev-parse",
    "--quiet",
    "--verify",
    `refs/chuggy/history/${tip}`,
  );
}

/** One more commit on the remote's branch, which is a further tip of the same repository. */
export function fixtureNewer(fixture: Fixture, file = "newer"): GitObjectId {
  const newer = fixtureCommit(fixture.seed, file);
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "main:main");
  return newer;
}

/** A second remote holding the same history, which is a second repository to the adapter. */
export function fixtureTwin(fixture: Fixture): string {
  const twin = join(fixture.directory, "twin.git");
  execFileSync("git", ["clone", "-q", "--bare", fixture.remote, twin]);
  return twin;
}

/** Each read the adapter makes of a scratch, beside a candidate whose answer rests on that read and the answer. */
export const fixtureReads: readonly (readonly [
  FixtureVerb,
  "candidate" | "stray",
  CommitAncestry,
])[] = [
  ["rev-parse", "candidate", "Ancestor"],
  ["cat-file", "candidate", "Ancestor"],
  ["merge-base", "candidate", "Ancestor"],
  ["rev-list", "stray", "NotAncestor"],
];

export function fixtureCredentials(
  resolved: CredentialResolved,
): RepositoryCredentialPort {
  return { credential: () => Promise.resolve(resolved) };
}

export function fixturePort(
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

export function fixtureQuestion(
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
