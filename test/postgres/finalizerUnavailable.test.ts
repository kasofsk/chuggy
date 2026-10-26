/**
 * A finalization nothing can carry out, end to end against a real PostgreSQL:
 * the hold recorded pass after pass, the door that admits a result on that
 * record and nothing else, and the desk reading back which environment has to
 * change.
 *
 * THE CASES RUN AS `chuggy_finalizer` AND READ AS `chuggy_api`, because the
 * whole of 007 that matters at run time is who may write those three columns
 * and who may read them. A suite doing both as the migration owner would prove
 * the function parses.
 *
 * THE FENCE IS WHAT MAKES THE COUNT A COUNT. `record_finalization_hold` takes
 * the claim the caller holds, so a case hands the claim to a successor and
 * records again to show that the previous holder's generation buys nothing — a
 * count a lapsed finalizer could still add to would reach the dwell early and
 * park a ticket whose environment nobody had looked at twice.
 *
 * WHAT THE DESK READS IS THE REQUEST AND NOT THE EVENT. The journalled event
 * carries the outcome alone, so the assertions read the ticket through the
 * public read as the console does, rather than through the row the writer
 * wrote.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  finalizerDefaults,
  type FinalizationClaim,
  type GitPromotionPort,
} from "../../src/interpreter/finalizer.ts";
import {
  gitDeclineByProcReceive,
  gitDeclineWorkflowsReason,
} from "../adapters/gitDeclineFixtures.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  finalizerBriefBranch,
  finalizerClaim,
  finalizerDrain,
  finalizerExpireClaim,
  finalizerPassOnce,
  finalizerPhase,
  finalizerProject,
  finalizerQuiesce,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerSubject,
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

/** One finalizing project with every other request quiesced, and a claim on its own. */
async function heldSubject(
  label: string,
): Promise<{ project: FinalizerProject; claim: FinalizationClaim }> {
  const project = await finalizerProject(rig, label);
  await finalizerQuiesce(rig, project);
  return { project, claim: await finalizerClaim(rig, project, label) };
}

/** What the three columns of one request hold, read as the owner sees them. */
async function heldColumns(
  project: FinalizerProject,
): Promise<Record<string, unknown> | undefined> {
  const found = await rig.harness.query(
    `SELECT hold_kind, hold_passes, held_since IS NOT NULL AS held_dated
       FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  return found[0];
}

test("a hold recorded twice counts twice, and another kind starts the count over", async () => {
  const { project, claim } = await heldSubject("unavailable-count");
  const store = postgresFinalizer(rig.pool);
  assert.deepEqual(
    await store.recordHold({ claim, kind: "TargetUnreadable" }),
    {
      held: "Recorded",
      passes: 1,
    },
  );
  assert.deepEqual(
    await store.recordHold({ claim, kind: "TargetUnreadable" }),
    {
      held: "Recorded",
      passes: 2,
    },
  );
  assert.deepEqual(
    await store.recordHold({ claim, kind: "RepositoryUnbound" }),
    {
      held: "Recorded",
      passes: 1,
    },
  );
  assert.deepEqual(await heldColumns(project), {
    hold_kind: "RepositoryUnbound",
    hold_passes: 1,
    held_dated: true,
  });
  assert.deepEqual(await store.recordHold({ claim }), {
    held: "Recorded",
    passes: 0,
  });
  assert.deepEqual(await heldColumns(project), {
    hold_kind: null,
    hold_passes: 0,
    held_dated: false,
  });
});

test("a finalizer whose claim was reopened under it can no longer add to the count", async () => {
  const { project, claim } = await heldSubject("unavailable-fence");
  const store = postgresFinalizer(rig.pool);
  assert.deepEqual(await store.recordHold({ claim, kind: "ProposalDenied" }), {
    held: "Recorded",
    passes: 1,
  });
  await rig.as(
    `UPDATE finalization_request
        SET claim_owner=$4, claim_generation=claim_generation+1
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      "owner-unavailable-fence-successor",
    ],
  );
  assert.deepEqual(await store.recordHold({ claim, kind: "ProposalDenied" }), {
    held: "BindingMismatch",
  });
  assert.deepEqual(await heldColumns(project), {
    hold_kind: "ProposalDenied",
    hold_passes: 1,
    held_dated: true,
  });
});

test("the door admits the unavailable result at the recorded kind and at no other", async () => {
  const { claim } = await heldSubject("unavailable-door");
  const store = postgresFinalizer(rig.pool);
  await store.recordHold({ claim, kind: "ProposalAbsent" });
  assert.deepEqual(
    await store.submitResult({
      claim,
      conclusion: {
        outcome: "FinalizationResultUnavailable",
        kind: "TargetUnreadable",
      },
    }),
    { submitted: "BindingMismatch" },
  );
  const submitted = await store.submitResult({
    claim,
    conclusion: {
      outcome: "FinalizationResultUnavailable",
      kind: "ProposalAbsent",
    },
  });
  assert.equal(submitted.submitted, "Submitted");
});

test("a hold still being counted is not yet what the desk reads", async () => {
  const { project, claim } = await heldSubject("unavailable-counting");
  const store = postgresFinalizer(rig.pool);
  await store.recordHold({ claim, kind: "TargetUnreadable" });
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const read = await postgresNativeReads(asApi).ticket(
      project.partition,
      asTicketId(project.ticket),
    );
    assert.equal(read?.phase, "Finalization");
    assert.equal(read?.escalation, undefined);
  } finally {
    await asApi.end();
  }
});

test("the escalated ticket keeps the hold as the evidence the desk reads", async () => {
  const { project, claim } = await heldSubject("unavailable-desk");
  const store = postgresFinalizer(rig.pool);
  await store.recordHold({ claim, kind: "RepositoryUnbound" });
  const submitted = await store.submitResult({
    claim,
    conclusion: {
      outcome: "FinalizationResultUnavailable",
      kind: "RepositoryUnbound",
    },
  });
  assert.equal(submitted.submitted, "Submitted");
  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
  assert.equal(await finalizerPhase(rig, project.partition), "Escalated");
  assert.deepEqual(await heldColumns(project), {
    hold_kind: "RepositoryUnbound",
    hold_passes: 1,
    held_dated: true,
  });
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const read = await postgresNativeReads(asApi).ticket(
      project.partition,
      asTicketId(project.ticket),
    );
    assert.equal(read?.phase, "Escalated");
    assert.deepEqual(read?.escalation, {
      kind: "FinalizationUnavailableEscalated",
      evidence: "RepositoryUnbound",
      resumeAt: "ResumeFinalization",
    });
    await laterRequestHeldAt(project, "TargetUnreadable");
    const again = await postgresNativeReads(asApi).ticket(
      project.partition,
      asTicketId(project.ticket),
    );
    assert.deepEqual(again?.escalation, read?.escalation);
  } finally {
    await asApi.end();
  }
});

/**
 * The request a resume would mint after the first escalation, already settled
 * and holding its own kind. The desk keeps reading the kind the park recorded,
 * the evidence being what the submission said and not what a later row holds.
 */
async function laterRequestHeldAt(
  project: FinalizerProject,
  kind: string,
): Promise<void> {
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,
        ticket_version,request_generation,state,kind,
        hold_kind,hold_passes,held_since,work_cycle,finalization_generation)
     SELECT tenant,project,$3,max(seq),0,$4,max(seq),2,'Fulfilled','RunFinalizer',
            $5,1,now(),1,1
       FROM journal_entry WHERE tenant=$1 AND project=$2
      GROUP BY tenant,project`,
    [
      project.partition.tenant,
      project.partition.project,
      `${project.request}-resumed`,
      project.ticket,
      kind,
    ],
  );
}

/** What one project's finalization rows hold after a pass, read as the owner sees them. */
async function declinedRows(project: FinalizerProject): Promise<unknown> {
  const keys = [project.partition.tenant, project.partition.project];
  return {
    attempts: (
      await rig.harness.query(
        "SELECT count(*)::int AS made FROM finalization_attempt WHERE tenant=$1 AND project=$2",
        keys,
      )
    )[0]?.["made"],
    readings: await rig.harness.query(
      `SELECT r.verdict, r.observed_commit IS NULL AS unobserved, r.declined,
              p.state AS permit
         FROM finalization_reconciliation r
         JOIN commit_permit p USING (tenant, project, permit)
        WHERE tenant=$1 AND project=$2 ORDER BY r.reconciled_at, r.permit`,
      keys,
    ),
    request: (
      await rig.harness.query(
        `SELECT state, hold_kind FROM finalization_request
          WHERE tenant=$1 AND project=$2 AND request=$3`,
        [...keys, project.request],
      )
    )[0],
  };
}

/**
 * A push the receiving repository declines over a real remote is prepared and
 * pushed again until the restarts are spent: each reading keeps the decline,
 * the request then holds under its own kind rather than as restarts spent, and
 * after the dwell the ticket escalates with that kind as the evidence the desk
 * reads.
 */
test("a declined push is pushed again until its restarts are spent, held under its own kind, and escalates with it", async () => {
  const { project, remote } = await finalizerSubject(
    rig,
    "unavailable-declined",
    [{ path: "one.txt", content: "one\n" }],
  );
  declineByPreReceive(remote.origin);
  await declinedPasses(project, finalizerRemotePort(rig), "declined");
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  assert.deepEqual(await declinedRows(project), {
    attempts,
    readings: Array.from({ length: attempts }, () => ({
      verdict: "NotPromoted",
      unobserved: false,
      declined: "RemoteDeclined",
      permit: "Concluded",
    })),
    request: { state: "Registered", hold_kind: "PromotionDeclined" },
  });
  assert.equal(await escalationEvidence(project), "PromotionDeclined");
});

/** The evidence the desk reads off the escalated ticket, once what the finalizer submitted is drained. */
async function escalationEvidence(
  project: FinalizerProject,
): Promise<string | undefined> {
  await finalizerDrain(rig.harness, project.partition, project.memory);
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const escalation = (
      await postgresNativeReads(asApi).ticket(
        project.partition,
        asTicketId(project.ticket),
      )
    )?.escalation;
    assert.equal(escalation?.kind, "FinalizationUnavailableEscalated");
    assert.equal(escalation.resumeAt, "ResumeFinalization");
    return escalation.evidence;
  } finally {
    await asApi.end();
  }
}

/** The branch the cases about a decline onto an uncreated branch land on, which no fixture remote holds. */
const unheldBranch = "refs/heads/chuggy/unheld";

/** A project whose ticket lands on a branch its remote does not hold, or on the default where `unheld` is false, with the remote declining every push. */
async function declinedSubject(
  label: string,
  decline: (origin: string) => void,
  unheld = true,
): Promise<{ project: FinalizerProject; origin: string }> {
  const { project, remote } = await finalizerSubject(rig, label, [
    { path: "one.txt", content: "one\n" },
  ]);
  if (unheld) {
    await finalizerBriefBranch(
      rig,
      project.partition,
      project.ticket,
      unheldBranch,
    );
  }
  decline(remote.origin);
  return { project, origin: remote.origin };
}

/** A `pre-receive` hook that declines every push, the way a repository's own rule does. */
function declineByPreReceive(origin: string): void {
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o700);
}

/** Runs passes enough for every restart a decline may spend and the dwell after it. */
async function declinedPasses(
  project: FinalizerProject,
  port: GitPromotionPort,
  label: string,
): Promise<void> {
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  for (
    let pass = 0;
    pass < finalizerDefaults.holdPassesMax + 4 * attempts;
    pass += 1
  ) {
    await finalizerPassOnce(rig, project, port, `${label}-${String(pass)}`);
    await finalizerExpireClaim(rig, project);
  }
}

/** Whether the remote holds the ref, read off git rather than off what the finalizer recorded. */
function remoteHolds(origin: string, ref: string): boolean {
  return (
    spawnSync("git", ["-C", origin, "rev-parse", "--verify", "--quiet", ref])
      .status === 0
  );
}

/**
 * A decline onto a branch the remote does not hold leaves the ref absent, and
 * that is read as not promoted beside the decline: it is pushed again until
 * the restarts are spent and escalates under the same kind as a decline over a
 * branch that exists.
 */
test("a push declined onto a branch the remote does not hold is held and escalates as declined", async () => {
  const { project, origin } = await declinedSubject(
    "unavailable-unheld",
    declineByPreReceive,
  );
  await declinedPasses(project, finalizerRemotePort(rig), "unheld");
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  assert.deepEqual(await declinedRows(project), {
    attempts,
    readings: Array.from({ length: attempts }, () => ({
      verdict: "NotPromoted",
      unobserved: true,
      declined: "RemoteDeclined",
      permit: "Concluded",
    })),
    request: { state: "Registered", hold_kind: "PromotionDeclined" },
  });
  assert.equal(remoteHolds(origin, unheldBranch), false);
  assert.equal(await escalationEvidence(project), "PromotionDeclined");
});

/** A port whose first proof after each push cannot reach the remote, every later proof reading it. */
function unreadAfterPush(port: GitPromotionPort): GitPromotionPort {
  let pushed = false;
  return {
    ...port,
    promoteCandidate: async (promotion) => {
      const promoted = await port.promoteCandidate(promotion);
      pushed = true;
      return promoted;
    },
    proveCandidateAncestry: (proof) => {
      if (!pushed) return port.proveCandidateAncestry(proof);
      pushed = false;
      return Promise.resolve({
        proved: "Unreadable",
        evidence: "RemoteUnreachable",
      });
    },
  };
}

/** A `proc-receive` hook that declines every push the way GitHub refuses a workflow change. */
function declineAsWorkflows(origin: string): void {
  gitDeclineByProcReceive(origin, gitDeclineWorkflowsReason);
}

/**
 * A decline whose first proof cannot read the remote keeps the decline while
 * the reading is held, and the re-read concludes with it, over a branch the
 * remote does not hold and over one it does. A workflow refusal then holds on
 * its first attempt, and any other decline once its restarts are spent.
 */
test("a decline whose first proof is unreadable is held as declined, a workflow refusal on its first attempt", async () => {
  const restarted = finalizerDefaults.preparationRestartsMax + 1;
  for (const [label, decline, unheld, attempts, hold] of [
    [
      "unread-workflows",
      declineAsWorkflows,
      true,
      1,
      "PromotionWorkflowsRefused",
    ],
    [
      "unread-declined",
      declineByPreReceive,
      true,
      restarted,
      "PromotionDeclined",
    ],
    ["unread-held", declineAsWorkflows, false, 1, "PromotionWorkflowsRefused"],
  ] as const) {
    const { project, origin } = await declinedSubject(label, decline, unheld);
    await declinedPasses(
      project,
      unreadAfterPush(finalizerRemotePort(rig)),
      label,
    );
    const declined =
      hold === "PromotionWorkflowsRefused"
        ? "WorkflowsRefused"
        : "RemoteDeclined";
    assert.deepEqual(
      await declinedRows(project),
      {
        attempts,
        readings: Array.from({ length: attempts }, () => ({
          verdict: "NotPromoted",
          unobserved: unheld,
          declined,
          permit: "Concluded",
        })),
        request: { state: "Registered", hold_kind: hold },
      },
      label,
    );
    assert.equal(remoteHolds(origin, unheldBranch), false, label);
    assert.equal(await escalationEvidence(project), hold, label);
  }
});
