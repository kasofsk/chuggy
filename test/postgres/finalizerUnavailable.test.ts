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
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asFinalizerOwnerId,
  finalizerDefaults,
  type FinalizationClaim,
  type GitPromotionPort,
} from "../../src/interpreter/finalizer.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  gitDeclineByProcReceive,
  gitDeclineWorkflowsReason,
} from "../adapters/gitDeclineFixtures.ts";
import { postgresHarnessResume, postgresHarnessRolePool } from "./harness.ts";
import {
  finalizerBriefBranch,
  finalizerClaim,
  finalizerDrain,
  finalizerExpireClaim,
  finalizerGitVerb,
  finalizerPassOnce,
  finalizerPhase,
  finalizerProject,
  finalizerQuiesce,
  finalizerRacingPort,
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
async function landingRows(project: FinalizerProject): Promise<unknown> {
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
  await dwellPasses(project, finalizerRemotePort(rig), "declined");
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  assert.deepEqual(await landingRows(project), {
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
  return escalationRead(project);
}

/** The evidence the desk reads off the escalated ticket, read as the console reads it. */
async function escalationRead(
  project: FinalizerProject,
): Promise<string | undefined> {
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

/** The branch the cases about a push onto an uncreated branch land on, which no fixture remote holds. */
const unheldBranch = "refs/heads/chuggy/unheld";

/** A project whose ticket lands on a branch its remote does not hold, or on the default where `unheld` is false, with a hook on the remote meeting every push. */
async function hookedSubject(
  label: string,
  hook: (origin: string) => void,
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
  hook(remote.origin);
  return { project, origin: remote.origin };
}

/** A `pre-receive` hook that declines every push, the way a repository's own rule does. */
function declineByPreReceive(origin: string): void {
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o700);
}

/** Runs passes enough for every restart a finalization may spend and the dwell after it. */
async function dwellPasses(
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
  const { project, origin } = await hookedSubject(
    "unavailable-unheld",
    declineByPreReceive,
  );
  await dwellPasses(project, finalizerRemotePort(rig), "unheld");
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  assert.deepEqual(await landingRows(project), {
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
    const { project, origin } = await hookedSubject(label, decline, unheld);
    await dwellPasses(
      project,
      unreadAfterPush(finalizerRemotePort(rig)),
      label,
    );
    const declined =
      hold === "PromotionWorkflowsRefused"
        ? "WorkflowsRefused"
        : "RemoteDeclined";
    assert.deepEqual(
      await landingRows(project),
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

/** A `pre-receive` hook that outlasts the bound a case pushes under, so the push is abandoned with nobody told whether it landed. */
function undecideByPreReceive(origin: string): void {
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nsleep 30\n");
  chmodSync(hook, 0o700);
}

/** The bound a case abandons its push at, well inside the hook that outlasts it. */
const undecidedPushSecs = 1;

/**
 * A push nobody heard the fate of, onto a branch the remote did not hold at
 * preparation and still does not, is read as not promoted with nothing
 * observed, on its first reading or on the re-read of one that could not reach
 * the remote: it is prepared again until the restarts are spent, and escalates
 * as restarts spent.
 */
test("an undecided push onto a branch nobody created is prepared again until its restarts are spent, and escalates as spent", async () => {
  const attempts = finalizerDefaults.preparationRestartsMax + 1;
  for (const [label, port] of [
    ["undecided-unheld", (each: GitPromotionPort) => each],
    ["undecided-reread", unreadAfterPush],
  ] as const) {
    const { project, origin } = await hookedSubject(
      label,
      undecideByPreReceive,
    );
    await dwellPasses(
      project,
      port(finalizerRemotePort(rig, undecidedPushSecs)),
      label,
    );
    assert.deepEqual(
      await landingRows(project),
      {
        attempts,
        readings: Array.from({ length: attempts }, () => ({
          verdict: "NotPromoted",
          unobserved: true,
          declined: null,
          permit: "Concluded",
        })),
        request: {
          state: "Registered",
          hold_kind: "PreparationRestartsExhausted",
        },
      },
      label,
    );
    assert.equal(remoteHolds(origin, unheldBranch), false, label);
    assert.equal(
      await escalationEvidence(project),
      "PreparationRestartsExhausted",
      label,
    );
  }
});

/** A port that dies once its first push has answered, before the pass records anything the push said. */
function diesAfterFirstPush(port: GitPromotionPort): GitPromotionPort {
  let died = false;
  return {
    ...port,
    promoteCandidate: async (promotion) => {
      const promoted = await port.promoteCandidate(promotion);
      if (died) return promoted;
      died = true;
      throw new Error("the finalizer died before recording its push");
    },
  };
}

/**
 * A finalizer that dies between a push onto a branch nobody created and its
 * first reading leaves a granted permit and no reading. The next holder reads
 * the branch still absent as not promoted, prepares again, and lands.
 */
test("a push onto a branch nobody created that the finalizer died before reading is prepared again and lands", async () => {
  const { project, origin } = await hookedSubject(
    "undecided-crash",
    declineByPreReceive,
  );
  const port = diesAfterFirstPush(finalizerRemotePort(rig));
  let died = false;
  for (let pass = 0; !died && pass < 8; pass += 1) {
    await finalizerPassOnce(rig, project, port, `crash-${String(pass)}`).catch(
      (error: unknown) => {
        assert.match(String(error), /died before recording its push/u);
        died = true;
      },
    );
    await finalizerExpireClaim(rig, project);
  }
  assert.ok(died, "the pass that pushed died");
  assert.equal(remoteHolds(origin, unheldBranch), false);
  rmSync(join(origin, "hooks", "pre-receive"));
  await dwellPasses(project, port, "undecided-crash");
  assert.deepEqual(await landingRows(project), {
    attempts: 2,
    readings: [
      {
        verdict: "NotPromoted",
        unobserved: true,
        declined: null,
        permit: "Concluded",
      },
      {
        verdict: "Promoted",
        unobserved: false,
        declined: null,
        permit: "Concluded",
      },
    ],
    request: { state: "Registered", hold_kind: null },
  });
  assert.equal(
    finalizerGitVerb(origin, "show", `${unheldBranch}:one.txt`),
    "one",
  );
  await finalizerDrain(rig.harness, project.partition, project.memory);
  assert.equal(await finalizerPhase(rig, project.partition), "Done");
});

/** The branch the cases about a deleted target land on, which the remote holds when the attempt is prepared. */
const heldBranch = "refs/heads/chuggy/held";

/** A project whose ticket lands on a branch its remote holds at the commit `main` holds. */
async function heldBranchSubject(
  label: string,
): Promise<{ project: FinalizerProject; origin: string }> {
  const { project, remote } = await finalizerSubject(rig, label, [
    { path: "one.txt", content: "one\n" },
  ]);
  finalizerGitVerb(remote.origin, "update-ref", heldBranch, "refs/heads/main");
  await finalizerBriefBranch(
    rig,
    project.partition,
    project.ticket,
    heldBranch,
  );
  return { project, origin: remote.origin };
}

/** A port under which somebody deletes the held branch just before each push, which the hook then outlasts. */
function deletedBeforePush(origin: string): GitPromotionPort {
  return finalizerRacingPort(
    finalizerRemotePort(rig, undecidedPushSecs),
    () => {
      finalizerGitVerb(origin, "update-ref", "-d", heldBranch);
      undecideByPreReceive(origin);
    },
  );
}

/**
 * A push nobody heard the fate of onto a branch the remote held at
 * preparation, and that somebody then deleted, cannot be told from one that
 * landed and was deleted after: the reading is held unread and escalates so.
 */
test("an undecided push onto a branch deleted after preparation is held unread and escalates so", async () => {
  const { project, origin } = await heldBranchSubject("undecided-deleted");
  await dwellPasses(project, deletedBeforePush(origin), "undecided-deleted");
  assert.deepEqual(await landingRows(project), {
    attempts: 1,
    readings: [
      {
        verdict: "Unreadable",
        unobserved: true,
        declined: null,
        permit: "Granted",
      },
    ],
    request: { state: "Registered", hold_kind: "ReconciliationUnreadable" },
  });
  assert.equal(remoteHolds(origin, heldBranch), false);
  assert.equal(await escalationEvidence(project), "ReconciliationUnreadable");
  const [held] = (await rig.harness.query(
    `SELECT permit FROM commit_permit
      WHERE tenant=$1 AND project=$2 AND state='Granted'`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { permit: string }[];
  assert.ok(held !== undefined);
  assert.equal(
    await heldPermitBeside(project, project.ticket, "resumed"),
    held.permit,
  );
  assert.equal(
    await heldPermitBeside(project, project.ticket + 1, "sibling"),
    undefined,
    "another ticket's request is not held under this ticket's reading",
  );
});

/**
 * The permit a later request for `ticket` is gathered beside, which is an
 * earlier request's of the same ticket still held unread. The request is
 * minted after the project's latest decision and read before any pass claims it.
 */
async function heldPermitBeside(
  project: FinalizerProject,
  ticket: number,
  label: string,
): Promise<string | undefined> {
  const request = `${project.request}-${label}`;
  const minted = (await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,
        ticket_version,request_generation,kind,work_cycle,finalization_generation)
     SELECT tenant,project,$3,max(seq),$5,$4,max(seq),1,'RunFinalizer',1,1
       FROM journal_entry WHERE tenant=$1 AND project=$2
      GROUP BY tenant,project
     RETURNING authorizing_seq::int AS seq`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      ticket,
      ticket - project.ticket + 1,
    ],
  )) as readonly { seq: number }[];
  const view = await postgresFinalizer(rig.pool).durableView({
    partition: project.partition,
    request,
    ticket: asTicketId(ticket),
    authorizingSeq: minted[0]?.seq ?? 0,
    requestGeneration: 1,
    claimGeneration: 0,
    state: "Open",
    kind: "RunFinalizer",
    recoveryEpoch: asRecoveryEpoch(project.epoch),
    owner: asFinalizerOwnerId(`owner-${label}`),
  });
  return view?.heldPermit;
}

/**
 * A resume pressed while the deleted branch is still gone is held under the
 * earlier request's unread reading and escalates again, rather than waiting on
 * a permit it is refused. Once the branch is restored the reading concludes,
 * and a resume then lands the ticket.
 */
test("a resume while a deleted branch is still gone escalates again as unreadable, and one after it is restored lands", async () => {
  const { project, origin } = await heldBranchSubject("resume-deleted");
  await dwellPasses(project, deletedBeforePush(origin), "resume-deleted");
  let { memory } = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.equal(await escalationRead(project), "ReconciliationUnreadable");
  const resumed = async (label: string): Promise<void> => {
    assert.equal(
      await postgresHarnessResume(
        rig.harness,
        project.partition,
        project.ticket,
        label,
      ),
      "Accepted",
    );
    ({ memory } = await finalizerDrain(rig.harness, project.partition, memory));
    assert.equal(await finalizerPhase(rig, project.partition), "Finalization");
    await dwellPasses(project, finalizerRemotePort(rig), label);
    ({ memory } = await finalizerDrain(rig.harness, project.partition, memory));
  };
  await resumed("resume-early");
  assert.equal(await finalizerPhase(rig, project.partition), "Escalated");
  assert.equal(await escalationRead(project), "ReconciliationUnreadable");
  assert.equal(
    ((await landingRows(project)) as { attempts: number }).attempts,
    1,
    "nothing was prepared beside the unread reading",
  );
  finalizerGitVerb(origin, "update-ref", heldBranch, "refs/heads/main");
  rmSync(join(origin, "hooks", "pre-receive"));
  await resumed("resume-restored");
  assert.equal(await finalizerPhase(rig, project.partition), "Done");
  assert.equal(
    finalizerGitVerb(origin, "show", `${heldBranch}:one.txt`),
    "one",
  );
});
