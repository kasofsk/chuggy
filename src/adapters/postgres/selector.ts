import type pg from "pg";

import { asOperationId } from "../../interpreter/operationInbox.ts";
import type {
  SelectorDelivery,
  SelectorInteraction,
  SelectorProposal,
  SelectorProjectState,
  SelectorStateStore,
  StoredSelectorInteraction,
} from "../../interpreter/selector.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { parseTicketCommand } from "../../interpreter/wire.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";

interface DeliveryRow {
  readonly selector_decision: string;
  readonly tenant: string;
  readonly project: string;
  readonly operation: string;
  readonly command: string;
  readonly attempts: string;
}

function deliveryOf(row: DeliveryRow): SelectorDelivery {
  const parsed = parseTicketCommand(row.command);
  if (parsed.parsed === "Refused" || parsed.value.command !== "ProposeDispatch")
    throw new Error("selector delivery contains an unreadable proposal");
  return {
    decision: row.selector_decision,
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    operation: asOperationId(row.operation),
    command: parsed.value,
    attempts: Number(row.attempts),
  };
}

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function checkedSelectorLimit(limit: number, what: string): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError(`${what} limit must be between 1 and 100`);
  return limit;
}

async function readSelectorProject(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorProjectState | undefined> {
  const found = await pool.query<{
    notification_cursor: string;
    recovery_epoch: string | null;
    attention: SelectorProjectState["attention"];
  }>(
    `SELECT notification_cursor::text,recovery_epoch,attention
       FROM selector_project_state WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        partition,
        notificationCursor: Number(row.notification_cursor),
        ...(row.recovery_epoch === null
          ? {}
          : { recoveryEpoch: row.recovery_epoch }),
        attention: row.attention,
      };
}

async function writeSelectorProject(
  pool: pg.Pool | pg.PoolClient,
  state: SelectorProjectState,
): Promise<void> {
  await pool.query(
    `INSERT INTO selector_project_state
     (tenant,project,notification_cursor,recovery_epoch,attention)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant,project) DO UPDATE SET
     notification_cursor=EXCLUDED.notification_cursor,recovery_epoch=EXCLUDED.recovery_epoch,
     attention=EXCLUDED.attention,updated_at=now()`,
    [
      state.partition.tenant,
      state.partition.project,
      state.notificationCursor,
      state.recoveryEpoch ?? null,
      state.attention,
    ],
  );
}

function sameSelectorState(
  left: SelectorProjectState,
  right: SelectorProjectState,
): boolean {
  return (
    left.partition.tenant === right.partition.tenant &&
    left.partition.project === right.partition.project &&
    left.notificationCursor === right.notificationCursor &&
    left.recoveryEpoch === right.recoveryEpoch &&
    left.attention === right.attention
  );
}

async function lockSelectorProject(
  client: pg.PoolClient,
  expected: SelectorProjectState,
): Promise<boolean> {
  const found = await client.query<{
    notification_cursor: string;
    recovery_epoch: string | null;
    attention: SelectorProjectState["attention"];
  }>(
    `SELECT notification_cursor::text,recovery_epoch,attention
       FROM selector_project_state WHERE tenant=$1 AND project=$2 FOR UPDATE`,
    [expected.partition.tenant, expected.partition.project],
  );
  const row = found.rows[0];
  if (row === undefined)
    return (
      expected.notificationCursor === 0 &&
      expected.recoveryEpoch === undefined &&
      expected.attention === "Monitoring"
    );
  return sameSelectorState(expected, {
    partition: expected.partition,
    notificationCursor: projectRowCounter(
      row.notification_cursor,
      "selector notification cursor",
    ),
    ...(row.recovery_epoch === null
      ? {}
      : { recoveryEpoch: row.recovery_epoch }),
    attention: row.attention,
  });
}

async function markSubmitted(pool: pg.Pool, decision: string): Promise<void> {
  await pool.query(
    `UPDATE selector_proposal_delivery SET state='Submitted'
      WHERE selector_decision=$1 AND state='Pending'`,
    [decision],
  );
}

async function submittedDeliveries(
  pool: pg.Pool,
  limit: number,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector reconciliation");
  const found = await pool.query<DeliveryRow>(
    `SELECT selector_decision,tenant,project,operation,command,attempts::text
       FROM selector_proposal_delivery WHERE state='Submitted'
      ORDER BY selector_decision LIMIT $1`,
    [limit],
  );
  return found.rows.map(deliveryOf);
}

async function pendingDeliveries(
  pool: pg.Pool,
  limit: number,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector delivery");
  const found = await pool.query<DeliveryRow>(
    `UPDATE selector_proposal_delivery
      SET attempts=attempts+1,retry_at=now()+interval '30 seconds'
      WHERE selector_decision IN
        (SELECT selector_decision FROM selector_proposal_delivery
          WHERE state='Pending' AND retry_at<=now() ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING selector_decision,tenant,project,operation,command,attempts::text`,
    [limit],
  );
  return found.rows.map(deliveryOf);
}

async function readInventoryCursor(
  pool: pg.Pool,
): Promise<Partition | undefined> {
  const found = await pool.query<{
    tenant: string | null;
    project: string | null;
  }>("SELECT tenant,project FROM selector_inventory_state WHERE singleton=1");
  const row = found.rows[0];
  return row?.tenant === null ||
    row?.tenant === undefined ||
    row.project === null
    ? undefined
    : { tenant: asTenantId(row.tenant), project: asProjectId(row.project) };
}

async function writeInventoryCursor(
  pool: pg.Pool,
  cursor: Partition | undefined,
): Promise<void> {
  await pool.query(
    "UPDATE selector_inventory_state SET tenant=$1,project=$2 WHERE singleton=1",
    [cursor?.tenant ?? null, cursor?.project ?? null],
  );
}

async function storeInteraction(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
): Promise<void> {
  const stored = await client.query(
    `INSERT INTO selector_interaction
     (selector_decision,tenant,project,instructions_version,instructions,observed_view,
      context,tool_activity,result,implementation_revision,model_revision,policy_revision,
      accounting,started_at,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (selector_decision) DO UPDATE SET selector_decision=EXCLUDED.selector_decision
     WHERE selector_interaction.tenant IS NOT DISTINCT FROM EXCLUDED.tenant
       AND selector_interaction.project IS NOT DISTINCT FROM EXCLUDED.project
       AND selector_interaction.instructions_version IS NOT DISTINCT FROM EXCLUDED.instructions_version
       AND selector_interaction.instructions IS NOT DISTINCT FROM EXCLUDED.instructions
       AND selector_interaction.observed_view IS NOT DISTINCT FROM EXCLUDED.observed_view
       AND selector_interaction.context IS NOT DISTINCT FROM EXCLUDED.context
       AND selector_interaction.tool_activity IS NOT DISTINCT FROM EXCLUDED.tool_activity
       AND selector_interaction.result IS NOT DISTINCT FROM EXCLUDED.result
       AND selector_interaction.implementation_revision IS NOT DISTINCT FROM EXCLUDED.implementation_revision
       AND selector_interaction.model_revision IS NOT DISTINCT FROM EXCLUDED.model_revision
       AND selector_interaction.policy_revision IS NOT DISTINCT FROM EXCLUDED.policy_revision
       AND selector_interaction.accounting IS NOT DISTINCT FROM EXCLUDED.accounting
       AND selector_interaction.started_at IS NOT DISTINCT FROM EXCLUDED.started_at
       AND selector_interaction.completed_at IS NOT DISTINCT FROM EXCLUDED.completed_at
     RETURNING selector_decision`,
    [
      interaction.decision,
      interaction.partition.tenant,
      interaction.partition.project,
      interaction.instructionsVersion,
      interaction.instructions,
      encode(interaction.observedView),
      encode(interaction.context),
      encode(interaction.toolActivity),
      encode(interaction.result),
      interaction.implementationRevision,
      interaction.modelRevision,
      interaction.policyRevision,
      encode(interaction.accounting),
      interaction.startedAt,
      interaction.completedAt,
    ],
  );
  if (stored.rowCount !== 1)
    throw new Error(
      "selector decision reference contradicts retained provenance",
    );
}

async function storePlanning(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
  planningIntent: unknown,
): Promise<void> {
  const stored = await client.query(
    `INSERT INTO selector_planning_intent (tenant,project,selector_decision,intent)
     VALUES ($1,$2,$3,$4) ON CONFLICT (tenant,project) DO UPDATE SET
     selector_decision=EXCLUDED.selector_decision,intent=EXCLUDED.intent,updated_at=now()
     WHERE selector_planning_intent.selector_decision<>EXCLUDED.selector_decision
        OR selector_planning_intent.intent=EXCLUDED.intent RETURNING selector_decision`,
    [
      interaction.partition.tenant,
      interaction.partition.project,
      interaction.decision,
      encode(planningIntent),
    ],
  );
  if (stored.rowCount !== 1)
    throw new Error("selector decision contradicts retained planning intent");
}

async function storeDelivery(
  client: pg.PoolClient,
  proposal: SelectorProposal,
): Promise<void> {
  const stored = await client.query(
    `INSERT INTO selector_proposal_delivery
     (selector_decision,tenant,project,operation,command) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (selector_decision) DO UPDATE SET selector_decision=EXCLUDED.selector_decision
     WHERE selector_proposal_delivery.tenant IS NOT DISTINCT FROM EXCLUDED.tenant
       AND selector_proposal_delivery.project IS NOT DISTINCT FROM EXCLUDED.project
       AND selector_proposal_delivery.operation IS NOT DISTINCT FROM EXCLUDED.operation
       AND selector_proposal_delivery.command IS NOT DISTINCT FROM EXCLUDED.command
     RETURNING selector_decision`,
    [
      proposal.interaction.decision,
      proposal.interaction.partition.tenant,
      proposal.interaction.partition.project,
      proposal.operation,
      encode(proposal.command),
    ],
  );
  if (stored.rowCount !== 1)
    throw new Error("selector decision contradicts retained delivery");
}

async function recordSelectorState(
  pool: pg.Pool,
  interaction: SelectorInteraction,
  previous: SelectorProjectState,
  next: SelectorProjectState,
  planningIntent?: unknown,
  proposal?: SelectorProposal,
): Promise<boolean> {
  return postgresTransaction(pool, async (client) => {
    if (!(await lockSelectorProject(client, previous))) return false;
    await storeInteraction(client, interaction);
    if (planningIntent !== undefined)
      await storePlanning(client, interaction, planningIntent);
    if (proposal !== undefined) await storeDelivery(client, proposal);
    await writeSelectorProject(client, next);
    return true;
  });
}

export function postgresSelectorState(pool: pg.Pool): SelectorStateStore {
  return {
    inventoryCursor: () => readInventoryCursor(pool),
    saveInventoryCursor: (cursor) => writeInventoryCursor(pool, cursor),
    recordInteraction: (interaction, previous, next, planningIntent) =>
      recordSelectorState(pool, interaction, previous, next, planningIntent),
    record: (proposal, previous, next) =>
      recordSelectorState(
        pool,
        proposal.interaction,
        previous,
        next,
        proposal.planningIntent,
        proposal,
      ),
    pending: (limit) => pendingDeliveries(pool, limit),
    submittedDeliveries: (limit) => submittedDeliveries(pool, limit),
    submitted: (decision) => markSubmitted(pool, decision),
    terminal: async (decision, outcome) => {
      await pool.query(
        `UPDATE selector_proposal_delivery SET state='Terminal',outcome=$2 WHERE selector_decision=$1`,
        [decision, encode(outcome)],
      );
    },
    history: async (partition: Partition, after, limit) => {
      checkedSelectorLimit(limit, "selector history");
      const found = await pool.query<{
        ordinal: string;
        selector_decision: string;
        instructions_version: string;
        instructions: string;
        observed_view: string;
        context: string;
        tool_activity: string;
        result: string;
        implementation_revision: string;
        model_revision: string;
        policy_revision: string;
        accounting: string;
        started_at: Date;
        completed_at: Date;
      }>(
        `SELECT * FROM selector_interaction WHERE tenant=$1 AND project=$2
          AND ordinal>$3 ORDER BY ordinal LIMIT $4`,
        [partition.tenant, partition.project, after ?? 0, limit],
      );
      return found.rows.map((row): StoredSelectorInteraction => ({
        ordinal: projectRowCounter(row.ordinal, "selector interaction ordinal"),
        decision: row.selector_decision,
        partition,
        instructionsVersion: row.instructions_version,
        instructions: row.instructions,
        observedView: JSON.parse(
          row.observed_view,
        ) as SelectorInteraction["observedView"],
        context: JSON.parse(row.context) as unknown,
        toolActivity: JSON.parse(row.tool_activity) as readonly unknown[],
        result: JSON.parse(row.result) as unknown,
        implementationRevision: row.implementation_revision,
        modelRevision: row.model_revision,
        policyRevision: row.policy_revision,
        accounting: JSON.parse(row.accounting) as unknown,
        startedAt: row.started_at.toISOString(),
        completedAt: row.completed_at.toISOString(),
      }));
    },
    project: (partition) => readSelectorProject(pool, partition),
  };
}
