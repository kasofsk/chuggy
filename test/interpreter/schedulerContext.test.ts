/**
 * The two narrow things the scheduler tells the rest of the installation: which
 * commands the authoritative guard is consulted for, and what the advisory
 * context does and does not carry out of a project.
 *
 * THE PROJECT BOUNDARY IS THE CLAIM WORTH TESTING. The advisory read is
 * permitted to cross it only as a safe aggregate, so the cases below put two
 * projects in one ledger and hold the answer to the named one's own counts and
 * the cluster totals.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { dispatchEvent, revokeEvent } from "../../src/actor/decisionEvent.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  CapacityExecution,
  Entitlement,
} from "../../src/interpreter/executionScheduler.ts";
import { asOperationDecisionEvent } from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  dispatchNeedsExecutionHeadroom,
  openExecutionBacklogGuard,
  selectorExecutionContext,
  type ExecutionContextRead,
} from "../../src/interpreter/schedulerContext.ts";
import type { TicketCommand } from "../../src/interpreter/ticketCommand.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("mine"),
};

const entitlements: ReadonlyMap<string, Entitlement> = new Map([
  ["mine", { reserved: 2, maximum: 4 }],
  ["theirs", { reserved: 1, maximum: 4 }],
]);

/** One registration of the named project, in the named status. */
function registration(
  project: string,
  task: number,
  status: CapacityExecution["status"],
): CapacityExecution {
  return {
    project,
    ticket: 1,
    task,
    account: project,
    sourceSeq: 1,
    sourceEffect: 0,
    status,
  };
}

/** A ledger holding both projects, which is what a cluster-wide read actually sees. */
const ledger: readonly CapacityExecution[] = [
  registration("mine", 1, "Queued"),
  registration("mine", 2, "Admitted"),
  registration("mine", 3, "Launching"),
  registration("mine", 4, "Running"),
  registration("mine", 5, "Terminal"),
  registration("theirs", 1, "Running"),
  registration("theirs", 2, "Running"),
];

test("the advisory context counts the named project's own work and no other's", () => {
  const context = selectorExecutionContext(
    8,
    entitlements,
    ledger,
    partition,
    "mine",
  );
  assert.deepEqual(context.activeWork, {
    partition,
    queued: 1,
    admitted: 1,
    launching: 1,
    running: 1,
  });
});

test("the advisory capacity is the cluster total and the project's own account", () => {
  const context = selectorExecutionContext(
    8,
    entitlements,
    ledger,
    partition,
    "mine",
  );
  assert.deepEqual(context.capacity, {
    clusterSlotsMax: 8,
    clusterActive: 5,
    accountMaximum: 4,
    accountActive: 3,
    accountReservationDeficit: 0,
  });
});

test("an account below its reservation reports the deficit a selector may weigh", () => {
  const context = selectorExecutionContext(
    8,
    entitlements,
    [registration("theirs", 1, "Running")],
    { tenant: partition.tenant, project: asProjectId("theirs") },
    "theirs",
  );
  assert.equal(context.capacity.accountReservationDeficit, 0);
  const idle = selectorExecutionContext(8, entitlements, [], partition, "mine");
  assert.equal(idle.capacity.accountReservationDeficit, 2);
});

test("the read answers for one project and reads no other", async () => {
  const read: ExecutionContextRead = {
    context: (asked) =>
      Promise.resolve(
        selectorExecutionContext(8, entitlements, ledger, asked, asked.project),
      ),
  };
  const mine = await read.context(partition);
  const theirs = await read.context({
    tenant: partition.tenant,
    project: asProjectId("theirs"),
  });
  assert.equal(mine.activeWork.partition.project, "mine");
  assert.equal(theirs.activeWork.running, 2);
  assert.equal(theirs.activeWork.queued, 0);
  assert.equal(mine.capacity.clusterActive, theirs.capacity.clusterActive);
});

test("an account no policy revision covers is refused rather than assumed", () => {
  assert.throws(
    () =>
      selectorExecutionContext(8, entitlements, ledger, partition, "absent"),
    /no entitlement in the current policy revision/u,
  );
});

/** One command of each shape the guard classifies. */
const dispatch: TicketCommand = {
  version: 1,
  command: "Decide",
  event: asOperationDecisionEvent(dispatchEvent(asTicketId(1))),
};

const resume: TicketCommand = {
  version: 1,
  command: "ResolveNativeAction",
  action: "action-one",
  authorizingSeq: 1,
  resolution: "Resume",
};

const release: TicketCommand = {
  version: 1,
  command: "ReleaseDraft",
  ticket: asTicketId(1),
  authoringVersion: 1,
  configurationRevision: "revision",
};

test("only a dispatch decision needs scheduler headroom", () => {
  assert.equal(dispatchNeedsExecutionHeadroom(dispatch), true);
  assert.equal(
    dispatchNeedsExecutionHeadroom({
      version: 1,
      command: "Decide",
      event: asOperationDecisionEvent(revokeEvent(asTicketId(1))),
    }),
    false,
  );
});

test("release and native-action resolution stay admissible while dispatch is paused", () => {
  assert.equal(dispatchNeedsExecutionHeadroom(release), false);
  assert.equal(dispatchNeedsExecutionHeadroom(resume), false);
  assert.equal(
    dispatchNeedsExecutionHeadroom({ ...resume, resolution: "Revoke" }),
    false,
  );
});

test("a deployment with no scheduler admits every dispatch", async () => {
  assert.deepEqual(await openExecutionBacklogGuard.admitsDispatch(partition), {
    admits: "Admits",
  });
});
