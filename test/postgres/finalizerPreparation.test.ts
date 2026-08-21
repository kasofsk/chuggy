/**
 * Preparation end to end: the real durable authority against a real PostgreSQL,
 * the real git adapter against a real bare repository, and the real project-owned
 * artifact store on a real filesystem.
 *
 * NOTHING IS SUBSTITUTED HERE AT ALL. Every other finalizer suite fakes the
 * remote, because a refused update and an ambiguous one are answers a real
 * remote will not produce on demand — but a clean automatic merge, a genuine
 * conflict and a target that moved are exactly what a real repository does
 * produce, and a fake asserting them would be asserting itself.
 *
 * THE RACE IS STAGED AND NOT HOPED FOR. A preparation observes the target,
 * builds over it and re-reads before integrating, so a case that wants the
 * conflict pushes to the remote in the window between those two reads rather
 * than trusting timing to find it.
 *
 * EVERY CASE QUIESCES THE DATABASE IT SHARES. The suites in this directory run
 * against one database and a pass draws work installation-wide, so a case that
 * left a live request would be advanced by the next case's pass.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  artifactOwnedFile,
  artifactProjectDirectory,
} from "../../src/adapters/artifacts/artifactKey.ts";
import { gitPromotion } from "../../src/adapters/git/gitPromotion.ts";
import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import {
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  asInputBundleId,
  asRepositoryCredential,
  asRepositoryId,
  type FinalizationClaim,
  type GitPromotionPort,
} from "../../src/interpreter/finalizer.ts";
import type { AttemptRecord } from "../../src/interpreter/finalizerPreparation.ts";
import {
  finalizerPass,
  type FinalizerPassReport,
} from "../../src/interpreter/finalizerRun.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  finalizerClaim,
  finalizerCommit,
  finalizerDigest,
  finalizerExpireClaim,
  finalizerIdentity,
  finalizerPassedWork,
  finalizerProject,
  finalizerRigOpen,
  finalizerService,
  finalizerStoreArtifact,
  type FinalizerHandoff,
  type FinalizerProject,
  type FinalizerRig,
  type FinalizerWork,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
let scratch: string;
before(async () => {
  rig = await finalizerRigOpen();
  scratch = mkdtempSync(join(tmpdir(), "chuggy-prepare-"));
});
after(async () => {
  await rig.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** One attempt row as a case reads it back. */
interface AttemptState {
  readonly attempt: string;
  readonly target_commit: string;
  readonly candidate_commit: string | null;
  readonly outcome: string;
  readonly failure_kind: string | null;
  readonly conflict_manifest: string | null;
  readonly conflict_manifest_digest: string | null;
  readonly approval_required: boolean;
  readonly attempt_digest: string;
}

/** Invalidates every live request but this project's, so a pass draws one claim. */
async function quiesce(project: FinalizerProject): Promise<void> {
  await rig.as(
    `UPDATE finalization_request SET state='Invalidated'
      WHERE state IN ('Open','Registered')
        AND NOT (tenant=$1 AND project=$2 AND request=$3)`,
    [project.partition.tenant, project.partition.project, project.request],
  );
}

/** Runs one git verb in a fixture repository, which is how a case moves the remote. */
function fixtureGit(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

/** One bare origin and the clone this suite commits through. */
interface Remote {
  readonly origin: string;
  readonly seed: string;
}

/** Commits one file in the seed and pushes it, which is what moves the target. */
function remoteCommit(
  remote: Remote,
  path: string,
  content: string,
  message: string,
): string {
  writeFileSync(join(remote.seed, path), content);
  fixtureGit(remote.seed, "add", "-A");
  fixtureGit(
    remote.seed,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    message,
  );
  fixtureGit(remote.seed, "push", "-q", remote.origin, "main:main");
  return fixtureGit(remote.seed, "rev-parse", "HEAD");
}

/** A bare origin with one commit on `main`, and the clone a case pushes through. */
function remoteOpen(label: string): Remote {
  const directory = mkdtempSync(join(scratch, `${label}-`));
  const remote = {
    origin: join(directory, "origin.git"),
    seed: join(directory, "seed"),
  };
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote.origin]);
  execFileSync("git", ["init", "-q", "-b", "main", remote.seed]);
  fixtureGit(remote.seed, "config", "user.name", "fixture");
  fixtureGit(remote.seed, "config", "user.email", "fixture@example.test");
  remoteCommit(remote, "base.txt", "base\n", "base");
  return remote;
}

/** The real git adapter over one remote, with a credential no filesystem remote asks for. */
function remotePort(): GitPromotionPort {
  return gitPromotion({
    scratchDirectory: join(scratch, "adapter"),
    identity: { name: "chug", email: "chug@example.test" },
    environment: process.env,
    credentials: {
      credential: () =>
        Promise.resolve({
          resolved: "Credential",
          credential: asRepositoryCredential("unused"),
        }),
    },
  });
}

/**
 * A port that lets one case act in the window between the observation a candidate
 * is built over and the re-reading the integration is answered against.
 */
function movingPort(
  port: GitPromotionPort,
  move: () => void,
): GitPromotionPort {
  return {
    ...port,
    prepareCandidate: async (preparation) => {
      const prepared = await port.prepareCandidate(preparation);
      move();
      return prepared;
    },
  };
}

/** A finalizing project bound to one real bare repository, with everything else quiesced. */
async function subject(
  label: string,
  handoffs: readonly FinalizerHandoff[],
): Promise<{
  project: FinalizerProject;
  remote: Remote;
  work: FinalizerWork;
}> {
  const remote = remoteOpen(label);
  const project = await finalizerProject(rig, label, remote.origin);
  await quiesce(project);
  const work = await finalizerPassedWork(rig, project, label, handoffs);
  return { project, remote, work };
}

/** One pass, under an owner no other case is using. */
function passOnce(
  project: FinalizerProject,
  git: GitPromotionPort,
  label: string,
): Promise<FinalizerPassReport> {
  return finalizerPass(
    finalizerService(rig, git),
    asFinalizerOwnerId(`owner-${label}`),
    asRecoveryEpoch(project.epoch),
  );
}

/** Every attempt this project's request has, oldest first. */
async function attemptsOf(
  project: FinalizerProject,
): Promise<readonly AttemptState[]> {
  return (await rig.as(
    `SELECT attempt, target_commit, candidate_commit, outcome, failure_kind,
            conflict_manifest, conflict_manifest_digest, approval_required,
            attempt_digest
       FROM finalization_attempt WHERE tenant=$1 AND project=$2
      ORDER BY prepared_at, attempt`,
    [project.partition.tenant, project.partition.project],
  )) as readonly unknown[] as readonly AttemptState[];
}

/** One attempt offered straight to the durable authority, under a claim a case holds. */
function attemptRecordOf(
  claim: FinalizationClaim,
  project: FinalizerProject,
  label: string,
): AttemptRecord {
  const bundle = asInputBundleId(finalizerIdentity(`bundle-${label}`));
  return {
    claim,
    repository: asRepositoryId(project.repository),
    attempt: asFinalizationAttemptId(finalizerIdentity(`attempt-${label}`)),
    bundle: {
      bundle,
      digest: finalizerDigest(),
      references: [{ kind: "Repository", reference: project.repository }],
    },
    target: {
      ref: asGitRefName("refs/heads/main"),
      commit: asGitObjectId(finalizerCommit()),
    },
    strategy: "Merge",
    configuration: {
      revision: project.configurationRevision,
      digest: project.configurationDigest,
    },
    approvalRequired: false,
    outcome: "Prepared",
    candidate: asGitObjectId(finalizerCommit()),
    attemptDigest: finalizerDigest(),
  };
}

/** The references the bundle one attempt pinned carries, in the order it named them. */
async function bundleOf(
  project: FinalizerProject,
): Promise<readonly { reference_kind: string; reference_id: string }[]> {
  return (await rig.as(
    `SELECT r.reference_kind, r.reference_id
       FROM input_bundle_reference r
      WHERE r.tenant=$1 AND r.project=$2 ORDER BY r.ordinal`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { reference_kind: string; reference_id: string }[];
}

test("a clean preparation writes the candidate over the observed target and records it", async () => {
  const { project, remote } = await subject("clean", [
    { path: "one.txt", content: "one\n" },
    { path: "lib/two.txt", content: "two\n" },
  ]);
  const port = remotePort();
  const report = await passOnce(project, port, "clean");
  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  const attempts = await attemptsOf(project);
  const written = attempts[0];
  assert.equal(attempts.length, 1);
  assert.equal(written?.outcome, "Prepared");
  assert.equal(written?.failure_kind, null);
  assert.equal(written?.approval_required, false);
  assert.equal(written?.attempt_digest.length, 64);
  assert.equal(
    written?.target_commit,
    fixtureGit(remote.origin, "rev-parse", "refs/heads/main"),
  );
  assert.deepEqual(
    (await bundleOf(project)).map((each) => each.reference_kind),
    ["Repository", "ConfigurationRevision", "ResultManifest"],
  );
});

test("a genuine conflict prices one failure and stores its evidence outside every row", async () => {
  const { project, remote } = await subject("conflict", [
    { path: "base.txt", content: "candidate\n" },
  ]);
  const port = movingPort(remotePort(), () => {
    remoteCommit(remote, "base.txt", "moved\n", "moved");
  });
  const report = await passOnce(project, port, "conflict");
  assert.equal(report.preparations, 1);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Failed");
  assert.equal(written?.failure_kind, "MergeConflict");
  assert.equal(written?.candidate_commit, null);
  assert.equal(written?.conflict_manifest?.startsWith("conflict-"), true);
  assert.equal(written?.conflict_manifest_digest?.length, 64);
  assert.equal(
    written?.target_commit,
    fixtureGit(remote.origin, "rev-parse", "refs/heads/main"),
  );
});

test("a target that moved without conflicting is merged and the attempt pins what it merged into", async () => {
  const { project, remote } = await subject("merged", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = movingPort(remotePort(), () => {
    remoteCommit(remote, "other.txt", "other\n", "other");
  });
  await passOnce(project, port, "merged");
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Prepared");
  assert.equal(
    written?.target_commit,
    fixtureGit(remote.origin, "rev-parse", "refs/heads/main"),
  );
  assert.notEqual(written?.candidate_commit, written?.target_commit);
});

test("a target that moves after an attempt restarts preparation rather than chasing it", async () => {
  const { project, remote } = await subject("restart", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = remotePort();
  await passOnce(project, port, "restart");
  const first = (await attemptsOf(project))[0];
  remoteCommit(remote, "other.txt", "other\n", "other");
  await finalizerExpireClaim(rig, project);
  const again = await passOnce(project, port, "restart-again");
  assert.equal(again.preparations, 1);
  assert.equal(again.promotions, 0);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[1]?.attempt, first?.attempt);
  assert.equal(
    attempts[1]?.target_commit,
    fixtureGit(remote.origin, "rev-parse", "refs/heads/main"),
  );
});

test("the restart ceiling becomes a hold and never a priced failure", async () => {
  const { project, remote } = await subject("ceiling", [
    { path: "one.txt", content: "one\n" },
  ]);
  const port = remotePort();
  for (let spent = 0; spent < 4; spent++) {
    await passOnce(project, port, `ceiling-${String(spent)}`);
    remoteCommit(remote, `move-${String(spent)}.txt`, "moved\n", "moved");
    await finalizerExpireClaim(rig, project);
  }
  const exhausted = await passOnce(project, port, "ceiling-last");
  assert.equal(exhausted.preparations, 0);
  assert.equal(exhausted.holds, 1);
  assert.equal(exhausted.conclusions, 0);
  const attempts = await attemptsOf(project);
  assert.equal(attempts.length, 4);
  assert.equal(
    attempts.every((each) => each.outcome === "Prepared"),
    true,
  );
});

test("an artifact whose bytes are not what the manifest declared cannot become a commit", async () => {
  const { project, work } = await subject("unverified", [
    { path: "one.txt", content: "one\n" },
  ]);
  finalizerStoreArtifact(rig, project, work, {
    path: "one.txt",
    content: "tampered\n",
  });
  const report = await passOnce(project, remotePort(), "unverified");
  assert.equal(report.preparations, 1);
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.outcome, "Failed");
  assert.equal(written?.failure_kind, "PreparationFailed");
  assert.equal(written?.conflict_manifest, null);
});

test("a pinned revision that asks for approval opens the ask through the one door that may", async () => {
  const { project } = await subject("approval", [
    { path: "one.txt", content: "one\n" },
  ]);
  await rig.harness.query(
    `UPDATE configuration_revision
        SET canonical = $3, digest = digest
      WHERE tenant=$1 AND project=$2`,
    [
      project.partition.tenant,
      project.partition.project,
      '{"finalizationApprovalRequired":true,"image":"i","version":1}',
    ],
  );
  const port = remotePort();
  await passOnce(project, port, "approval");
  assert.equal((await attemptsOf(project))[0]?.approval_required, true);
  await finalizerExpireClaim(rig, project);
  const asked = await passOnce(project, port, "approval-again");
  assert.equal(asked.approvals, 1);
  const actions = await rig.as(
    `SELECT kind, required_capability, state, attempt FROM native_action
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.["kind"], "FinalizationApproval");
  assert.equal(actions[0]?.["required_capability"], "ApproveFinalization");
  assert.equal(actions[0]?.["state"], "Open");
  await finalizerExpireClaim(rig, project);
  const standing = await passOnce(project, port, "approval-third");
  assert.equal(standing.approvals, 0);
  assert.equal(standing.holds, 1);
});

test("an attempt a retired holder offers is refused, and its bundle is refused with it", async () => {
  const { project } = await subject("fenced", [
    { path: "one.txt", content: "one\n" },
  ]);
  const claim = await finalizerClaim(rig, project, "owner-fenced");
  const store = postgresFinalizer(rig.pool);
  const first = attemptRecordOf(claim, project, "fenced-one");
  assert.deepEqual(await store.recordAttempt(first), { recorded: "Attempt" });
  await rig.as(
    `UPDATE finalization_request SET claim_generation = claim_generation + 1
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  const second = attemptRecordOf(claim, project, "fenced-two");
  assert.deepEqual(await store.recordAttempt(second), { recorded: "Fenced" });
  assert.deepEqual(
    (await attemptsOf(project)).map((each) => each.attempt),
    [first.attempt],
  );
  const bundles = await rig.as(
    `SELECT bundle FROM input_bundle WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(bundles.length, 1);
});

test("an attempt is written once, and the trigger says so rather than a read", async () => {
  const { project } = await subject("immutable", [
    { path: "one.txt", content: "one\n" },
  ]);
  await passOnce(project, remotePort(), "immutable");
  const written = (await attemptsOf(project))[0];
  assert.match(
    await rig.refusal(
      `UPDATE finalization_attempt SET outcome='Failed'
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, written?.attempt],
    ),
    /permission denied/u,
  );
  assert.match(
    await rig.ownerRefusal(
      `UPDATE finalization_attempt SET outcome='Failed'
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, written?.attempt],
    ),
    /written once/u,
  );
});

test("the conflict manifest the attempt names is stored, read-only, and hashes to the digest beside it", async () => {
  const { project, remote } = await subject("evidence", [
    { path: "base.txt", content: "candidate\n" },
  ]);
  const port = movingPort(remotePort(), () => {
    remoteCommit(remote, "base.txt", "moved\n", "moved");
  });
  await passOnce(project, port, "evidence");
  const written = (await attemptsOf(project))[0];
  assert.equal(written?.failure_kind, "MergeConflict");
  const stored = artifactOwnedFile(
    artifactProjectDirectory(
      rig.artifactRoot,
      project.partition.tenant,
      project.partition.project,
    ),
    written?.conflict_manifest ?? "",
  );
  const bytes = readFileSync(stored);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    written?.conflict_manifest_digest,
  );
  assert.equal((statSync(stored).mode & 0o222) === 0, true);
  const evidence = JSON.parse(bytes.toString("utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(evidence["request"], project.request);
  assert.equal(evidence["attempt"], written?.attempt);
  assert.equal(evidence["strategy"], "Merge");
  assert.deepEqual(evidence["conflictingPaths"], ["base.txt"]);
  assert.equal(
    evidence["mergeBase"],
    fixtureGit(remote.seed, "rev-parse", "HEAD~1"),
  );
});
