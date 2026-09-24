/**
 * A dispatch whose source a remote keeps answering transiently: each pass
 * defers it and counts, and the pass that finds the count spent refuses it, so
 * the operation is answered and the project's queue moves on.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { sourceDeferralPassesMax } from "../../src/interpreter/ticketService.ts";
import { asOperationTicketCommand } from "../../src/interpreter/operationInbox.ts";
import { revokeTicketCommand } from "../../src/actor/command.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessDecisionSubmission,
  postgresHarnessHistory,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

/** A released ticket with its dispatch accepted and not yet decided. */
async function dispatchWaiting(
  label: string,
): Promise<{ partition: Partition; memory: ProjectMemory; operation: string }> {
  const partition = await postgresHarnessProject(harness.store, label);
  const memory = await postgresHarnessHistory(harness, partition, label, 1);
  const dispatch = postgresHarnessDecisionSubmission(
    partition,
    `${label}-dispatch`,
    1,
  );
  assert.equal((await harness.inbox.accept(dispatch)).accepted, "Accepted");
  return { partition, memory, operation: dispatch.operation };
}

/** More passes than the bound allows, so a writer with no bound is seen never to answer. */
const passesMax = sourceDeferralPassesMax + 2;

test("a remote that stays transient is refused once its deferrals are spent, and journals nothing", async () => {
  const { partition, memory, operation } = await dispatchWaiting("transient");
  const writer = {
    ...postgresHarnessWriter(harness),
    executionSources: {
      observe: () =>
        Promise.resolve({
          observed: "Unreadable" as const,
          evidence: "RemoteUnreachable" as const,
        }),
      spawnSource: () => Promise.resolve(undefined),
    },
  };
  const decided: string[] = [];
  for (let pass = 0; pass < passesMax; pass++) {
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined) break;
    decided.push(
      (await projectWriterDecide(writer, memory, input)).decided.decided,
    );
  }
  assert.deepEqual(decided, [
    ...Array.from({ length: sourceDeferralPassesMax }, () => "Deferred"),
    "Refused",
  ]);
  const settled = await harness.query(
    `SELECT state, outcome_code, deferred_passes
       FROM decision_input WHERE tenant=$1 AND project=$2 AND input_id=$3`,
    [partition.tenant, partition.project, operation],
  );
  assert.deepEqual(settled, [
    {
      state: "Refused",
      outcome_code: "ExecutionSourceUnreadable",
      deferred_passes: sourceDeferralPassesMax,
    },
  ]);
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS entries FROM journal_entry WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ entries: "1" }],
  );
});

/**
 * Aged past every class, an ordinary input outranks a fresh safety one; spent,
 * it does not, because the writer would only refuse it.
 */
test("an input whose deferrals are spent is not promoted by age", async () => {
  for (const [passes, first] of [
    [0, "Ordinary"],
    [sourceDeferralPassesMax, "Safety"],
  ] as const) {
    const { partition, operation } = await dispatchWaiting(
      `aged-${String(passes)}`,
    );
    await harness.query(
      `UPDATE decision_input SET created_at = now() - interval '1 day', deferred_passes=$4
        WHERE tenant=$1 AND project=$2 AND input_id=$3`,
      [partition.tenant, partition.project, operation, passes],
    );
    const safety = postgresHarnessSubmission(
      partition,
      `aged-safety-${String(passes)}`,
    );
    assert.equal(
      (
        await harness.inbox.accept({
          ...safety,
          command: {
            version: 1,
            command: "Decide",
            ticketCommand: asOperationTicketCommand(revokeTicketCommand(id(1))),
          },
        })
      ).accepted,
      "Accepted",
    );
    const next = await harness.discovery.next(partition, 300);
    assert.equal(next?.priority, first, `deferred ${String(passes)} times`);
  }
});
