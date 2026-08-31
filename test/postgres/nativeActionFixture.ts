/**
 * One open desk task, seeded through the real chain, for the cases that need a
 * question standing without driving a ticket to the wall that raises one.
 *
 * IT IS SHARED RATHER THAN RESTATED because two suites now need it — the public
 * read's, and the discovery that turns an answer into a domain command — and two
 * copies of a seeding this long drift apart the first time the desk's rows gain
 * a column.
 *
 * NOTHING HERE ROUTES AROUND THE SERVER. The action's fence is a journal entry,
 * that entry decided an operation the real inbox accepted, and every row is
 * written through the ordinary tables — so a seed the server's own constraints
 * refuse is refused here too.
 *
 * THE SERVER HAS NO CONSTRAINT PAIRING AN ACTION'S KIND WITH ITS TICKET'S
 * PHASE, and that is the coherence a case leans on hardest: only the
 * `HandoffBlocked` arm of `nativeAction` raises a `HandoffBlock`, and the model
 * raises the hold and the phase in one decision. Deriving the phase from the
 * kind is not enough to keep that true, because a derivation can be edited and
 * nothing notices, so the pairing is read back off the committed rows and
 * refused here instead.
 */

import type { Phase, Reason } from "../../src/domain/generated/modelTypes.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { NativeActionResolution } from "../../src/interpreter/ticketCommand.ts";
import {
  postgresHarnessSubmission,
  type PostgresHarness,
  type PostgresTransaction,
} from "./harness.ts";

/** One desk task to seed, at the journal sequence its answer has to name. */
export interface SeededAction {
  readonly ticket: number;
  readonly sequence: number;
  readonly kind: "TicketEscalation" | "HandoffBlock";
  readonly reason: Reason;
  readonly offers: readonly NativeActionResolution[];
}

/** The phase a desk task of this kind stands on, and the only one the check below accepts. */
export function seededPhase(kind: SeededAction["kind"]): Phase {
  return kind === "HandoffBlock" ? "HandoffBlocked" : "Escalated";
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

/**
 * Settles the operation the inbox accepted and journals the entry that decided
 * it, which is the fence the action is raised at. The entry's body is empty
 * because no case here replays one.
 */
async function seededFence(
  seeding: PostgresTransaction,
  partition: Partition,
  label: string,
  sequence: number,
  operation: string,
  epoch: string,
): Promise<void> {
  await seeding.query(
    `UPDATE decision_input SET state='Journaled', decided_seq=$3, terminal_at=now()
      WHERE tenant=$1 AND project=$2 AND input_kind='Operation' AND input_id=$4`,
    [partition.tenant, partition.project, sequence, operation],
  );
  await seeding.query(
    `INSERT INTO journal_entry
       (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
        recovery_epoch,cause_kind,cause_id)
     VALUES ($1,$2,$3,'{}',$4,'genesis','owner',1,$5,'Operation',$6)`,
    [
      partition.tenant,
      partition.project,
      sequence,
      `digest-${label}`,
      epoch,
      operation,
    ],
  );
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
  await seededFence(
    seeding,
    partition,
    label,
    action.sequence,
    submission.operation,
    epoch,
  );
  await seeding.query(
    `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      partition.tenant,
      partition.project,
      action.ticket,
      seededPhase(action.kind),
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
  await seededPairing(harness, partition, label);
  return label;
}

/**
 * Refuses a committed action whose kind and whose ticket's phase are a pair the
 * desk cannot raise. It reads the rows back rather than the arguments, so the
 * derivation above is what is under the check and not what performs it.
 */
async function seededPairing(
  harness: PostgresHarness,
  partition: Partition,
  label: string,
): Promise<void> {
  const found = (await harness.query(
    `SELECT a.kind, t.phase FROM native_action a
       JOIN ticket_projection t USING (tenant, project, ticket)
      WHERE a.tenant=$1 AND a.project=$2 AND a.action=$3`,
    [partition.tenant, partition.project, label],
  )) as readonly { kind: string; phase: string }[];
  const row = found[0];
  if (found.length !== 1 || row === undefined)
    throw new Error(`native action fixture: ${label} stands on no one ticket`);
  if ((row.kind === "HandoffBlock") !== (row.phase === "HandoffBlocked"))
    throw new Error(
      `native action fixture: a ${row.kind} cannot stand on a ticket in ${row.phase}`,
    );
}
