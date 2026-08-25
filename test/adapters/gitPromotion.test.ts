/**
 * The git adapter against real bare repositories: the target read from the
 * remote, the candidate built out of artifact bytes with nothing checked out,
 * the integration that merges and the one that conflicts, the conditional ref
 * update and what the ref proves afterwards.
 *
 * A FILESYSTEM PATH IS A REMOTE GIT ACCEPTS, so every case here runs against a
 * bare repository on disk and the suite needs no network and no server. What is
 * asserted is git's own behaviour rather than a description of it: the symref
 * read, the overlay tree, the conflict exit, the refused non-fast-forward and
 * the ancestor check.
 *
 * THE NEGATIVE SPACE IS HALF THE POINT. A stale candidate must not clobber a
 * moved branch, a repeated integration must not write a second identity for one
 * piece of work, a path carrying an index separator must not become two
 * entries, a path the index format would unquote must not land under another
 * name, a read of one ref must not answer with another ref's commit, and a push
 * that stopped without saying anything must not read as a refusal.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  gitPromotion,
  gitPromotionDefaults,
} from "../../src/adapters/git/gitPromotion.ts";
import {
  gitCredentialArguments,
  gitRun,
  gitRunEnvironment,
  gitRunSetup,
  gitVersionAdmits,
} from "../../src/adapters/git/gitRun.ts";
import {
  scratchDigestOf,
  scratchRemoteArguments,
} from "../../src/adapters/git/gitScratch.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asCommitPermitId,
  asGitObjectId,
  asGitRefName,
  asInputBundleId,
  asRepositoryCredential,
  asRepositoryId,
  type CandidateFile,
  type CredentialResolved,
  type GitObjectId,
  type GitPromotionPort,
  type ObservedTarget,
  type RepositoryBinding,
  type RepositoryCredentialPort,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

/** The secret the fixture's credential port hands out, which must never reach an argument. */
const fixtureSecret = "fixture-secret-a1b2c3";

/** One fixture: a bare origin, the clone this suite commits through, and the scratch the adapter opens. */
interface Fixture {
  readonly directory: string;
  readonly remote: string;
  readonly seed: string;
}

function fixtureGit(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

/** Commits one file in the seed and pushes the branch, which is how this suite moves the remote. */
function fixtureCommit(
  fixture: Fixture,
  path: string,
  content: string,
  message: string,
): string {
  writeFileSync(join(fixture.seed, path), content);
  fixtureGit(fixture.seed, "add", "-A");
  fixtureGit(
    fixture.seed,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    message,
  );
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, "main:main");
  return fixtureGit(fixture.seed, "rev-parse", "HEAD");
}

function fixtureOpen(t: TestContext): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "chuggy-git-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const remote = join(directory, "origin.git");
  const seed = join(directory, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  fixtureGit(seed, "config", "user.name", "fixture");
  fixtureGit(seed, "config", "user.email", "fixture@example.test");
  const fixture = { directory, remote, seed };
  fixtureCommit(fixture, "base.txt", "base\n", "base");
  fixtureCommit(fixture, "keep.txt", "keep\n", "keep");
  return fixture;
}

/** The credential port the adapter is composed with, answering one resolution for every repository. */
function fixtureCredentials(
  resolved: CredentialResolved,
): RepositoryCredentialPort {
  return { credential: () => Promise.resolve(resolved) };
}

const fixtureCredential = asRepositoryCredential(fixtureSecret);

const fixtureGranted: CredentialResolved = {
  resolved: "Credential",
  credential: fixtureCredential,
};

function fixturePort(
  fixture: Fixture,
  resolved: CredentialResolved = fixtureGranted,
): GitPromotionPort {
  return gitPromotion({
    scratchDirectory: join(fixture.directory, "scratch"),
    identity: { name: "chug", email: "chug@example.test" },
    environment: process.env,
    credentials: fixtureCredentials(resolved),
  });
}

/** Where the adapter's own bare repository for one remote is, so a suite can read what it wrote. */
function fixtureScratch(fixture: Fixture): string {
  return join(fixture.directory, "scratch", scratchDigestOf(fixture.remote));
}

function fixtureBinding(remote: string): RepositoryBinding {
  return {
    partition: {
      tenant: asTenantId("tenant"),
      project: asProjectId("project"),
    },
    repository: asRepositoryId(remote),
    recoveryEpoch: asRecoveryEpoch("epoch-1"),
  };
}

function fixtureFiles(
  entries: readonly (readonly [string, string])[],
): readonly CandidateFile[] {
  return entries.map(([path, content]) => ({
    path,
    content: Buffer.from(content, "utf8"),
  }));
}

async function fixtureTarget(
  port: GitPromotionPort,
  binding: RepositoryBinding,
): Promise<ObservedTarget> {
  const observed = await port.observeTarget(binding);
  if (observed.observed !== "Target") {
    assert.fail(`the remote named no target: ${observed.evidence}`);
  }
  return observed.target;
}

async function fixturePrepare(
  port: GitPromotionPort,
  binding: RepositoryBinding,
  target: ObservedTarget,
  entries: readonly (readonly [string, string])[],
): Promise<GitObjectId> {
  const prepared = await port.prepareCandidate({
    repository: binding,
    ticket: asTicketId(1),
    bundle: asInputBundleId("bundle-1"),
    target,
    files: fixtureFiles(entries),
  });
  if (prepared.prepared !== "Candidate") {
    assert.fail(`the candidate was not built: ${prepared.evidence}`);
  }
  return prepared.candidate;
}

test("the remote's own default branch and tip are what a target is", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const target = await fixtureTarget(fixturePort(fixture), binding);
  assert.equal(target.ref, "refs/heads/main");
  assert.equal(target.commit, fixtureGit(fixture.seed, "rev-parse", "HEAD"));
});

test("a configured target ref is observed instead of the remote default", async (t) => {
  const fixture = fixtureOpen(t);
  fixtureGit(
    fixture.seed,
    "push",
    "-q",
    fixture.remote,
    "HEAD:refs/heads/release-candidate",
  );
  const binding = {
    ...fixtureBinding(fixture.remote),
    targetRef: asGitRefName("refs/heads/release-candidate"),
  };
  const target = await fixtureTarget(fixturePort(fixture), binding);
  assert.equal(target.ref, binding.targetRef);
  assert.equal(target.commit, fixtureGit(fixture.seed, "rev-parse", "HEAD"));
});

test("a remote nobody can reach is unreadable, and one naming no branch is too", async (t) => {
  const fixture = fixtureOpen(t);
  const port = fixturePort(fixture);
  const absent = await port.observeTarget(
    fixtureBinding(join(fixture.directory, "missing.git")),
  );
  assert.deepEqual(absent, {
    observed: "Unreadable",
    evidence: "RemoteUnreachable",
  });
  const empty = join(fixture.directory, "empty.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", empty]);
  assert.deepEqual(await port.observeTarget(fixtureBinding(empty)), {
    observed: "Unreadable",
    evidence: "RefUnreadable",
  });
});

test("a denial and an outage stay apart all the way into the evidence", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const denied = await fixturePort(fixture, {
    resolved: "Denied",
  }).observeTarget(binding);
  assert.deepEqual(denied, {
    observed: "Unreadable",
    evidence: "RemoteDenied",
  });
  const unavailable = await fixturePort(fixture, {
    resolved: "Unavailable",
  }).observeTarget(binding);
  assert.deepEqual(unavailable, {
    observed: "Unreadable",
    evidence: "RemoteUnreachable",
  });
});

test("a candidate is the observed target with the artifacts standing in it", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["base.txt", "changed\n"],
    ["lib/new.txt", "new\n"],
  ]);
  const scratch = fixtureScratch(fixture);
  assert.deepEqual(
    fixtureGit(scratch, "ls-tree", "-r", "--name-only", candidate).split("\n"),
    ["base.txt", "keep.txt", "lib/new.txt"],
  );
  assert.equal(
    fixtureGit(scratch, "cat-file", "blob", `${candidate}:base.txt`),
    "changed",
  );
  assert.equal(
    fixtureGit(scratch, "rev-parse", `${candidate}^`),
    target.commit,
  );
});

test("the same artifacts over the same target write the same tree", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const entries = [
    ["a/one.txt", "one\n"],
    ["b/two.txt", "two\n"],
  ] as const;
  const first = await fixturePrepare(port, binding, target, entries);
  const second = await fixturePrepare(
    port,
    binding,
    target,
    [...entries].reverse(),
  );
  const scratch = fixtureScratch(fixture);
  assert.equal(
    fixtureGit(scratch, "rev-parse", `${first}^{tree}`),
    fixtureGit(scratch, "rev-parse", `${second}^{tree}`),
  );
});

test("a path no tree entry takes is refused before any object is written", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const refused = [
    [["one.txt\n100644 x\tinjected.txt", "injected\n"]],
    [["one\ttwo.txt", "tabbed\n"]],
    [["../escape.txt", "escaped\n"]],
    [["/absolute.txt", "absolute\n"]],
    [[".git/config", "hijacked\n"]],
    [["sub/.git/config", "hijacked\n"]],
    [["sub/.GIT/config", "hijacked\n"]],
    [["", "empty\n"]],
    [
      ["same.txt", "one\n"],
      ["same.txt", "two\n"],
    ],
    [
      ["Same.txt", "one\n"],
      ["same.txt", "two\n"],
    ],
  ] as const;
  for (const entries of refused) {
    await assert.rejects(
      () => fixturePrepare(port, binding, target, entries),
      RangeError,
      `${entries[0][0]} was not refused`,
    );
  }
});

test("a path that spells another one in the index format's quoting stands at its own name", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const quoted = '"\\056github\\057ci.yml"';
  const candidate = await fixturePrepare(port, binding, target, [
    [quoted, "quoted\n"],
  ]);
  const names = fixtureGit(
    fixtureScratch(fixture),
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    candidate,
  ).split("\0");
  assert.equal(names.includes(quoted), true);
  assert.equal(names.includes(".github/ci.yml"), false);
});

test("a path git will not take is a failed preparation and never a candidate missing it", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const prepared = await port.prepareCandidate({
    repository: binding,
    ticket: asTicketId(1),
    bundle: asInputBundleId("bundle-1"),
    target,
    files: fixtureFiles([
      ["handed.txt", "handed\n"],
      [".git.", "hijacked\n"],
    ]),
  });
  assert.deepEqual(prepared, {
    prepared: "Failed",
    evidence: "IntegrationFailed",
  });
});

test("an observed commit the remote no longer holds cannot be built on", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  fixtureGit(fixture.seed, "checkout", "-q", "--orphan", "fresh");
  writeFileSync(join(fixture.seed, "only.txt"), "only\n");
  fixtureGit(fixture.seed, "add", "-A");
  fixtureGit(
    fixture.seed,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fresh",
  );
  fixtureGit(
    fixture.seed,
    "push",
    "-q",
    "--force",
    fixture.remote,
    "fresh:main",
  );
  const prepared = await port.prepareCandidate({
    repository: binding,
    ticket: asTicketId(1),
    bundle: asInputBundleId("bundle-1"),
    target,
    files: fixtureFiles([["new.txt", "new\n"]]),
  });
  assert.deepEqual(prepared, { prepared: "Failed", evidence: "ObjectMissing" });
});

test("a worker source is accepted only at the commit its remote ref names", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const base = fixtureGit(fixture.seed, "rev-parse", "HEAD");
  writeFileSync(join(fixture.seed, "worker.txt"), "worker\n");
  fixtureGit(fixture.seed, "add", "worker.txt");
  fixtureGit(
    fixture.seed,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "worker",
  );
  const commit = fixtureGit(fixture.seed, "rev-parse", "HEAD");
  const ref = "refs/heads/chuggy/tickets/1/attempts/" + "a".repeat(64);
  fixtureGit(fixture.seed, "push", "-q", fixture.remote, `HEAD:${ref}`);
  const port = fixturePort(fixture);

  assert.deepEqual(
    await port.prepareSource({
      repository: binding,
      ref: asGitRefName(ref),
      commit: asGitObjectId(commit),
      base: asGitObjectId(base),
    }),
    { prepared: "Candidate", candidate: commit },
  );
  assert.deepEqual(
    await port.prepareSource({
      repository: binding,
      ref: asGitRefName(ref),
      commit: asGitObjectId(base),
      base: asGitObjectId(base),
    }),
    { prepared: "Failed", evidence: "ObjectMissing" },
  );
});

test("a target the candidate already contains integrates to the candidate itself", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  const integrated = await port.integrateCandidate({
    repository: binding,
    target,
    candidate,
    strategy: "Merge",
  });
  assert.deepEqual(integrated, { integrated: "Candidate", candidate });
});

test("a target that moved without conflicting is merged into the candidate", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  fixtureCommit(fixture, "other.txt", "other\n", "other");
  const moved = await fixtureTarget(port, binding);
  const integrated = await port.integrateCandidate({
    repository: binding,
    target: moved,
    candidate,
    strategy: "Merge",
  });
  if (integrated.integrated !== "Candidate") {
    assert.fail(`the merge did not integrate: ${JSON.stringify(integrated)}`);
  }
  const scratch = fixtureScratch(fixture);
  assert.deepEqual(
    fixtureGit(
      scratch,
      "ls-tree",
      "-r",
      "--name-only",
      integrated.candidate,
    ).split("\n"),
    ["base.txt", "keep.txt", "new.txt", "other.txt"],
  );
  assert.deepEqual(
    fixtureGit(
      scratch,
      "rev-list",
      "--parents",
      "-n",
      "1",
      integrated.candidate,
    )
      .split(" ")
      .slice(1),
    [moved.commit, candidate],
  );
});

test("a genuine conflict is the conflicting paths, the merge base, and no commit at all", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["base.txt", "candidate\n"],
    ["keep.txt", "candidate\n"],
  ]);
  fixtureCommit(fixture, "base.txt", "moved\n", "moved");
  const moved = await fixtureTarget(port, binding);
  const integrated = await port.integrateCandidate({
    repository: binding,
    target: moved,
    candidate,
    strategy: "Merge",
  });
  assert.deepEqual(integrated, {
    integrated: "Conflicted",
    conflict: { paths: ["base.txt"], truncated: false },
    base: target.commit,
  });
});

test("a clean promotion advances the ref, and repeating it moves nothing", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  const promotion = {
    repository: binding,
    permit: asCommitPermitId("permit-1"),
    target,
    candidate,
  };
  assert.deepEqual(await port.promoteCandidate({ ...promotion }), {
    promoted: "Advanced",
  });
  assert.equal(
    fixtureGit(fixture.remote, "rev-parse", "refs/heads/main"),
    candidate,
  );
  assert.deepEqual(await port.promoteCandidate({ ...promotion }), {
    promoted: "Advanced",
  });
  assert.equal(
    fixtureGit(fixture.remote, "rev-parse", "refs/heads/main"),
    candidate,
  );
});

test("a candidate built over a target that has moved is refused, and the ref does not move", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  const moved = fixtureCommit(fixture, "other.txt", "other\n", "other");
  const promoted = await port.promoteCandidate({
    repository: binding,
    permit: asCommitPermitId("permit-1"),
    target,
    candidate,
  });
  assert.deepEqual(promoted, { promoted: "Rejected", observed: moved });
  assert.equal(
    fixtureGit(fixture.remote, "rev-parse", "refs/heads/main"),
    moved,
  );
});

test("a promotion that stopped without saying anything is ambiguous and never a refusal", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  const permit = asCommitPermitId("permit-1");
  const denied = await fixturePort(fixture, {
    resolved: "Denied",
  }).promoteCandidate({ repository: binding, permit, target, candidate });
  assert.deepEqual(denied, { promoted: "Ambiguous", evidence: "RemoteDenied" });
  rmSync(fixture.remote, { recursive: true, force: true });
  assert.deepEqual(
    await port.promoteCandidate({
      repository: binding,
      permit,
      target,
      candidate,
    }),
    { promoted: "Ambiguous", evidence: "RemoteUnreachable" },
  );
});

test("what the ref proves about a candidate is read back from the remote", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  const proof = { repository: binding, ref: target.ref, candidate };
  assert.deepEqual(await port.proveCandidateAncestry(proof), {
    proved: "NotAncestor",
    observed: target.commit,
  });
  await port.promoteCandidate({
    repository: binding,
    permit: asCommitPermitId("permit-1"),
    target,
    candidate,
  });
  assert.deepEqual(await port.proveCandidateAncestry(proof), {
    proved: "Ancestor",
    observed: candidate,
  });
});

test("a ref another ref's tail repeats is read as itself and never as the shadow", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  fixtureGit(
    fixtureScratch(fixture),
    "push",
    "-q",
    fixture.remote,
    `${candidate}:refs/heads/decoy/refs/heads/main`,
  );
  assert.deepEqual(
    await port.proveCandidateAncestry({
      repository: binding,
      ref: target.ref,
      candidate,
    }),
    { proved: "NotAncestor", observed: target.commit },
  );
  assert.equal(
    fixtureGit(fixture.remote, "rev-parse", "refs/heads/main"),
    target.commit,
  );
});

test("a push the receiving repository declined is ambiguous and never a refusal", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  const hook = join(fixture.remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o700);
  const promoted = await port.promoteCandidate({
    repository: binding,
    permit: asCommitPermitId("permit-1"),
    target,
    candidate,
  });
  assert.deepEqual(promoted, {
    promoted: "Ambiguous",
    evidence: "RemoteUnreachable",
  });
  assert.equal(
    fixtureGit(fixture.remote, "rev-parse", "refs/heads/main"),
    target.commit,
  );
});

test("a remote reaches git as a path and never as an option", () => {
  assert.deepEqual(
    scratchRemoteArguments(asRepositoryId("-dash.git"), "HEAD"),
    ["--", "-dash.git", "HEAD"],
  );
});

test("an unreadable ref and an unreachable remote are each their own answer", async (t) => {
  const fixture = fixtureOpen(t);
  const binding = fixtureBinding(fixture.remote);
  const port = fixturePort(fixture);
  const target = await fixtureTarget(port, binding);
  const candidate = await fixturePrepare(port, binding, target, [
    ["new.txt", "new\n"],
  ]);
  assert.deepEqual(
    await port.proveCandidateAncestry({
      repository: binding,
      ref: asGitRefName("refs/heads/absent"),
      candidate,
    }),
    { proved: "Unreadable", evidence: "RefUnreadable" },
  );
  rmSync(fixture.remote, { recursive: true, force: true });
  assert.deepEqual(
    await port.proveCandidateAncestry({
      repository: binding,
      ref: target.ref,
      candidate,
    }),
    { proved: "Unreadable", evidence: "RemoteUnreachable" },
  );
});

test("the credential reaches git through the environment and never an argument", async (t) => {
  const fixture = fixtureOpen(t);
  fixturePort(fixture);
  const helper = join(fixture.directory, "scratch", "credential-helper");
  const argv = [...gitCredentialArguments(helper), "credential", "fill"];
  const ran = await gitRun({
    directory: fixture.seed,
    argv,
    timeoutSecsMax: gitPromotionDefaults.localTimeoutSecsMax,
    environment: gitRunEnvironment(
      process.env,
      gitPromotionDefaults.credentialUsername,
      fixtureCredential,
    ),
    input: "protocol=https\nhost=example.test\n\n",
  });
  if (ran.ran !== "Exited")
    assert.fail("git could not be asked for a credential");
  assert.equal(ran.code, 0);
  assert.match(ran.stdout, /^username=chuggy$/mu);
  assert.match(ran.stdout, new RegExp(`^password=${fixtureSecret}$`, "mu"));
  assert.ok(argv.every((argument) => !argument.includes(fixtureSecret)));
});

test("a call outruns neither its timeout nor its output ceiling", async (t) => {
  const fixture = fixtureOpen(t);
  const slow = join(fixture.directory, "slow-helper");
  writeFileSync(slow, "#!/bin/sh\nsleep 30\n");
  chmodSync(slow, 0o700);
  const stopped = await gitRun({
    directory: fixture.seed,
    argv: [...gitCredentialArguments(slow), "credential", "fill"],
    timeoutSecsMax: 1,
    environment: gitRunEnvironment(process.env, "chuggy"),
    input: "protocol=https\nhost=example.test\n\n",
  });
  assert.deepEqual(stopped, { ran: "Stopped", stopped: "Timeout" });
  const flooded = await gitRun({
    directory: fixture.seed,
    argv: ["cat-file", "--batch-all-objects", "--batch-check"],
    timeoutSecsMax: gitPromotionDefaults.localTimeoutSecsMax,
    environment: gitRunEnvironment(process.env, "chuggy"),
    outputBytesMax: 1,
  });
  assert.deepEqual(flooded, { ran: "Stopped", stopped: "OutputCeiling" });
});

test("a call is answered on git's own exit and never on what outlived it", async (t) => {
  const fixture = fixtureOpen(t);
  const started = Date.now();
  const ran = await gitRun({
    directory: fixture.seed,
    argv: ["-c", "alias.linger=!sh -c 'sleep 5 &'", "linger"],
    timeoutSecsMax: gitPromotionDefaults.localTimeoutSecsMax,
    environment: gitRunEnvironment(process.env, "chuggy"),
  });
  assert.deepEqual(ran, { ran: "Exited", code: 0, stdout: "", stderr: "" });
  assert.ok(
    Date.now() - started < 4_000,
    "the answer waited on a grandchild holding the pipes",
  );
});

test("a git something else killed is stopped, and is not the deadline", async (t) => {
  const fixture = fixtureOpen(t);
  const ran = await gitRun({
    directory: fixture.seed,
    argv: ["-c", "alias.doom=!kill -KILL $PPID", "doom"],
    timeoutSecsMax: gitPromotionDefaults.localTimeoutSecsMax,
    environment: gitRunEnvironment(process.env, "chuggy"),
  });
  assert.deepEqual(ran, { ran: "Stopped", stopped: "Killed" });
});

test("a synchronous call is killed at its bound rather than left to hang", () => {
  assert.throws(
    () =>
      gitRunSetup(
        ["-c", "alias.linger=!sleep 5", "linger"],
        gitRunEnvironment(process.env, "chuggy"),
        1,
      ),
    (failure: unknown) => (failure as { signal?: string }).signal === "SIGKILL",
  );
});

test("an ambient variable neither points a call elsewhere nor configures it", async (t) => {
  const fixture = fixtureOpen(t);
  const environment = gitRunEnvironment(
    { ...process.env, GIT_DIR: join(fixture.directory, "origin.git") },
    gitPromotionDefaults.credentialUsername,
  );
  assert.equal(environment["GIT_DIR"], undefined);
  assert.equal(environment["GIT_CONFIG_NOSYSTEM"], "1");
  const ran = await gitRun({
    directory: fixture.seed,
    argv: ["rev-parse", "--absolute-git-dir"],
    timeoutSecsMax: gitPromotionDefaults.localTimeoutSecsMax,
    environment,
  });
  if (ran.ran !== "Exited") {
    assert.fail("git could not say which repository it read");
  }
  assert.equal(
    ran.stdout.trim(),
    fixtureGit(fixture.seed, "rev-parse", "--absolute-git-dir"),
  );
});

test("a git too old to write merge trees is refused by the floor", () => {
  assert.equal(gitVersionAdmits("git version 2.37.9"), false);
  assert.equal(gitVersionAdmits("git version 2.38.0"), true);
  assert.equal(gitVersionAdmits("git version 3.0.1"), true);
  assert.equal(gitVersionAdmits("no version at all"), false);
});
