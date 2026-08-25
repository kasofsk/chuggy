/**
 * What a concluded finalization becomes: nothing at all where the integration
 * was clean, and the input bundle the deciding transaction materializes for the
 * work set it spawns where it was not.
 *
 * THE PRICING IS READ AND NOT INFERRED FROM THE PHASE. A clean integration that
 * had quietly spent the finalization account, and a conflict that had not, would
 * both leave the phase every weaker assertion looks at, so the cases replay the
 * journal and read the ticket's own accounts either side of the decision.
 *
 * THE WHOLE PATH IS REAL. A real bare repository produces the conflict, the
 * real finalizer submits through the real door, and the real project writer
 * decides the result — because the claim under test is that one transaction
 * writes the bundle and pins it, and a fixture that wrote the bundle itself
 * would be asserting itself.
 *
 * THE CLAIM IS WHAT A WORKER CAN DO WITH THE ROW. So the assertions read the
 * bundle alone and ask whether it names the reconciliation objective, and then
 * move the target ref and ask again — a bundle that answered from the ref would
 * change its answer, and this one cannot.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import {
  artifactOwnedFile,
  artifactProjectDirectory,
} from "../../src/adapters/artifacts/artifactKey.ts";
import { finalizerRowValue } from "../../src/adapters/postgres/finalizerRows.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { Ticket } from "../../src/domain/generated/modelTypes.ts";
import {
  retrofitBundleDigest,
  retrofitBundleIdentity,
} from "../../src/adapters/postgres/schema.ts";
import {
  allInputBundleReferenceKinds,
  asInputBundleId,
  type InputBundleReference,
} from "../../src/interpreter/finalizer.ts";
import { canonicalInputBundle } from "../../src/interpreter/finalizerPreparation.ts";
import {
  finalizerDrain,
  finalizerExpireClaim,
  finalizerGitVerb,
  finalizerMovingPort,
  finalizerPassOnce,
  finalizerRemoteCommit,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerSubject,
  type FinalizerProject,
  type FinalizerRemote,
  type FinalizerRig,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** One bundle reference as the deciding transaction wrote it. */
interface ReworkReference {
  readonly reference_kind: string;
  readonly reference_id: string;
  readonly reference_digest: string | null;
}

/** The attempt evidence a case compares the bundle against. */
interface ReworkAttempt {
  readonly attempt: string;
  readonly attempt_digest: string;
  readonly target_commit: string;
  readonly conflict_manifest: string;
  readonly conflict_manifest_digest: string;
}

/** The bundle the spawn request this decision authorized pins, with what it holds. */
interface ReworkBundle {
  readonly bundle: string;
  readonly digest: string;
  readonly references: readonly ReworkReference[];
}

/** What one project's newest spawn registration pins, read as a worker would read it. */
async function reworkBundleOf(
  project: FinalizerProject,
): Promise<ReworkBundle> {
  const pinned = (await rig.harness.query(
    `SELECT input_bundle AS bundle, input_bundle_digest AS digest
       FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnWork'
      ORDER BY authorizing_seq DESC LIMIT 1`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { bundle: string; digest: string }[];
  const row = pinned[0];
  if (row === undefined) {
    throw new Error("finalizer rework: the decision authorized no work set");
  }
  const references = (await rig.harness.query(
    `SELECT reference_kind, reference_id, reference_digest
       FROM input_bundle_reference
      WHERE tenant=$1 AND project=$2 AND bundle=$3 ORDER BY ordinal`,
    [project.partition.tenant, project.partition.project, row.bundle],
  )) as readonly unknown[] as readonly ReworkReference[];
  return { ...row, references };
}

/** The failed attempt this project's finalization concluded on. */
async function reworkAttemptOf(
  project: FinalizerProject,
): Promise<ReworkAttempt> {
  const found = (await rig.harness.query(
    `SELECT attempt, attempt_digest, target_commit, conflict_manifest,
            conflict_manifest_digest
       FROM finalization_attempt
      WHERE tenant=$1 AND project=$2 AND outcome='Failed'`,
    [project.partition.tenant, project.partition.project],
  )) as readonly unknown[] as readonly ReworkAttempt[];
  const row = found[0];
  if (row === undefined) {
    throw new Error("finalizer rework: no failure was concluded");
  }
  return row;
}

/** The phase the project writer left the ticket in. */
async function reworkPhaseOf(project: FinalizerProject): Promise<unknown> {
  const rows = await rig.harness.query(
    `SELECT phase FROM ticket_projection WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  return rows[0]?.["phase"];
}

/**
 * A ticket whose genuine merge conflict was concluded and decided: the remote
 * that produced it, the evidence the attempt holds and the bundle the decision
 * materialized from it.
 */
async function reworked(label: string): Promise<{
  project: FinalizerProject;
  remote: FinalizerRemote;
  attempt: ReworkAttempt;
  bundle: ReworkBundle;
  priced: Ticket;
}> {
  const { project, remote } = await finalizerSubject(rig, label, [
    { path: "base.txt", content: "candidate\n" },
  ]);
  const conflicting = finalizerMovingPort(finalizerRemotePort(rig), () => {
    finalizerRemoteCommit(remote, "base.txt", "moved\n", "moved");
  });
  const prepared = await finalizerPassOnce(rig, project, conflicting, label);
  assert.equal(prepared.preparations, 1, "the conflict was prepared");
  await finalizerExpireClaim(rig, project);
  const concluded = await finalizerPassOnce(
    rig,
    project,
    finalizerRemotePort(rig),
    `${label}-conclude`,
  );
  assert.equal(concluded.conclusions, 1, "the failure was submitted");
  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"], "the result was decided");
  return {
    project,
    remote,
    attempt: await reworkAttemptOf(project),
    bundle: await reworkBundleOf(project),
    priced: ticketAt(drained.memory.core, asTicketId(project.ticket)),
  };
}

/** What the ticket the project's history released was priced at before any finalization. */
function reworkPricedBefore(project: FinalizerProject): Ticket {
  return ticketAt(project.memory.core, asTicketId(project.ticket));
}

/** The spawn registrations this project holds, which is what a rework adds one to. */
async function reworkSpawnsOf(
  project: FinalizerProject,
): Promise<readonly string[]> {
  const rows = (await rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnWork' ORDER BY authorizing_seq`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { request: string }[];
  return rows.map((row) => row.request);
}

/** The one reference of that kind, refusing a bundle that named it twice or not at all. */
function reworkReference(
  bundle: ReworkBundle,
  kind: string,
): ReworkReference | undefined {
  const named = bundle.references.filter(
    (each) => each.reference_kind === kind,
  );
  assert.ok(named.length <= 1, `${kind} is named at most once`);
  return named[0];
}

test("a clean automatic integration concludes without pricing a rework or leaving the phase", async () => {
  const { project, remote } = await finalizerSubject(rig, "clean", [
    { path: "one.txt", content: "one\n" },
  ]);
  const before = reworkPricedBefore(project);
  const spawns = await reworkSpawnsOf(project);
  const moving = finalizerMovingPort(finalizerRemotePort(rig), () => {
    finalizerRemoteCommit(remote, "other.txt", "other\n", "other");
  });
  assert.equal(
    (await finalizerPassOnce(rig, project, moving, "clean")).preparations,
    1,
  );
  const port = finalizerRemotePort(rig);
  for (const round of ["promote", "conclude"]) {
    assert.equal(await reworkPhaseOf(project), "Finalizing", round);
    await finalizerExpireClaim(rig, project);
    const pass = await finalizerPassOnce(rig, project, port, `clean-${round}`);
    assert.equal(pass.holds, 0, round);
  }
  const attempt = (await rig.harness.query(
    `SELECT candidate_commit, target_commit FROM finalization_attempt
      WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { candidate_commit: string; target_commit: string }[];
  assert.equal(attempt.length, 1);
  assert.notEqual(attempt[0]?.candidate_commit, attempt[0]?.target_commit);
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
    attempt[0]?.candidate_commit,
  );

  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  const priced = ticketAt(drained.memory.core, asTicketId(project.ticket));
  assert.equal(priced.phase, "Done");
  assert.equal(priced.completions, before.completions + 1);
  assert.equal(priced.finalizationLeft, before.finalizationLeft, "priced");
  assert.equal(priced.gasLeft, before.gasLeft, "metered");
  assert.equal(priced.reworkLeft, before.reworkLeft, "reworked");
  assert.deepEqual(await reworkSpawnsOf(project), spawns);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT count(*)::text AS made FROM input_bundle_reference
        WHERE tenant=$1 AND project=$2
          AND reference_kind IN ('FinalizationAttempt','ConflictManifest')`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ made: "0" }],
  );
});

test("a concluded merge conflict returns the ticket to work with a bundle naming its evidence", async () => {
  const { project, attempt, bundle, priced } = await reworked("rework");
  const before = reworkPricedBefore(project);
  assert.equal(priced.finalizationLeft, before.finalizationLeft - 1, "priced");
  assert.equal(priced.gasLeft, before.gasLeft - 1, "metered");
  assert.equal(priced.reworkLeft, before.reworkLeft, "the eval account paid");
  assert.equal(await reworkPhaseOf(project), "Working");
  assert.deepEqual(reworkReference(bundle, "FinalizationAttempt"), {
    reference_kind: "FinalizationAttempt",
    reference_id: attempt.attempt,
    reference_digest: attempt.attempt_digest,
  });
  assert.deepEqual(reworkReference(bundle, "ConflictManifest"), {
    reference_kind: "ConflictManifest",
    reference_id: attempt.conflict_manifest,
    reference_digest: attempt.conflict_manifest_digest,
  });
  assert.deepEqual(reworkReference(bundle, "TargetCommit"), {
    reference_kind: "TargetCommit",
    reference_id: attempt.target_commit,
    reference_digest: null,
  });
  assert.equal(
    reworkReference(bundle, "Repository")?.reference_id,
    project.repository,
  );
  assert.equal(
    reworkReference(bundle, "ConfigurationRevision")?.reference_id,
    project.configurationRevision,
  );
  assert.equal(
    reworkReference(bundle, "ResultManifest")?.reference_id?.startsWith(
      "manifest-",
    ),
    true,
  );
});

test("the bundle's digest is over exactly the references it stored", async () => {
  const { project, bundle } = await reworked("rework-digest");
  const references: readonly InputBundleReference[] = bundle.references.map(
    (each) => ({
      kind: finalizerRowValue(
        allInputBundleReferenceKinds,
        each.reference_kind,
        "bundle reference kind",
      ),
      reference: each.reference_id,
      ...(each.reference_digest === null
        ? {}
        : { digest: each.reference_digest }),
    }),
  );
  assert.equal(
    bundle.digest,
    createHash("sha256")
      .update(
        canonicalInputBundle(
          project.partition,
          asInputBundleId(bundle.bundle),
          references,
        ),
        "utf8",
      )
      .digest("hex"),
  );
});

test("the objective is formed from the bundle alone, with no ref read and no finalizer row", async () => {
  const { project, remote, bundle } = await reworked("rework-objective");
  const conflict = reworkReference(bundle, "ConflictManifest");
  const named = reworkReference(bundle, "TargetCommit");
  assert.ok(conflict !== undefined && named !== undefined);
  const stored = readFileSync(
    artifactOwnedFile(
      artifactProjectDirectory(
        rig.artifactRoot,
        project.partition.tenant,
        project.partition.project,
      ),
      conflict.reference_id,
    ),
  );
  assert.equal(
    createHash("sha256").update(stored).digest("hex"),
    conflict.reference_digest,
    "the manifest is not the one the bundle pinned",
  );
  const objective = JSON.parse(stored.toString("utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(
    objective["attempt"],
    reworkReference(bundle, "FinalizationAttempt")?.reference_id,
  );
  assert.equal(objective["targetCommit"], named.reference_id);
  assert.equal(objective["strategy"], "Merge");
  assert.deepEqual(objective["conflictingPaths"], ["base.txt"]);
  assert.equal(
    objective["mergeBase"],
    finalizerGitVerb(remote.seed, "rev-parse", "HEAD~1"),
  );
  finalizerRemoteCommit(remote, "later.txt", "later\n", "later");
  assert.notEqual(
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
    objective["targetCommit"],
    "the objective is only as stable as the ref it was read from",
  );
});

test("a target ref that moved afterwards changes nothing the bundle names", async () => {
  const { project, remote, bundle } = await reworked("rework-moved");
  const moved = finalizerRemoteCommit(remote, "later.txt", "later\n", "later");
  assert.equal(
    finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main"),
    moved,
  );
  assert.notEqual(reworkReference(bundle, "TargetCommit")?.reference_id, moved);
  assert.deepEqual(await reworkBundleOf(project), bundle);
});

test("the retrofit expressions spell the identity and canonical bytes this tree digests", async () => {
  const { project } = await reworked("rework-backfill");
  const rows = (await rig.harness.query(
    `SELECT ${retrofitBundleIdentity} AS retrofit,
            ${retrofitBundleDigest} AS digest,
            r.configuration_revision, r.configuration_digest
       FROM execution_request r
      WHERE r.tenant=$1 AND r.project=$2 AND r.kind='SpawnWork'
      ORDER BY r.authorizing_seq LIMIT 1`,
    [project.partition.tenant, project.partition.project],
  )) as readonly {
    retrofit: string;
    digest: string;
    configuration_revision: string;
    configuration_digest: string;
  }[];
  const row = rows[0];
  assert.ok(row !== undefined);
  assert.equal(
    row.digest,
    createHash("sha256")
      .update(
        canonicalInputBundle(project.partition, asInputBundleId(row.retrofit), [
          {
            kind: "ConfigurationRevision",
            reference: row.configuration_revision,
            digest: row.configuration_digest,
          },
        ]),
        "utf8",
      )
      .digest("hex"),
  );
});
