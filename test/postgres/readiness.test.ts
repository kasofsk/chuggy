import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  taskDoneEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  allNativeActionResolutions,
  isApprovalResolution,
  nativeActionResolutions,
  type ApprovalResolution,
  type NativeActionResolution,
} from "../../src/interpreter/ticketCommand.ts";
import { id } from "../domain/fixtures.ts";
import { plainResult } from "../actor/harness.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessCompletion,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";
import { seedOpenAction, type SeededAction } from "./nativeActionFixture.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

/** One settled task, written the way its boundary writes it rather than offered. */
async function completion(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
  label: string,
): Promise<string> {
  const operation = `operation-${label}`;
  await postgresHarnessCompletion(
    harness,
    partition,
    operation,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
  );
  return operation;
}

test("the bounded class-head query chooses completion before ordinary", async () => {
  const partition = await postgresHarnessProject(harness.store, "priority");
  const ordinary = postgresHarnessSubmission(partition, "priority-ordinary");
  await harness.inbox.accept(ordinary);
  const done = await completion(partition, "priority-completion");
  const next = await harness.discovery.next(partition, 300);
  assert.equal(next?.source.kind, "Operation");
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    done,
  );
});

test("database-time aging eventually puts old ordinary work ahead", async () => {
  const partition = await postgresHarnessProject(harness.store, "aging");
  const ordinary = postgresHarnessSubmission(partition, "aging-ordinary");
  await harness.inbox.accept(ordinary);
  await completion(partition, "aging-completion");
  await harness.query(
    `UPDATE decision_input SET created_at=created_at-interval '20 minutes'
      WHERE tenant=$1 AND project=$2 AND input_id=$3`,
    [partition.tenant, partition.project, ordinary.operation],
  );
  const next = await harness.discovery.next(partition, 300);
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    ordinary.operation,
  );
});

test("readiness clears only when no pending input remains", async () => {
  const partition = await postgresHarnessProject(harness.store, "ready-clear");
  const submission = postgresHarnessSubmission(partition, "ready-clear");
  await harness.inbox.accept(submission);
  const readiness = (await harness.discovery.ready(100)).find(
    (item) => item.partition.project === partition.project,
  );
  assert.ok(readiness !== undefined);
  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "WorkRemains",
  });
});

/**
 * The event each answer becomes, keyed by the exact union the mapping covers,
 * so a resolution added to the roster is a compile error here as well as at the
 * mapping. The approvals name no domain command and this type excludes them.
 */
const resolutionEvents: Record<
  Exclude<NativeActionResolution, ApprovalResolution>,
  DecisionEvent["type"]
> = {
  Resume: "ResumeTicket",
  RetryHandoff: "ResumeTicket",
  Revoke: "Revoke",
  AbandonHandoff: "AbandonHandoff",
};

/** Which desk task asks for one answer, read off the contract's own pairing. */
function resolutionKind(
  resolution: NativeActionResolution,
): SeededAction["kind"] {
  const asking = (["TicketEscalation", "HandoffBlock"] as const).find((kind) =>
    nativeActionResolutions[kind].some((each) => each === resolution),
  );
  if (asking === undefined)
    throw new Error(`readiness case: no desk task asks for ${resolution}`);
  return asking;
}

/** The event discovery resolved an accepted answer into, from the one consumable item. */
async function resolvedAnswer(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
): Promise<DecisionEvent | undefined> {
  const item = await harness.discovery.next(partition, 300);
  if (item === undefined || item.source.kind !== "Operation")
    throw new Error("readiness case: the answer was not discoverable");
  return item.source.resolvedEvent;
}

test("every answer a desk task admits becomes the domain command it names", async () => {
  const answerable = allNativeActionResolutions.filter(
    (
      resolution,
    ): resolution is Exclude<NativeActionResolution, ApprovalResolution> =>
      !isApprovalResolution(resolution),
  );
  assert.deepEqual(
    [...answerable].sort(),
    Object.keys(resolutionEvents).sort(),
    "the roster's answerable resolutions are not the ones this case pins",
  );
  for (const resolution of answerable) {
    const label = `resolution-${resolution}`;
    const partition = await postgresHarnessProject(harness.store, label);
    const action = `${label}-action`;
    const kind = resolutionKind(resolution);
    await seedOpenAction(harness, partition, action, {
      ticket: 1,
      sequence: 1,
      kind,
      reason: kind === "HandoffBlock" ? "NoReason" : "WorkFailed",
      offers: [resolution],
    });
    const accepted = await harness.inbox.accept({
      ...postgresHarnessSubmission(partition, label),
      command: {
        version: 1,
        command: "ResolveNativeAction",
        action,
        authorizingSeq: 1,
        resolution,
      },
    });
    assert.equal(accepted.accepted, "Accepted", resolution);
    assert.deepEqual(
      await resolvedAnswer(partition),
      { type: resolutionEvents[resolution], value: 1 },
      resolution,
    );
  }
});
