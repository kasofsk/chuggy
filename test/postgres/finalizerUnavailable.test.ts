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
} from "../../src/interpreter/finalizer.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
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
      `SELECT verdict, declined FROM finalization_reconciliation
        WHERE tenant=$1 AND project=$2`,
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
  const hook = join(remote.origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o700);
  const port = finalizerRemotePort(rig);
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  for (
    let pass = 0;
    pass < finalizerDefaults.holdPassesMax + 4 * attempts;
    pass += 1
  ) {
    await finalizerPassOnce(rig, project, port, `declined-${String(pass)}`);
    await finalizerExpireClaim(rig, project);
  }
  assert.deepEqual(await declinedRows(project), {
    attempts,
    readings: Array.from({ length: attempts }, () => ({
      verdict: "NotPromoted",
      declined: "RemoteDeclined",
    })),
    request: { state: "Registered", hold_kind: "PromotionDeclined" },
  });
  await finalizerDrain(rig.harness, project.partition, project.memory);
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    assert.deepEqual(
      (
        await postgresNativeReads(asApi).ticket(
          project.partition,
          asTicketId(project.ticket),
        )
      )?.escalation,
      {
        kind: "FinalizationUnavailableEscalated",
        evidence: "PromotionDeclined",
        resumeAt: "ResumeFinalization",
      },
    );
  } finally {
    await asApi.end();
  }
});
