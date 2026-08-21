/**
 * Every constraint migration eleven's relations carry, met by the row that
 * violates it. A constraint nobody wrote a violating row against is a claim
 * about the schema and not a fact about the server, and the shapes that go
 * wrong here — a closed set that admits one more member, a wholeness rule that
 * only reads one way — look identical to the shapes that hold.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  allCommitPermitStates,
  allFinalizationAttemptOutcomes,
  allFinalizationFailureKinds,
  allInputBundleReferenceKinds,
  allIntegrationStrategies,
  allReconciliationVerdicts,
} from "../../src/interpreter/finalizer.ts";
import {
  finalizerBundle,
  finalizerCommit,
  finalizerDigest,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import { postgresHarnessProject } from "./harness.ts";

let rig: FinalizerRig;
let project: FinalizerProject;
let attempt: string;
let permit: string;
let attemptBundle: { bundle: string; digest: string };
before(async () => {
  rig = await finalizerRigOpen();
  project = await finalizerProject(rig, "constraints");
  attemptBundle = await finalizerBundle(rig, project, "constraints");
  attempt = await finalizerPrepare(rig, project, "constraints");
  permit = await finalizerGrantPermit(rig, project, attempt, "constraints");
});
after(async () => {
  await rig.close();
});

/** The partition every row in this suite belongs to, which every statement leads with. */
function keys(...rest: readonly unknown[]): readonly unknown[] {
  return [project.partition.tenant, project.partition.project, ...rest];
}

/** Writes one attempt row whose columns a case chose, as the finalizer. */
function attemptRow(
  identity: string,
  outcome: string,
  candidate: string | null,
  failureKind: string | null,
  conflict: string | null,
  strategy = "Merge",
  digest = finalizerDigest(),
  conflictDigest: string | null = null,
): Promise<string> {
  return rig.refusal(
    `INSERT INTO finalization_attempt
       (tenant, project, attempt, request, ticket, repository, input_bundle,
        input_bundle_digest, target_ref,
        target_commit, strategy, configuration_revision, configuration_digest,
        approval_required, outcome, candidate_commit, failure_kind,
        conflict_manifest, conflict_manifest_digest, attempt_digest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'refs/heads/main',$9,$10,$11,$12,false,$13,$14,$15,$16,$17,$18)`,
    keys(
      identity,
      project.request,
      project.ticket,
      project.repository,
      attemptBundle.bundle,
      attemptBundle.digest,
      finalizerCommit(),
      strategy,
      project.configurationRevision,
      project.configurationDigest,
      outcome,
      candidate,
      failureKind,
      conflict,
      conflictDigest,
      digest,
    ),
  );
}

test("an attempt's outcome, failure kind and strategy are each a closed set", async () => {
  for (const [outcome, kind, strategy] of [
    ["Abandoned", null, "Merge"],
    ["Failed", "Withdrawn", "Merge"],
    ["Prepared", null, "Rebase"],
  ] as readonly (readonly [string, string | null, string])[]) {
    assert.match(
      await attemptRow(
        finalizerIdentity("closed"),
        outcome,
        outcome === "Prepared" ? finalizerCommit() : null,
        kind,
        null,
        strategy,
      ),
      /finalization_attempt_(outcome|failure_kind|strategy)_is_known/u,
      `${outcome}/${String(kind)}/${strategy}`,
    );
  }
  assert.deepEqual(
    [
      allFinalizationAttemptOutcomes,
      allFinalizationFailureKinds,
      allIntegrationStrategies,
    ].map((closed) => closed.length > 0),
    [true, true, true],
  );
});

test("an attempt is whole: prepared pins a candidate, failed names a kind, conflict follows one", async () => {
  for (const [outcome, candidate, kind, conflict] of [
    ["Prepared", null, null, null],
    ["Failed", finalizerCommit(), null, null],
    ["Failed", null, null, null],
    ["Prepared", finalizerCommit(), "MergeConflict", null],
    ["Failed", null, "PreparationFailed", "manifest"],
  ] as readonly (readonly [
    string,
    string | null,
    string | null,
    string | null,
  ])[]) {
    assert.match(
      await attemptRow(
        finalizerIdentity("whole"),
        outcome,
        candidate,
        kind,
        conflict,
      ),
      /finalization_attempt_outcome_is_whole/u,
      `${outcome}/${String(candidate)}/${String(kind)}/${String(conflict)}`,
    );
  }
});

test("a conflict manifest and the digest that speaks for it stand or fall together", async () => {
  assert.match(
    await attemptRow(
      finalizerIdentity("halfmanifest"),
      "Failed",
      null,
      "MergeConflict",
      "conflict-1",
      "Merge",
      finalizerDigest(),
      null,
    ),
    /finalization_attempt_outcome_is_whole/u,
  );
  assert.match(
    await attemptRow(
      finalizerIdentity("halfdigest"),
      "Failed",
      null,
      "MergeConflict",
      null,
      "Merge",
      finalizerDigest(),
      finalizerDigest(),
    ),
    /finalization_attempt_outcome_is_whole/u,
  );
  assert.match(
    await attemptRow(
      finalizerIdentity("baddigest"),
      "Failed",
      null,
      "MergeConflict",
      "conflict-1",
      "Merge",
      finalizerDigest(),
      "not-a-digest",
    ),
    /finalization_attempt_digest_is_hex/u,
  );
});

test("an attempt's commits are object identities and its digest is one too", async () => {
  assert.match(
    await attemptRow(
      finalizerIdentity("badcommit"),
      "Prepared",
      "not-a-commit",
      null,
      null,
    ),
    /finalization_attempt_commits_are_object_ids/u,
  );
  assert.match(
    await attemptRow(
      finalizerIdentity("baddigest"),
      "Prepared",
      finalizerCommit(),
      null,
      null,
      "Merge",
      "not-a-digest",
    ),
    /finalization_attempt_digest_is_hex/u,
  );
});

test("an attempt names a request, a repository and a configuration that were retained", async () => {
  for (const [values, constraint] of [
    [
      keys(
        finalizerIdentity("noreq"),
        "no-such-request",
        project.repository,
        project.configurationRevision,
        project.configurationDigest,
      ),
      "finalization_attempt_has_its_request",
    ],
    [
      keys(
        finalizerIdentity("norepo"),
        project.request,
        "no-such-repository",
        project.configurationRevision,
        project.configurationDigest,
      ),
      "finalization_attempt_has_its_repository",
    ],
    [
      keys(
        finalizerIdentity("nocfg"),
        project.request,
        project.repository,
        project.configurationRevision,
        finalizerDigest(),
      ),
      "finalization_attempt_configuration_is_retained",
    ],
  ] as readonly (readonly [readonly unknown[], string])[]) {
    assert.match(
      await rig.refusal(
        `INSERT INTO finalization_attempt
           (tenant, project, attempt, request, ticket, repository, input_bundle,
            input_bundle_digest, target_ref,
            target_commit, strategy, configuration_revision, configuration_digest,
            approval_required, outcome, candidate_commit, attempt_digest)
         VALUES ($1,$2,$3,$4,1,$5,$11,$12,'refs/heads/main',$8,'Merge',$6,$7,false,
                 'Prepared',$9,$10)`,
        [
          ...values,
          finalizerCommit(),
          finalizerCommit(),
          finalizerDigest(),
          attemptBundle.bundle,
          attemptBundle.digest,
        ],
      ),
      new RegExp(constraint, "u"),
      constraint,
    );
  }
});

test("an attempt identity is never reused, in this project or another", async () => {
  const other = await finalizerProject(rig, "constraints-other");
  const elsewhere = await finalizerBundle(rig, other, "constraints-other");
  assert.match(
    await rig.refusal(
      `INSERT INTO finalization_attempt
         (tenant, project, attempt, request, ticket, repository, input_bundle,
          input_bundle_digest, target_ref,
          target_commit, strategy, configuration_revision, configuration_digest,
          approval_required, outcome, candidate_commit, attempt_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$12,$13,'refs/heads/main',$7,'Merge',$8,$9,false,
               'Prepared',$10,$11)`,
      [
        other.partition.tenant,
        other.partition.project,
        attempt,
        other.request,
        other.ticket,
        other.repository,
        finalizerCommit(),
        other.configurationRevision,
        other.configurationDigest,
        finalizerCommit(),
        finalizerDigest(),
        elsewhere.bundle,
        elsewhere.digest,
      ],
    ),
    /finalization_attempt_identity_is_never_reused/u,
  );
});

test("a permit's state is a closed set and its conclusion is whole", async () => {
  for (const [state, concluded, constraint] of [
    ["Abandoned", null, "commit_permit_state_is_known"],
    ["Concluded", null, "commit_permit_conclusion_is_whole"],
    ["Granted", "now()", "commit_permit_conclusion_is_whole"],
  ] as readonly (readonly [string, string | null, string])[]) {
    assert.match(
      await rig.refusal(
        `INSERT INTO commit_permit
           (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation,
            state, concluded_at)
         VALUES ($1,$2,$3,$4,$5,1,$6,${concluded ?? "NULL"})`,
        keys(finalizerIdentity("permit-closed"), attempt, project.epoch, state),
      ),
      new RegExp(constraint, "u"),
      `${state}/${String(concluded)}`,
    );
  }
  assert.equal(allCommitPermitStates.includes("Granted"), true);
});

test("a permit names one attempt, once, under an epoch that exists", async () => {
  const other = await finalizerProject(rig, "constraints-permit");
  const only = await finalizerPrepare(rig, other, "constraints-permit");
  const held = [other.partition.tenant, other.partition.project];
  for (const [values, constraint] of [
    [
      [...held, permit, only, other.epoch],
      "commit_permit_identity_is_never_reused",
    ],
    [
      [
        ...held,
        finalizerIdentity("permit-noatt"),
        "no-such-attempt",
        other.epoch,
      ],
      "commit_permit_has_its_attempt",
    ],
    [
      [...held, finalizerIdentity("permit-noep"), only, "no-such-epoch"],
      "commit_permit_recovery_epoch_fkey",
    ],
  ] as readonly (readonly [readonly unknown[], string])[]) {
    assert.match(
      await rig.refusal(
        `INSERT INTO commit_permit
           (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
         VALUES ($1,$2,$3,$4,$5,1)`,
        values,
      ),
      new RegExp(constraint, "u"),
      constraint,
    );
  }
  await finalizerGrantPermit(rig, other, only, "constraints-permit");
  assert.match(
    await rig.refusal(
      `INSERT INTO commit_permit
         (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
       VALUES ($1,$2,$3,$4,$5,1)`,
      [...held, finalizerIdentity("permit-dup"), only, other.epoch],
    ),
    /commit_permit_(is_one_per_attempt|one_live)/u,
  );
});

test("a reconciliation's verdict is a closed set and its reading is whole", async () => {
  for (const [verdict, observed, constraint] of [
    [
      "Unknown",
      finalizerCommit(),
      "finalization_reconciliation_verdict_is_known",
    ],
    ["Unreadable", finalizerCommit(), "reconciliation_reading_is_whole"],
    ["Promoted", null, "reconciliation_reading_is_whole"],
    ["Promoted", "not-a-commit", "reconciliation_commits_are_object_ids"],
  ] as readonly (readonly [string, string | null, string])[]) {
    assert.match(
      await rig.refusal(
        `INSERT INTO finalization_reconciliation
           (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
         VALUES ($1,$2,$3,$4,'refs/heads/main',$5,$6)`,
        keys(permit, finalizerCommit(), verdict, observed),
      ),
      new RegExp(constraint, "u"),
      `${verdict}/${String(observed)}`,
    );
  }
  assert.equal(allReconciliationVerdicts.includes("Unreadable"), true);
});

test("a reconciliation belongs to a permit and there is one of it per permit", async () => {
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,'refs/heads/main','Unreadable',NULL)`,
    keys(permit, finalizerCommit()),
  );
  for (const [named, constraint] of [
    [permit, "finalization_reconciliation_pkey"],
    ["no-such-permit", "finalization_reconciliation_has_its_permit"],
  ] as readonly (readonly [string, string])[]) {
    assert.match(
      await rig.refusal(
        `INSERT INTO finalization_reconciliation
           (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
         VALUES ($1,$2,$3,$4,'refs/heads/main','Unreadable',NULL)`,
        keys(named, finalizerCommit()),
      ),
      new RegExp(constraint, "u"),
      constraint,
    );
  }
});

test("one repository belongs to one project and one project binds one repository", async () => {
  const unbound = await postgresHarnessProject(
    rig.harness.store,
    "constraints-exclusive",
  );
  for (const [values, constraint] of [
    [
      [unbound.tenant, unbound.project, project.repository, project.epoch],
      "project_repository_is_exclusive",
    ],
    [
      keys(finalizerIdentity("repository-second"), project.epoch),
      "project_repository_pkey",
    ],
    [
      [
        unbound.tenant,
        unbound.project,
        finalizerIdentity("repository-noep"),
        "no-such-epoch",
      ],
      "project_repository_recovery_epoch_fkey",
    ],
  ] as readonly (readonly [readonly unknown[], string])[]) {
    assert.match(
      await rig.ownerRefusal(
        `INSERT INTO project_repository (tenant, project, repository, recovery_epoch)
         VALUES ($1,$2,$3,$4)`,
        values,
      ),
      new RegExp(constraint, "u"),
      constraint,
    );
  }
});

test("a bundle is written once, digested, and its references are a bounded closed set", async () => {
  const bundle = finalizerIdentity("bundle");
  await rig.harness.query(
    `INSERT INTO input_bundle (tenant, project, bundle, digest) VALUES ($1,$2,$3,$4)`,
    keys(bundle, finalizerDigest()),
  );
  assert.match(
    await rig.ownerRefusal(
      `INSERT INTO input_bundle (tenant, project, bundle, digest) VALUES ($1,$2,$3,'nope')`,
      keys(finalizerIdentity("bundle-bad")),
    ),
    /input_bundle_digest_is_hex/u,
  );
  assert.match(
    await rig.ownerRefusal(
      `UPDATE input_bundle SET digest=$4 WHERE tenant=$1 AND project=$2 AND bundle=$3`,
      keys(bundle, finalizerDigest()),
    ),
    /is written once/u,
  );
  for (const [ordinal, kind, constraint] of [
    [0, "Artifact", "input_bundle_reference_count_is_bounded"],
    [1, "Secret", "input_bundle_reference_kind_is_known"],
  ] as readonly (readonly [number, string, string])[]) {
    assert.match(
      await rig.ownerRefusal(
        `INSERT INTO input_bundle_reference
           (tenant, project, bundle, ordinal, reference_kind, reference_id)
         VALUES ($1,$2,$3,$4,$5,'reference')`,
        keys(bundle, ordinal, kind),
      ),
      new RegExp(constraint, "u"),
      constraint,
    );
  }
  assert.match(
    await rig.ownerRefusal(
      `INSERT INTO input_bundle_reference
         (tenant, project, bundle, ordinal, reference_kind, reference_id, reference_digest)
       VALUES ($1,$2,$3,1,'Artifact','reference','not-a-digest')`,
      keys(bundle),
    ),
    /input_bundle_reference_digest_is_hex/u,
  );
  assert.equal(allInputBundleReferenceKinds.includes("Artifact"), true);
});

test("an attempt and a registration each pin a bundle that was retained", async () => {
  assert.match(
    await rig.refusal(
      `INSERT INTO finalization_attempt
         (tenant, project, attempt, request, ticket, repository, input_bundle,
          input_bundle_digest, target_ref, target_commit, strategy,
          configuration_revision, configuration_digest, approval_required,
          outcome, candidate_commit, attempt_digest)
       VALUES ($1,$2,$3,$4,$5,$6,'no-such-bundle',$7,'refs/heads/main',$8,'Merge',
               $9,$10,false,'Prepared',$11,$12)`,
      keys(
        finalizerIdentity("nobundle"),
        project.request,
        project.ticket,
        project.repository,
        attemptBundle.digest,
        finalizerCommit(),
        project.configurationRevision,
        project.configurationDigest,
        finalizerCommit(),
        finalizerDigest(),
      ),
    ),
    /finalization_attempt_has_its_bundle/u,
  );
  assert.match(
    await rig.ownerRefusal(
      `UPDATE execution_request SET input_bundle=NULL, input_bundle_digest=NULL
        WHERE tenant=$1 AND project=$2 AND kind='SpawnWork'`,
      keys(),
    ),
    /execution_request_pins_its_bundle/u,
  );
});

test("a request's claim is fenced by an epoch and one stays live per ticket", async () => {
  assert.match(
    await rig.refusal(
      `UPDATE finalization_request SET claim_owner='owner', claim_expires_at=now()
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      keys(project.request),
    ),
    /finalization_request_claim_is_fenced/u,
  );
  assert.match(
    await rig.ownerRefusal(
      `INSERT INTO finalization_request
         (tenant, project, request, authorizing_seq, effect_position, ticket,
          ticket_version, request_generation)
       VALUES ($1,$2,$3,$4,$5,$6,$4,1)`,
      keys(
        finalizerIdentity("request-second"),
        project.authorizingSeq,
        1,
        project.ticket,
      ),
    ),
    /finalization_request_one_live/u,
  );
  await rig.as(
    `UPDATE finalization_request SET state='Registered', claim_owner='holder',
        claim_expires_at=now()+interval '60 seconds', recovery_epoch=$4
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [...keys(project.request), project.epoch],
  );
  assert.match(
    await rig.ownerRefusal(
      `INSERT INTO finalization_request
         (tenant, project, request, authorizing_seq, effect_position, ticket,
          ticket_version, request_generation)
       VALUES ($1,$2,$3,$4,$5,$6,$4,1)`,
      keys(
        finalizerIdentity("request-held"),
        project.authorizingSeq,
        2,
        project.ticket,
      ),
    ),
    /finalization_request_one_live/u,
  );
});

test("a native action names an attempt exactly when it asks for an approval", async () => {
  for (const [kind, capability, named, constraint] of [
    [
      "FinalizationApproval",
      "ApproveFinalization",
      null,
      "names_its_capability",
    ],
    ["TicketEscalation", "ResolveTicket", attempt, "names_its_capability"],
    ["FinalizationApproval", "ResolveTicket", attempt, "names_its_capability"],
    [
      "Withdrawal",
      "ApproveFinalization",
      attempt,
      "native_action_kind_is_known",
    ],
    [
      "FinalizationApproval",
      "ApproveFinalization",
      "no-such-attempt",
      "native_action_attempt_is_its_own",
    ],
  ] as readonly (readonly [string, string, string | null, string])[]) {
    assert.match(
      await rig.ownerRefusal(
        `INSERT INTO native_action
           (tenant, project, action, authorizing_seq, effect_position, ticket,
            action_version, kind, reason, required_capability, attempt)
         VALUES ($1,$2,$3,$4,$5,$6,$4,$7,'NoReason',$8,$9)`,
        keys(
          finalizerIdentity("action"),
          project.authorizingSeq,
          9,
          project.ticket,
          kind,
          capability,
          named,
        ),
      ),
      new RegExp(constraint, "u"),
      `${kind}/${capability}/${String(named)}`,
    );
  }
});
