/**
 * One open desk task, seeded through the real chain, for the cases that need a
 * question standing without driving a ticket to the wall that raises one.
 *
 * IT IS SHARED RATHER THAN RESTATED because two suites now need it — the public
 * read's, and the discovery that turns an answer into a domain command — and two
 * copies of a seeding this long drift apart the first time the desk's rows gain
 * a column.
 *
 * NOTHING HOLDS HERE BECAUSE A CONSTRAINT WAS SKIPPED. The action's fence is a
 * journal entry, and that entry decided an operation the real inbox accepted, so
 * a seed that the durable authority would refuse is refused here too.
 */

import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { NativeActionResolution } from "../../src/interpreter/ticketCommand.ts";
import { postgresHarnessSubmission, type PostgresHarness } from "./harness.ts";

/** One desk task to seed, at the journal sequence its answer has to name. */
export interface SeededAction {
  readonly ticket: number;
  readonly sequence: number;
  readonly kind: "TicketEscalation" | "HandoffBlock";
  readonly reason: string;
  readonly offers: readonly NativeActionResolution[];
}

async function seededEpoch(harness: PostgresHarness): Promise<string> {
  const found = await harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  );
  const epoch = found[0]?.["epoch"];
  if (typeof epoch !== "string")
    throw new Error("native action fixture: the harness established no epoch");
  return epoch;
}

/** Seeds one open action and answers the identity a case answers it at. */
export async function seedOpenAction(
  harness: PostgresHarness,
  partition: Partition,
  label: string,
  action: SeededAction,
): Promise<string> {
  const submission = postgresHarnessSubmission(partition, label);
  await harness.inbox.accept(submission);
  const epoch = await seededEpoch(harness);
  const seeding = await harness.begin();
  await seeding.query(
    `UPDATE decision_input SET state='Journaled', decided_seq=$3, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$4`,
    [
      partition.tenant,
      partition.project,
      action.sequence,
      submission.operation,
    ],
  );
  await seeding.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES ($1,$2,$3,'{}',$4,'genesis','owner',1,$5,'Operation',$6)`,
    [
      partition.tenant,
      partition.project,
      action.sequence,
      `digest-${label}`,
      epoch,
      submission.operation,
    ],
  );
  await seeding.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      partition.tenant,
      partition.project,
      action.ticket,
      action.kind === "HandoffBlock" ? "HandoffBlocked" : "Escalated",
      action.sequence,
      action.reason,
    ],
  );
  await seeding.query(
    `INSERT INTO native_action
       (tenant,project,action,authorizing_seq,effect_position,ticket,
        action_version,kind,reason,required_capability)
     VALUES ($1,$2,$3,$4,0,$5,$4,$6,$7,'ResolveTicket')`,
    [
      partition.tenant,
      partition.project,
      label,
      action.sequence,
      action.ticket,
      action.kind,
      action.reason,
    ],
  );
  for (const offered of action.offers)
    await seeding.query(
      `INSERT INTO native_action_resolution (tenant,project,action,resolution)
       VALUES ($1,$2,$3,$4)`,
      [partition.tenant, partition.project, label, offered],
    );
  await seeding.commit();
  return label;
}
