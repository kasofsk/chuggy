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
import {
  asFinalizerOwnerId,
  type FinalizationClaim,
  type FinalizerStore,
} from "../../src/interpreter/finalizer.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  finalizerBriefFinalizationTarget,
  finalizerBriefLanding,
  finalizerCommit,
  finalizerIdentity,
  finalizerPrepare,
  finalizerProject,
  finalizerRigOpen,
  finalizerStoreReleasedBrief,
  type FinalizerProject,
  type FinalizerRig,
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

/** What a sibling ticket is written with. */
interface Sibling {
  readonly landing: "Direct" | "Serialized";
  readonly phase: string;
  /** Whether its finalization request is still to be drawn. */
  readonly pending: boolean;
  readonly target?: string;
}

/**
 * Writes a second ticket beside `project`'s, entering at the same journal entry and
 * so after it by ticket, and answers it as
 * a project so the attempt helpers can write beside it.
 */
async function sibling(
  project: FinalizerProject,
  label: string,
  how: Sibling,
): Promise<FinalizerProject> {
  const ticket = project.ticket + 1;
  const request = finalizerIdentity(`request-${label}`);
  const keys = [project.partition.tenant, project.partition.project, ticket];
  const found = await rig.harness.query(
    `SELECT brief FROM ticket_definition WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  const brief = found[0]?.["brief"] as Record<string, unknown> | undefined;
  assert.ok(brief !== undefined, "the project's ticket has no brief");
  const rest = Object.fromEntries(
    Object.entries(brief).filter(
      ([field]) => field !== "landing" && field !== "finalization",
    ),
  );
  await finalizerStoreReleasedBrief(
    (sql, values) => rig.harness.query(sql, [...values]),
    keys,
    {
      ...rest,
      repository: project.repository,
      ...(how.landing === "Direct" ? {} : { landing: how.landing }),
      ...(how.target === undefined
        ? {}
        : { finalization: { mode: "Push", target: how.target } }),
    },
  );
  await rig.harness.query(
    `INSERT INTO ticket_projection (tenant, project, ticket, phase, seq)
     VALUES ($1,$2,$3,$4,$5)`,
    [...keys, how.phase, project.authorizingSeq + 100],
  );
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation, kind, state, work_cycle,
        finalization_generation)
     VALUES ($1,$2,$3,$4,1,$5,$4,1,'RunFinalizer',$6,1,1)`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      project.authorizingSeq,
      ticket,
      how.pending ? "Open" : "Fulfilled",
    ],
  );
  return { ...project, ticket, request };
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

/** A project whose real ticket is Serialized, entering first. */
async function serialized(label: string): Promise<FinalizerProject> {
  const project = await finalizerProject(rig, label);
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

test("a finalization that was drawn and is settled holds nothing", async () => {
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
  assert.equal(includes(await drawn([second], "settled"), second), true);
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

test("a re-check in flight holds the reference ahead of an earlier entry, until it is sent back for another reason", async () => {
  const first = await serialized("recheck-first");
  const rechecking = await sibling(first, "recheck-flight", {
    landing: "Serialized",
    phase: "Work",
    pending: false,
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
  await finalizerPrepare(rig, rechecking, "recheck-conflict", {
    outcome: "Failed",
    failureKind: "MergeConflict",
  });
  assert.equal(
    includes(await drawn([first], "recheck-released"), first),
    true,
    "a conflict send-back releases it",
  );
});

test("a re-check cycle that leaves the path releases the reference", async () => {
  for (const phase of ["Escalated", "Revoked", "Done"]) {
    const first = await serialized(`leaves-${phase}`);
    const rechecking = await sibling(first, `leaves-${phase}-flight`, {
      landing: "Serialized",
      phase: "Evaluation",
      pending: false,
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
