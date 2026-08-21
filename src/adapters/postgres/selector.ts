import type pg from "pg";

import { asOperationId } from "../../interpreter/operationInbox.ts";
import type {
  SelectorDelivery,
  SelectorInteraction,
  SelectorProposal,
  SelectorProjectState,
  SelectorStateStore,
} from "../../interpreter/selector.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { parseTicketCommand } from "../../interpreter/wire.ts";
import { postgresTransaction } from "./pool.ts";

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

async function recordSelectorState(
  pool: pg.Pool,
  interaction: SelectorInteraction,
  state: SelectorProjectState,
  planningIntent?: unknown,
  proposal?: SelectorProposal,
): Promise<void> {
  await postgresTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO selector_interaction
       (selector_decision,tenant,project,instructions_version,instructions,observed_view,
        context,tool_activity,result,implementation_revision,model_revision,policy_revision,
        accounting,started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (selector_decision) DO NOTHING`,
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
    if (planningIntent !== undefined)
      await client.query(
        `INSERT INTO selector_planning_intent (tenant,project,selector_decision,intent)
         VALUES ($1,$2,$3,$4) ON CONFLICT (tenant,project) DO UPDATE SET
         selector_decision=EXCLUDED.selector_decision,intent=EXCLUDED.intent,updated_at=now()`,
        [
          interaction.partition.tenant,
          interaction.partition.project,
          interaction.decision,
          encode(planningIntent),
        ],
      );
    if (proposal !== undefined)
      await client.query(
        `INSERT INTO selector_proposal_delivery
       (selector_decision,tenant,project,operation,command) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (selector_decision) DO NOTHING`,
        [
          interaction.decision,
          interaction.partition.tenant,
          interaction.partition.project,
          proposal.operation,
          encode(proposal.command),
        ],
      );
    await writeSelectorProject(client, state);
  });
}

export function postgresSelectorState(pool: pg.Pool): SelectorStateStore {
  return {
    inventoryCursor: () => readInventoryCursor(pool),
    saveInventoryCursor: (cursor) => writeInventoryCursor(pool, cursor),
    recordInteraction: (interaction, state, planningIntent) =>
      recordSelectorState(pool, interaction, state, planningIntent),
    record: (proposal, state) =>
      recordSelectorState(
        pool,
        proposal.interaction,
        state,
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
          AND selector_decision>$3 ORDER BY selector_decision LIMIT $4`,
        [partition.tenant, partition.project, after ?? "", limit],
      );
      return found.rows.map((row): SelectorInteraction => ({
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
