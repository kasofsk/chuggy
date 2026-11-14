/**
 * The claim rule against a real PostgreSQL: a Serialized ticket's finalization
 * is drawn only while its ticket holds its reference, and a request left behind
 * is left exactly as it was — still open, never claimed, never held.
 *
 * THE SECOND TICKET OF A PROJECT IS WRITTEN BY HAND. The harness drives one
 * ticket through the writer, and the rule is about two on one reference, so the
 * sibling's definition, projection and request are rows a case places directly;
 * what is under test is the claim, which reads those rows and no decision.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import {
  asFinalizerOwnerId,
  type FinalizationClaim,
  type FinalizerStore,
} from "../../src/interpreter/finalizer.ts";
import { type ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  finalizerAccept,
  finalizerBriefFinalizationTarget,
  finalizerBriefLanding,
  finalizerBriefProposal,
  finalizerCommit,
  finalizerDrain,
  finalizerEvaluation,
  finalizerExpireClaim,
  finalizerIdentity,
  finalizerPassOnce,
  finalizerPrepare,
  finalizerProject,
  finalizerMovingPort,
  finalizerRemoteCommit,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerSerializedSubject,
  finalizerSibling,
  finalizerSubject,
  finalizerTaskDone,
  type FinalizerProject,
  type FinalizerRig,
  type FinalizerSibling,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
let store: FinalizerStore;

before(async () => {
  rig = await finalizerRigOpen();
  store = postgresFinalizer(rig.pool);
});
after(async () => {
  await rig.close();
});

/** A second ticket beside `project`'s, written by hand. */
function sibling(
  project: FinalizerProject,
  label: string,
  how: FinalizerSibling,
): Promise<FinalizerProject> {
  return finalizerSibling(rig, project, label, how);
}

/** The requests of `projects` one draw returns, which is everything the installation has open. */
async function drawn(
  projects: readonly FinalizerProject[],
  label: string,
): Promise<readonly FinalizationClaim[]> {
  const claims = await store.claimRequests(
    asFinalizerOwnerId(finalizerIdentity(`owner-${label}`)),
    asRecoveryEpoch(projects[0]?.epoch ?? ""),
    1_000,
    60,
  );
  return claims.filter((claim) =>
    projects.some(
      (project) =>
        claim.partition.project === project.partition.project &&
        claim.request === project.request,
    ),
  );
}

/** Whether a draw returned the request of `project`. */
function includes(
  claims: readonly FinalizationClaim[],
  project: FinalizerProject,
): boolean {
  return claims.some((claim) => claim.request === project.request);
}

/** What a request row says about being held and being held up. */
async function untouched(project: FinalizerProject): Promise<boolean> {
  const [row] = await rig.harness.query(
    `SELECT state, claim_owner, claim_generation::text AS claim_generation,
            hold_kind, hold_passes
       FROM finalization_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [project.partition.tenant, project.partition.project, project.request],
  );
  return (
    row?.["state"] === "Open" &&
    row["claim_owner"] === null &&
    row["claim_generation"] === "0" &&
    row["hold_kind"] === null &&
    row["hold_passes"] === 0
  );
}

/** The phase the projection holds one ticket of `project`'s partition in. */
async function phaseOf(
  project: FinalizerProject,
  ticket: number,
): Promise<unknown> {
  const [row] = await rig.harness.query(
    `SELECT phase FROM ticket_projection WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, ticket],
  );
  return row?.["phase"];
}

/** A project whose real ticket is Serialized, entering first, after `reworks` evaluation reworks. */
async function serialized(
  label: string,
  reworks = 0,
): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label, undefined, reworks);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Serialized",
    project.repository,
  );
  return project;
}

test("a Serialized finalization waits for the holder and stays open, unheld and unclaimed", async () => {
  const first = await serialized("hold-first");
  const second = await sibling(first, "hold-second", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
  });
  const claims = await drawn([first, second], "hold");
  assert.equal(includes(claims, first), true);
  assert.equal(includes(claims, second), false);
  assert.equal(await untouched(second), true);
});

test("a Stacked finalization shares the queue of a Serialized one and waits for its holder alike", async () => {
  const first = await serialized("stacked-first");
  const second = await sibling(first, "stacked-second", {
    landing: "Stacked",
    phase: "Finalization",
    pending: true,
  });
  const claims = await drawn([first, second], "stacked");
  assert.equal(includes(claims, first), true);
  assert.equal(includes(claims, second), false);
  assert.equal(await untouched(second), true);
});

test("the waiting finalization is drawn once the holder leaves the path", async () => {
  for (const phase of ["Done", "Escalated", "Revoked"]) {
    const first = await serialized(`release-${phase}`);
    const second = await sibling(first, `release-${phase}-second`, {
      landing: "Serialized",
      phase: "Finalization",
      pending: true,
    });
    await rig.harness.query(
      `UPDATE ticket_projection SET phase=$4 WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [first.partition.tenant, first.partition.project, first.ticket, phase],
    );
    const claims = await drawn([second], `release-${phase}`);
    assert.equal(includes(claims, second), true, phase);
  }
});

test("a finalization that was drawn and is settled holds until its ticket leaves the path", async () => {
  const first = await serialized("settled-first");
  const second = await sibling(first, "settled-second", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
  });
  await rig.harness.query(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [first.partition.tenant, first.partition.project, first.request],
  );
  assert.equal(
    includes(await drawn([second], "settled"), second),
    false,
    "a settled request holds until its ticket has left the path",
  );
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Done' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [first.partition.tenant, first.partition.project, first.ticket],
  );
  assert.equal(includes(await drawn([second], "landed"), second), true);
});

test("a Direct finalization is drawn whatever is queued beside it", async () => {
  const first = await serialized("direct-first");
  const second = await sibling(first, "direct-second", {
    landing: "Direct",
    phase: "Finalization",
    pending: true,
  });
  const claims = await drawn([first, second], "direct");
  assert.equal(includes(claims, first), true);
  assert.equal(includes(claims, second), true);
});

test("two references are queued apart", async () => {
  const first = await serialized("targets-first");
  await finalizerBriefFinalizationTarget(
    rig,
    first.partition,
    first.ticket,
    "refs/heads/main",
  );
  const second = await sibling(first, "targets-second", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    target: "refs/heads/release",
  });
  const claims = await drawn([first, second], "targets");
  assert.equal(includes(claims, first), true);
  assert.equal(includes(claims, second), true);
});

/** A project whose real ticket is Serialized and merges a proposal from a branch of its own, into `target` or the default. */
async function proposing(
  label: string,
  target?: string,
): Promise<FinalizerProject> {
  const project = await serialized(label);
  await finalizerBriefProposal(
    rig,
    project.partition,
    project.ticket,
    `refs/heads/${label}`,
    target,
  );
  return project;
}

test("two proposals from their own branches into the default are one queue on it, the later waiting unclaimed", async () => {
  for (const landing of ["Serialized", "Stacked"] as const) {
    const first = await proposing(`proposal-first-${landing}`);
    const second = await sibling(first, `proposal-second-${landing}`, {
      landing,
      phase: "Finalization",
      pending: true,
      mode: "PullRequestMerge",
      branch: `refs/heads/proposal-second-${landing}`,
    });
    const claims = await drawn([first, second], `proposal-${landing}`);
    assert.equal(includes(claims, first), true, landing);
    assert.equal(includes(claims, second), false, landing);
    assert.equal(await untouched(second), true, landing);
  }
});

test("proposals into two bases are two queues, and a push and a proposal onto one named reference are one", async () => {
  const main = await proposing("bases-main", "refs/heads/main");
  const release = await sibling(main, "bases-release", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    mode: "PullRequestMerge",
    branch: "refs/heads/bases-release",
    target: "refs/heads/release",
  });
  const apart = await drawn([main, release], "bases");
  assert.equal(includes(apart, main), true);
  assert.equal(includes(apart, release), true);

  const push = await serialized("bases-push");
  await finalizerBriefFinalizationTarget(
    rig,
    push.partition,
    push.ticket,
    "refs/heads/main",
  );
  const proposal = await sibling(push, "bases-proposal", {
    landing: "Stacked",
    phase: "Finalization",
    pending: true,
    mode: "PullRequestMerge",
    branch: "refs/heads/bases-proposal",
    target: "refs/heads/main",
  });
  const together = await drawn([push, proposal], "bases-together");
  assert.equal(includes(together, push), true);
  assert.equal(includes(together, proposal), false);
  assert.equal(await untouched(proposal), true);
});

test("a proposal sent back to re-check holds its base through the re-check and its re-evaluation, ahead of a proposal from another branch", async () => {
  for (const phase of ["Work", "Evaluation"]) {
    const first = await proposing(`proposal-recheck-${phase}`);
    const rechecking = await sibling(
      first,
      `proposal-recheck-${phase}-flight`,
      {
        landing: "Stacked",
        phase,
        pending: false,
        after: -1,
        mode: "PullRequestMerge",
        branch: `refs/heads/proposal-recheck-${phase}-flight`,
      },
    );
    await finalizerPrepare(rig, rechecking, `proposal-recheck-${phase}`, {
      outcome: "Failed",
      failureKind: "RecheckRequired",
      recheckCommit: finalizerCommit(),
      targetRef: `refs/heads/proposal-recheck-${phase}-flight`,
    });
    assert.equal(
      includes(await drawn([first], `proposal-recheck-${phase}`), first),
      false,
      phase,
    );
    assert.equal(await untouched(first), true, phase);
  }
});

test("a re-check in flight holds the reference ahead of an earlier entry", async () => {
  const first = await serialized("recheck-first");
  const rechecking = await sibling(first, "recheck-flight", {
    landing: "Serialized",
    phase: "Work",
    pending: false,
    after: -1,
  });
  await finalizerPrepare(rig, rechecking, "recheck-flight", {
    outcome: "Failed",
    failureKind: "RecheckRequired",
    recheckCommit: finalizerCommit(),
  });
  assert.equal(
    includes(await drawn([first], "recheck-held"), first),
    false,
    "the re-check cycle holds the reference",
  );
  assert.equal(await untouched(first), true);
});

/** A `Restack` failure over one ticket ahead, at a commit of the harness's. */
function restacked(over: FinalizerProject) {
  const commit = finalizerCommit();
  return {
    outcome: "Failed" as const,
    failureKind: "Restack",
    recheckCommit: commit,
    restack: { tickets: [over.ticket], commits: [commit] },
  };
}

test("a re-stack in flight keeps its rank, and holds the reference ahead of a later entry as a re-check does", async () => {
  const first = await serialized("restack-first");
  const restacking = await sibling(first, "restack-flight", {
    landing: "Stacked",
    phase: "Work",
    pending: false,
    after: -1,
  });
  await finalizerPrepare(rig, restacking, "restack-flight", restacked(first));
  assert.equal(
    includes(await drawn([first], "restack-held"), first),
    false,
    "the re-stack cycle holds the reference",
  );
  assert.equal(await untouched(first), true);
});

test("a waiting finalization with a failed attempt is drawn, because all it can do is conclude", async () => {
  const first = await serialized("restack-drawn-first");
  const second = await sibling(first, "restack-drawn-second", {
    landing: "Stacked",
    phase: "Finalization",
    pending: true,
  });
  assert.equal(
    includes(await drawn([second], "restack-unattempted"), second),
    false,
  );
  await finalizerPrepare(rig, second, "restack-drawn", restacked(first));
  assert.equal(
    includes(await drawn([second], "restack-attempted"), second),
    true,
  );
});

test("a waiting finalization is claimed by its ticket alone while it is open, unheld and unattempted", async () => {
  const first = await serialized("restack-claim-first");
  const second = await sibling(first, "restack-claim-second", {
    landing: "Stacked",
    phase: "Finalization",
    pending: true,
  });
  const claim = (label: string, epoch = first.epoch) =>
    store.claimUnattempted(
      asFinalizerOwnerId(finalizerIdentity(`owner-${label}`)),
      asRecoveryEpoch(epoch),
      second.partition,
      asTicketId(second.ticket),
      60,
    );
  assert.equal(
    await claim("restack-claim-stale", "superseded-epoch"),
    undefined,
  );
  const claimed = await claim("restack-claim");
  assert.equal(claimed?.request, second.request);
  assert.equal(claimed?.state, "Registered");
  assert.equal(await claim("restack-claim-again"), undefined, "a held request");
  await rig.harness.query(
    `UPDATE finalization_request SET claim_owner=NULL, claim_expires_at=NULL, recovery_epoch=NULL,
            state='Open'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [second.partition.tenant, second.partition.project, second.request],
  );
  await finalizerPrepare(rig, second, "restack-claim", restacked(first));
  assert.equal(
    await claim("restack-claim-attempted"),
    undefined,
    "an attempted request",
  );
});

test("the holder is the lowest rank, whatever its ticket number or phase", async () => {
  const later = await serialized("rank-order");
  await finalizerPrepare(rig, later, "rank-order-later", {
    outcome: "Failed",
    failureKind: "RecheckRequired",
    recheckCommit: finalizerCommit(),
  });
  await rig.harness.query(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [later.partition.tenant, later.partition.project, later.request],
  );
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Work' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [later.partition.tenant, later.partition.project, later.ticket],
  );
  const earlier = await sibling(later, "rank-order-earlier", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    after: -1,
  });
  await finalizerPrepare(rig, earlier, "rank-order-earlier", {
    outcome: "Failed",
    failureKind: "RecheckRequired",
    recheckCommit: finalizerCommit(),
  });
  assert.equal(
    includes(await drawn([earlier], "rank-order"), earlier),
    true,
    "the lower rank holds although its ticket is the higher",
  );
});

test("a re-check cycle that leaves the path releases the reference", async () => {
  for (const phase of ["Escalated", "Revoked", "Done"]) {
    const first = await serialized(`leaves-${phase}`);
    const rechecking = await sibling(first, `leaves-${phase}-flight`, {
      landing: "Serialized",
      phase: "Evaluation",
      pending: false,
      after: -1,
    });
    await finalizerPrepare(rig, rechecking, `leaves-${phase}`, {
      outcome: "Failed",
      failureKind: "RecheckRequired",
      recheckCommit: finalizerCommit(),
    });
    await rig.harness.query(
      `UPDATE ticket_projection SET phase=$4 WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        rechecking.partition.tenant,
        rechecking.partition.project,
        rechecking.ticket,
        phase,
      ],
    );
    assert.equal(
      includes(await drawn([first], `leaves-${phase}`), first),
      true,
      phase,
    );
  }
});

test("a re-check whose evaluation fails releases the reference", async () => {
  const { project, remote } = await finalizerSerializedSubject(
    rig,
    "recheck-fails",
  );
  finalizerRemoteCommit(remote, "other.txt", "other\n", "other");
  const port = finalizerRemotePort(rig);
  await finalizerPassOnce(rig, project, port, "recheck-fails");
  await finalizerExpireClaim(rig, project);
  await finalizerPassOnce(rig, project, port, "recheck-fails-conclude");
  const sent = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(sent.decided, ["Committed"]);
  const waiting = await sibling(project, "recheck-fails-waiting", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
  });
  assert.equal(
    includes(await drawn([waiting], "recheck-fails-held"), waiting),
    false,
    "the re-check cycle holds the reference",
  );

  let memory = sent.memory;
  for (const [label, task, verdict] of [
    ["recheck-fails-work", workTaskIdentity(1, 2), "Pass"],
    ["recheck-fails-evaluation", finalizerEvaluation(2), "Fail"],
  ] as const) {
    assert.equal(
      await finalizerAccept(
        rig.harness,
        project.partition,
        label,
        finalizerTaskDone(memory.graph, task, verdict),
      ),
      "Accepted",
    );
    const drained = await finalizerDrain(
      rig.harness,
      project.partition,
      memory,
    );
    assert.ok(
      drained.decided.every((each) => each === "Committed"),
      label,
    );
    memory = drained.memory;
  }
  assert.equal(
    await phaseOf(project, project.ticket),
    "Work",
    "the failed evaluation sent the re-check back to rework, still on the path",
  );
  assert.equal(
    includes(await drawn([waiting], "recheck-fails-released"), waiting),
    true,
    "the rework released the reference",
  );
});

test("a rework before the re-check's request does not end the re-check", async () => {
  const first = await serialized("recheck-earlier-rework", 1);
  const waiting = await sibling(first, "recheck-earlier-waiting", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
  });
  await finalizerPrepare(rig, first, "recheck-earlier", {
    outcome: "Failed",
    failureKind: "RecheckRequired",
    recheckCommit: finalizerCommit(),
  });
  await rig.harness.query(
    `UPDATE finalization_request SET state='Fulfilled'
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [first.partition.tenant, first.partition.project, first.request],
  );
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Work' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [first.partition.tenant, first.partition.project, first.ticket],
  );
  assert.equal(
    includes(await drawn([waiting], "recheck-earlier"), waiting),
    false,
  );
  assert.equal(await untouched(waiting), true);
});

/** A Serialized ticket sent back to re-check because the target moved, with a sibling that entered after its first request waiting on the reference. */
async function rechecked(label: string): Promise<{
  project: FinalizerProject;
  waiting: FinalizerProject;
  memory: ProjectMemory;
}> {
  const { project, remote } = await finalizerSerializedSubject(rig, label);
  finalizerRemoteCommit(remote, "other.txt", "other\n", "other");
  const port = finalizerRemotePort(rig);
  await finalizerPassOnce(rig, project, port, label);
  await finalizerExpireClaim(rig, project);
  await finalizerPassOnce(rig, project, port, `${label}-conclude`);
  const sent = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(sent.decided, ["Committed"]);
  const waiting = await sibling(project, `${label}-waiting`, {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    after: 1,
  });
  return { project, waiting, memory: sent.memory };
}

/** Reports a re-checked ticket's work and then its evaluation, each as its verdict. */
async function reported(
  project: FinalizerProject,
  memory: ProjectMemory,
  label: string,
  evaluation: "Pass" | "Fail",
): Promise<void> {
  let carried = memory;
  for (const [step, task, verdict] of [
    ["work", workTaskIdentity(1, 2), "Pass"],
    ["evaluation", finalizerEvaluation(2), evaluation],
  ] as const) {
    assert.equal(
      await finalizerAccept(
        rig.harness,
        project.partition,
        `${label}-${step}`,
        finalizerTaskDone(carried.graph, task, verdict),
      ),
      "Accepted",
    );
    const drained = await finalizerDrain(
      rig.harness,
      project.partition,
      carried,
    );
    assert.ok(
      drained.decided.every((each) => each === "Committed"),
      step,
    );
    carried = drained.memory;
  }
}

test("a re-checked ticket keeps its place through its second request, ahead of one that entered between", async () => {
  const { project, waiting, memory } = await rechecked("rank-kept");
  await reported(project, memory, "rank-kept", "Pass");
  assert.equal(await phaseOf(project, project.ticket), "Finalization");
  const [again] = await rig.harness.query(
    `SELECT request, authorizing_seq::text AS seq FROM finalization_request
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  assert.ok(again !== undefined, "the evaluation left a second request");
  assert.ok(
    Number(again["seq"]) > waiting.authorizingSeq,
    "the second request entered after the waiting one",
  );
  const claims = await drawn(
    [{ ...project, request: String(again["request"]) }, waiting],
    "rank-kept",
  );
  assert.equal(
    claims.some((claim) => claim.request === again["request"]),
    true,
    "the re-checked ticket lands first",
  );
  assert.equal(includes(claims, waiting), false);
  assert.equal(await untouched(waiting), true);
});

test("a re-checked ticket whose evaluation fails loses its place", async () => {
  const { project, waiting, memory } = await rechecked("rank-lost");
  await reported(project, memory, "rank-lost", "Fail");
  assert.equal(await phaseOf(project, project.ticket), "Work");
  assert.equal(
    includes(await drawn([waiting], "rank-lost"), waiting),
    true,
    "the rework released the reference",
  );
});

test("a ticket sent back by a merge conflict loses its place", async () => {
  const { project, remote } = await finalizerSubject(rig, "rank-conflict", [
    { path: "base.txt", content: "candidate\n" },
  ]);
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Serialized",
    project.repository,
  );
  const port = finalizerMovingPort(finalizerRemotePort(rig), () => {
    finalizerRemoteCommit(remote, "base.txt", "moved\n", "moved");
  });
  await finalizerPassOnce(rig, project, port, "rank-conflict");
  await finalizerExpireClaim(rig, project);
  await finalizerPassOnce(rig, project, port, "rank-conflict-conclude");
  const sent = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(sent.decided, ["Committed"]);
  assert.equal(await phaseOf(project, project.ticket), "Work");
  const [attempt] = await rig.harness.query(
    `SELECT failure_kind FROM finalization_attempt WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(attempt?.["failure_kind"], "MergeConflict");
  const waiting = await sibling(project, "rank-conflict-waiting", {
    landing: "Serialized",
    phase: "Finalization",
    pending: true,
    after: 1,
  });
  assert.equal(
    includes(await drawn([waiting], "rank-conflict"), waiting),
    true,
    "the conflict released the reference",
  );
});
