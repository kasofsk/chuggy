/**
 * The two doors the finalizer reaches ticket-service-owned rows through, driven
 * as the role that will actually call them.
 *
 * A REFUSAL IS ASSERTED BY WHAT IT DID NOT WRITE. A call that returned a
 * refusal tag and left a journal entry, an operation or a decision input behind
 * has forged a conclusion just as surely as one that returned success, so every
 * refusal here reads the mailbox afterwards rather than trusting the tag.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { finalizationFunction } from "../../src/adapters/postgres/schema.ts";
import {
  finalizerClaim,
  finalizerCommit,
  finalizerGrantPermit,
  finalizerIdentity,
  finalizerPromote,
  finalizerPrepare,
  finalizerProject,
  finalizerRequestApproval,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** What one project's mailbox currently holds, which a refusal must leave alone. */
async function mailbox(
  project: FinalizerProject,
): Promise<Record<string, unknown>> {
  const rows = await rig.harness.query(
    `SELECT
       (SELECT count(*) FROM journal_entry j WHERE j.tenant=$1 AND j.project=$2)::text AS entries,
       (SELECT count(*) FROM operation o WHERE o.tenant=$1 AND o.project=$2)::text AS operations,
       (SELECT count(*) FROM decision_input d WHERE d.tenant=$1 AND d.project=$2)::text AS inputs`,
    [project.partition.tenant, project.partition.project],
  );
  const held = rows[0];
  if (held === undefined) throw new Error("finalizer boundary: no mailbox");
  return held;
}

/** Calls the submission door as the finalizer and answers the tag it returned. */
async function submit(
  project: FinalizerProject,
  attempt: string,
  outcome: string,
  failureKind: string | null,
  generation = project.requestGeneration,
  epoch = project.epoch,
  request = project.request,
): Promise<string> {
  const rows = (await rig.as(
    `SELECT result FROM ${finalizationFunction}($1,$2,$3,$4,$5,$6,$7,$8,$9,'finalizer-subject')`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      attempt,
      outcome,
      failureKind,
      generation,
      epoch,
      finalizerIdentity("operation"),
    ],
  )) as readonly { result: string }[];
  return rows[0]?.result ?? "no row";
}

/** Calls the approval door as the finalizer and answers the tag and action it returned. */
async function ask(
  project: FinalizerProject,
  attempt: string,
  action: string,
  epoch = project.epoch,
): Promise<Record<string, unknown>> {
  return finalizerRequestApproval(rig, project, attempt, action, epoch);
}

/** A project whose claimed request has one promoted, concluded attempt behind it. */
async function promoted(
  label: string,
): Promise<{ project: FinalizerProject; attempt: string }> {
  const project = await finalizerProject(rig, label);
  await finalizerClaim(rig, project, finalizerIdentity(`owner-${label}`));
  return { project, attempt: await finalizerPromote(rig, project, label) };
}

test("a succeeded result the durable rows support is submitted exactly once", async () => {
  const { project, attempt } = await promoted("submit-clean");
  const before = await mailbox(project);
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "Submitted",
  );
  const after = await mailbox(project);
  assert.equal(
    Number(after["operations"]) - Number(before["operations"]),
    1,
    "operations",
  );
  assert.equal(Number(after["inputs"]) - Number(before["inputs"]), 1, "inputs");
  assert.equal(after["entries"], before["entries"], "entries");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT o.authority_kind, o.admission, o.key_version, o.command_tag,
              d.base_priority
         FROM operation o JOIN decision_input d
           ON d.tenant=o.tenant AND d.project=o.project
              AND d.input_kind='Operation' AND d.input_id=o.operation
        WHERE o.tenant=$1 AND o.project=$2 AND o.authority_kind='Finalizer'`,
      [project.partition.tenant, project.partition.project],
    ),
    [
      {
        authority_kind: "Finalizer",
        admission: "CorrectnessReducing",
        key_version: "finalizer-v1",
        command_tag: "FinalizationResult",
        base_priority: "Completion",
      },
    ],
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "AlreadySubmitted",
  );
  assert.deepEqual(await mailbox(project), after);
});

test("a failed result is submitted only against the attempt and kind that failed", async () => {
  const project = await finalizerProject(rig, "submit-failed");
  await finalizerClaim(rig, project, finalizerIdentity("owner-submit-failed"));
  const attempt = await finalizerPrepare(rig, project, "submit-failed", {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  const before = await mailbox(project);
  assert.equal(
    await submit(project, attempt, "FinalizationFailed", "PreparationFailed"),
    "BindingMismatch",
  );
  assert.deepEqual(await mailbox(project), before);
  assert.equal(
    await submit(project, attempt, "FinalizationFailed", "MergeConflict"),
    "Submitted",
  );
});

test("every stale, mismatched or absent binding is refused and writes nothing", async () => {
  const { project, attempt } = await promoted("submit-refuse");
  const other = await promoted("submit-refuse-other");
  const before = await mailbox(project);
  const refusals: readonly (readonly [string, Promise<string>])[] = [
    [
      "UnknownRequest",
      submit(
        project,
        attempt,
        "FinalizationSucceeded",
        null,
        project.requestGeneration,
        project.epoch,
        "no-such-request",
      ),
    ],
    [
      "BindingMismatch",
      submit(project, attempt, "FinalizationSucceeded", null, 99),
    ],
    [
      "BindingMismatch",
      submit(
        project,
        attempt,
        "FinalizationSucceeded",
        null,
        project.requestGeneration,
        "no-such-epoch",
      ),
    ],
    [
      "BindingMismatch",
      submit(project, other.attempt, "FinalizationSucceeded", null),
    ],
    [
      "BindingMismatch",
      submit(project, attempt, "FinalizationFailed", "MergeConflict"),
    ],
    [
      "BindingMismatch",
      submit(project, attempt, "FinalizationSucceeded", "MergeConflict"),
    ],
  ];
  for (const [expected, running] of refusals) {
    assert.equal(await running, expected);
  }
  assert.deepEqual(await mailbox(project), before);
});

test("a succeeded result is refused until the permit is spent and the ref proved it", async () => {
  const project = await finalizerProject(rig, "submit-unproved");
  await finalizerClaim(rig, project, finalizerIdentity("owner-unproved"));
  const candidate = finalizerCommit();
  const attempt = await finalizerPrepare(rig, project, "submit-unproved", {
    candidate,
  });
  const before = await mailbox(project);
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "BindingMismatch",
    "no permit",
  );
  const permit = await finalizerGrantPermit(
    rig,
    project,
    attempt,
    "submit-unproved",
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "BindingMismatch",
    "permit still granted",
  );
  await rig.as(
    `INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES ($1,$2,$3,$4,'refs/heads/main','NotPromoted',$5)`,
    [
      project.partition.tenant,
      project.partition.project,
      permit,
      candidate,
      finalizerCommit(),
    ],
  );
  await rig.as(
    `UPDATE commit_permit SET state='Concluded', concluded_at=now()
      WHERE tenant=$1 AND project=$2 AND permit=$3`,
    [project.partition.tenant, project.partition.project, permit],
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "BindingMismatch",
    "the ref did not prove it",
  );
  assert.deepEqual(await mailbox(project), before);
});

test("a settled or retained request is refused and writes nothing", async () => {
  const { project, attempt } = await promoted("submit-settled");
  const before = await mailbox(project);
  for (const state of ["Fulfilled", "Invalidated"]) {
    await rig.as(
      `UPDATE finalization_request SET state=$4
        WHERE tenant=$1 AND project=$2 AND request=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        state,
      ],
    );
    assert.equal(
      await submit(project, attempt, "FinalizationSucceeded", null),
      "BindingMismatch",
      state,
    );
  }
  await rig.as(
    `UPDATE finalization_request SET state='Registered'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  await rig.harness.query(
    `UPDATE project SET lifecycle='Retention' WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(
    await submit(project, attempt, "FinalizationSucceeded", null),
    "NotAdmitted",
  );
  assert.deepEqual(await mailbox(project), before);
});

test("an outcome the model does not price is refused before anything is read", async () => {
  const { project, attempt } = await promoted("submit-outcome");
  const before = await mailbox(project);
  assert.match(
    await rig.refusal(
      `SELECT result FROM ${finalizationFunction}($1,$2,$3,$4,'Whatever',NULL,$5,$6,$7,'s')`,
      [
        project.partition.tenant,
        project.partition.project,
        project.request,
        attempt,
        project.requestGeneration,
        project.epoch,
        finalizerIdentity("operation"),
      ],
    ),
    /is not one this boundary submits/u,
  );
  assert.deepEqual(await mailbox(project), before);
});

test("an approval is opened against the attempt it names and against no other", async () => {
  const project = await finalizerProject(rig, "approve");
  await finalizerClaim(rig, project, finalizerIdentity("owner-approve"));
  const attempt = await finalizerPrepare(rig, project, "approve", {
    approvalRequired: true,
  });
  const before = await mailbox(project);
  const action = finalizerIdentity("action-approve");
  assert.deepEqual(await ask(project, attempt, action), {
    result: "Requested",
    action,
  });
  assert.deepEqual(
    await rig.as(
      `SELECT kind, state, required_capability, reason, attempt,
              authorizing_seq::text AS seq, action_version::text AS version
         FROM native_action WHERE tenant=$1 AND project=$2 AND action=$3`,
      [project.partition.tenant, project.partition.project, action],
    ),
    [
      {
        kind: "FinalizationApproval",
        state: "Open",
        required_capability: "ApproveFinalization",
        reason: "NoReason",
        attempt,
        seq: String(project.authorizingSeq),
        version: String(project.authorizingSeq),
      },
    ],
  );
  assert.deepEqual(await mailbox(project), before);
  assert.deepEqual(await ask(project, attempt, finalizerIdentity("again")), {
    result: "AlreadyRequested",
    action,
  });
});

test("a re-prepared attempt supersedes the ask a person was holding", async () => {
  const project = await finalizerProject(rig, "supersede");
  await finalizerClaim(rig, project, finalizerIdentity("owner-supersede"));
  const first = await finalizerPrepare(rig, project, "supersede-first", {
    approvalRequired: true,
  });
  const second = await finalizerPrepare(rig, project, "supersede-second", {
    approvalRequired: true,
  });
  const asked = finalizerIdentity("action-first");
  const reasked = finalizerIdentity("action-second");
  assert.equal((await ask(project, first, asked))["result"], "Requested");
  assert.equal((await ask(project, second, reasked))["result"], "Requested");
  assert.deepEqual(
    await rig.as(
      `SELECT attempt, state FROM native_action
        WHERE tenant=$1 AND project=$2 ORDER BY state`,
      [project.partition.tenant, project.partition.project],
    ),
    [
      { attempt: second, state: "Open" },
      { attempt: first, state: "Withdrawn" },
    ],
  );
});

test("an approval nothing durable supports is refused and opens no action", async () => {
  const project = await finalizerProject(rig, "approve-refuse");
  await finalizerClaim(rig, project, finalizerIdentity("owner-refuse"));
  const unrequired = await finalizerPrepare(rig, project, "approve-unrequired");
  const failed = await finalizerPrepare(rig, project, "approve-failed", {
    outcome: "Failed",
    approvalRequired: true,
  });
  const wanted = await finalizerPrepare(rig, project, "approve-wanted", {
    approvalRequired: true,
  });
  for (const [expected, running] of [
    ["UnknownAttempt", ask(project, "no-such-attempt", finalizerIdentity("a"))],
    ["BindingMismatch", ask(project, unrequired, finalizerIdentity("b"))],
    ["BindingMismatch", ask(project, failed, finalizerIdentity("c"))],
    [
      "BindingMismatch",
      ask(project, wanted, finalizerIdentity("d"), "no-such-epoch"),
    ],
  ] as readonly (readonly [string, Promise<Record<string, unknown>>])[]) {
    assert.equal((await running)["result"], expected);
  }
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Working'
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  assert.equal(
    (await ask(project, wanted, finalizerIdentity("e")))["result"],
    "BindingMismatch",
    "the ticket left the phase",
  );
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Finalizing'
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  await rig.as(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  assert.equal(
    (await ask(project, wanted, finalizerIdentity("f")))["result"],
    "BindingMismatch",
    "the request settled",
  );
  assert.deepEqual(
    await rig.as(
      `SELECT count(*)::text AS opened FROM native_action
        WHERE tenant=$1 AND project=$2`,
      [project.partition.tenant, project.partition.project],
    ),
    [{ opened: "0" }],
  );
});

test("an escalation holding the ticket's one open slot is reported, not overwritten", async () => {
  const project = await finalizerProject(rig, "approve-escalated");
  await finalizerClaim(rig, project, finalizerIdentity("owner-escalated"));
  const attempt = await finalizerPrepare(rig, project, "approve-escalated", {
    approvalRequired: true,
  });
  const escalation = finalizerIdentity("action-escalation");
  await rig.harness.query(
    `INSERT INTO native_action
       (tenant, project, action, authorizing_seq, effect_position, ticket,
        action_version, kind, reason, required_capability)
     VALUES ($1,$2,$3,$4,7,$5,$4,'TicketEscalation','WorkFailed','ResolveTicket')`,
    [
      project.partition.tenant,
      project.partition.project,
      escalation,
      project.authorizingSeq,
      project.ticket,
    ],
  );
  assert.deepEqual(await ask(project, attempt, finalizerIdentity("g")), {
    result: "TicketHasAnOpenAction",
    action: escalation,
  });
  assert.deepEqual(
    await rig.as(
      `SELECT state FROM native_action WHERE tenant=$1 AND project=$2 AND action=$3`,
      [project.partition.tenant, project.partition.project, escalation],
    ),
    [{ state: "Open" }],
  );
});
