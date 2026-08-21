import { sql } from "@ts-safeql/sql-tag";
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
  readonly attempts: string | null;
}

class SelectorStateChanged extends Error {}

function deliveryOf(row: DeliveryRow): SelectorDelivery {
  const parsed = parseTicketCommand(row.command);
  if (parsed.parsed === "Refused" || parsed.value.command !== "ProposeDispatch")
    throw new Error("selector delivery contains an unreadable proposal");
  if (row.attempts === null)
    throw new Error("selector delivery row carries no attempt count");
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

function selectorAttention(value: string): SelectorProjectState["attention"] {
  if (value === "Monitoring" || value === "Attention" || value === "Stopped")
    return value;
  throw new Error(`selector project row: unknown attention ${value}`);
}

function checkedSelectorLimit(limit: number, what: string): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError(`${what} limit must be between 1 and 100`);
  return limit;
}

function checkedSelectorCursor(cursor: number | undefined): number {
  if (cursor === undefined) return 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new RangeError(
      "selector history cursor must be a non-negative safe integer",
    );
  return cursor;
}

async function readSelectorProject(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorProjectState | undefined> {
  const found = await pool.query<{
    notification_cursor: string;
    recovery_epoch: string | null;
    attention: string;
  }>(
    sql`SELECT notification_cursor::text,recovery_epoch,attention
       FROM selector_project_state
      WHERE tenant=${partition.tenant} AND project=${partition.project}`,
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        partition,
        notificationCursor: projectRowCounter(
          row.notification_cursor,
          "selector notification cursor",
        ),
        ...(row.recovery_epoch === null
          ? {}
          : { recoveryEpoch: row.recovery_epoch }),
        attention: selectorAttention(row.attention),
      };
}

async function writeSelectorProject(
  pool: pg.Pool | pg.PoolClient,
  state: SelectorProjectState,
): Promise<void> {
  await pool.query(
    sql`INSERT INTO selector_project_state
     (tenant,project,notification_cursor,recovery_epoch,attention)
     VALUES (${state.partition.tenant},${state.partition.project},${state.notificationCursor},${state.recoveryEpoch ?? null},${state.attention})
     ON CONFLICT (tenant,project) DO UPDATE SET
     notification_cursor=EXCLUDED.notification_cursor,recovery_epoch=EXCLUDED.recovery_epoch,
     attention=EXCLUDED.attention,updated_at=now()`,
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
  await client.query(
    sql`INSERT INTO selector_project_state (tenant,project)
     VALUES (${expected.partition.tenant},${expected.partition.project})
     ON CONFLICT (tenant,project) DO NOTHING`,
  );
  const found = await client.query<{
    notification_cursor: string;
    recovery_epoch: string | null;
    attention: string;
  }>(
    sql`SELECT notification_cursor::text,recovery_epoch,attention
       FROM selector_project_state
      WHERE tenant=${expected.partition.tenant} AND project=${expected.partition.project} FOR UPDATE`,
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new Error("selector project state disappeared while locked");
  return sameSelectorState(expected, {
    partition: expected.partition,
    notificationCursor: projectRowCounter(
      row.notification_cursor,
      "selector notification cursor",
    ),
    ...(row.recovery_epoch === null
      ? {}
      : { recoveryEpoch: row.recovery_epoch }),
    attention: selectorAttention(row.attention),
  });
}

async function markSubmitted(pool: pg.Pool, decision: string): Promise<void> {
  await pool.query(
    sql`UPDATE selector_proposal_delivery SET state='Submitted',reconcile_at=now()
      WHERE selector_decision=${decision} AND state='Pending'`,
  );
}

async function deferDelivery(
  pool: pg.Pool,
  decision: string,
  delayMilliseconds: number,
  retry: SelectorRetryConfig,
): Promise<void> {
  if (
    !Number.isSafeInteger(delayMilliseconds) ||
    delayMilliseconds < 1 ||
    delayMilliseconds > 24 * 60 * 60_000
  )
    throw new RangeError("selector retry delay must be bounded milliseconds");
  await pool.query(
    sql`UPDATE selector_proposal_delivery
        SET retry_at=GREATEST(retry_at,now()+${Math.min(delayMilliseconds, retry.maximumDelayMilliseconds)} * interval '1 millisecond')
      WHERE selector_decision=${decision} AND state='Pending'`,
  );
}

async function markTerminal(
  pool: pg.Pool,
  decision: string,
  outcome: Parameters<SelectorStateStore["terminal"]>[1],
): Promise<void> {
  const encoded = encode(outcome);
  const terminal = await pool.query<{ selector_decision: string }>(
    sql`UPDATE selector_proposal_delivery SET state='Terminal',outcome=${encoded}
      WHERE selector_decision=${decision} AND (state<>'Terminal' OR outcome=${encoded})
      RETURNING selector_decision`,
  );
  if (terminal.rowCount !== 1)
    throw new Error(
      "selector delivery terminal outcome contradicts retained state",
    );
}

async function submittedDeliveries(
  pool: pg.Pool,
  limit: number,
  retry: SelectorRetryConfig,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector reconciliation");
  const found = await pool.query<DeliveryRow>(
    sql`UPDATE selector_proposal_delivery
        SET reconciliation_attempts=reconciliation_attempts+1,
            reconcile_at=now()+LEAST(
              ${retry.baseDelayMilliseconds}::double precision * power(2::double precision,LEAST(reconciliation_attempts,20)::double precision),
              ${retry.maximumDelayMilliseconds}::double precision
            ) * interval '1 millisecond'
      WHERE selector_decision IN
        (SELECT selector_decision FROM selector_proposal_delivery
          WHERE state='Submitted' AND reconcile_at<=now()
          ORDER BY reconcile_at,selector_decision LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING selector_decision,tenant,project,operation,command,attempts::text`,
  );
  return found.rows.map(deliveryOf);
}

async function pendingDeliveries(
  pool: pg.Pool,
  limit: number,
  retry: SelectorRetryConfig,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector delivery");
  const found = await pool.query<DeliveryRow>(
    sql`UPDATE selector_proposal_delivery
      SET attempts=attempts+1,
          retry_at=now()+LEAST(
            ${retry.baseDelayMilliseconds}::double precision * power(2::double precision,LEAST(attempts,20)::double precision),
            ${retry.maximumDelayMilliseconds}::double precision
          ) * interval '1 millisecond'
      WHERE selector_decision IN
        (SELECT selector_decision FROM selector_proposal_delivery
          WHERE state='Pending' AND retry_at<=now() ORDER BY retry_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING selector_decision,tenant,project,operation,command,attempts::text`,
  );
  return found.rows.map(deliveryOf);
}

async function readInventoryCursor(
  pool: pg.Pool,
): Promise<Partition | undefined> {
  const found = await pool.query<{
    tenant: string | null;
    project: string | null;
  }>(
    sql`SELECT tenant,project FROM selector_inventory_state WHERE singleton=1`,
  );
  const row = found.rows[0];
  return row?.tenant === null ||
    row?.tenant === undefined ||
    row.project === null
    ? undefined
    : { tenant: asTenantId(row.tenant), project: asProjectId(row.project) };
}

async function advanceInventoryCursor(
  pool: pg.Pool,
  previous: Partition | undefined,
  next: Partition | undefined,
): Promise<boolean> {
  const advanced = await pool.query(
    sql`UPDATE selector_inventory_state
        SET tenant=${next?.tenant ?? null},project=${next?.project ?? null}
      WHERE singleton=1 AND tenant IS NOT DISTINCT FROM ${previous?.tenant ?? null}
        AND project IS NOT DISTINCT FROM ${previous?.project ?? null}`,
  );
  return advanced.rowCount === 1;
}

async function storeInteraction(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
): Promise<void> {
  const stored = await client.query<{ selector_decision: string }>(
    sql`INSERT INTO selector_interaction
     (selector_decision,tenant,project,instructions_version,instructions,observed_view,
      context,tool_activity,result,implementation_revision,model_revision,policy_revision,
      accounting,started_at,completed_at)
     VALUES (${interaction.decision},${interaction.partition.tenant},${interaction.partition.project},
             ${interaction.instructionsVersion},${interaction.instructions},${encode(interaction.observedView)},
             ${encode(interaction.context)},${encode(interaction.toolActivity)},${encode(interaction.result)},
             ${interaction.implementationRevision},${interaction.modelRevision},${interaction.policyRevision},
             ${encode(interaction.accounting)},${interaction.startedAt}::timestamptz,${interaction.completedAt}::timestamptz)
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
  const stored = await client.query<{ selector_decision: string }>(
    sql`INSERT INTO selector_planning_intent (tenant,project,selector_decision,intent)
     VALUES (${interaction.partition.tenant},${interaction.partition.project},${interaction.decision},${encode(planningIntent)})
     ON CONFLICT (tenant,project) DO UPDATE SET
     selector_decision=EXCLUDED.selector_decision,intent=EXCLUDED.intent,updated_at=now()
     WHERE selector_planning_intent.selector_decision<>EXCLUDED.selector_decision
        OR selector_planning_intent.intent=EXCLUDED.intent RETURNING selector_decision`,
  );
  if (stored.rowCount !== 1)
    throw new Error("selector decision contradicts retained planning intent");
}

async function storeDelivery(
  client: pg.PoolClient,
  proposal: SelectorProposal,
): Promise<void> {
  const stored = await client.query<{ selector_decision: string }>(
    sql`INSERT INTO selector_proposal_delivery
     (selector_decision,tenant,project,operation,command)
     VALUES (${proposal.interaction.decision},${proposal.interaction.partition.tenant},${proposal.interaction.partition.project},${proposal.operation},${encode(proposal.command)})
     ON CONFLICT (selector_decision) DO UPDATE SET selector_decision=EXCLUDED.selector_decision
     WHERE selector_proposal_delivery.tenant IS NOT DISTINCT FROM EXCLUDED.tenant
       AND selector_proposal_delivery.project IS NOT DISTINCT FROM EXCLUDED.project
       AND selector_proposal_delivery.operation IS NOT DISTINCT FROM EXCLUDED.operation
       AND selector_proposal_delivery.command IS NOT DISTINCT FROM EXCLUDED.command
     RETURNING selector_decision`,
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
  try {
    return await postgresTransaction(pool, async (client) => {
      await storeInteraction(client, interaction);
      if (!(await lockSelectorProject(client, previous)))
        throw new SelectorStateChanged();
      if (planningIntent !== undefined)
        await storePlanning(client, interaction, planningIntent);
      if (proposal !== undefined) await storeDelivery(client, proposal);
      await writeSelectorProject(client, next);
      return true;
    });
  } catch (error) {
    if (error instanceof SelectorStateChanged) return false;
    throw error;
  }
}

export interface SelectorRetryConfig {
  readonly baseDelayMilliseconds: number;
  readonly maximumDelayMilliseconds: number;
}

export const selectorRetryDefaults: SelectorRetryConfig = {
  baseDelayMilliseconds: 30_000,
  maximumDelayMilliseconds: 15 * 60_000,
};

function checkedRetryConfig(config: SelectorRetryConfig): SelectorRetryConfig {
  if (
    !Number.isSafeInteger(config.baseDelayMilliseconds) ||
    config.baseDelayMilliseconds < 1 ||
    !Number.isSafeInteger(config.maximumDelayMilliseconds) ||
    config.maximumDelayMilliseconds < config.baseDelayMilliseconds ||
    config.maximumDelayMilliseconds > 24 * 60 * 60_000
  )
    throw new RangeError(
      "selector retry delays must be positive bounded milliseconds with maximum at least base",
    );
  return config;
}

async function readSelectorHistory(
  pool: pg.Pool,
  partition: Partition,
  after: number | undefined,
  limit: number,
): Promise<readonly StoredSelectorInteraction[]> {
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
    sql`SELECT ordinal,selector_decision,instructions_version,instructions,
            observed_view,context,tool_activity,result,implementation_revision,
            model_revision,policy_revision,accounting,started_at,completed_at
       FROM selector_interaction
      WHERE tenant=${partition.tenant} AND project=${partition.project}
        AND ordinal>${checkedSelectorCursor(after)} ORDER BY ordinal
      LIMIT ${limit}`,
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
}

function selectorStateWithRetry(
  pool: pg.Pool,
  retry: SelectorRetryConfig,
): SelectorStateStore {
  return {
    inventoryCursor: () => readInventoryCursor(pool),
    advanceInventoryCursor: (previous, next) =>
      advanceInventoryCursor(pool, previous, next),
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
    pending: (limit) => pendingDeliveries(pool, limit, retry),
    submittedDeliveries: (limit) => submittedDeliveries(pool, limit, retry),
    submitted: (decision) => markSubmitted(pool, decision),
    retry: (decision, delayMilliseconds) =>
      deferDelivery(pool, decision, delayMilliseconds, retry),
    terminal: (decision, outcome) => markTerminal(pool, decision, outcome),
    history: (partition, after, limit) =>
      readSelectorHistory(pool, partition, after, limit),
    project: (partition) => readSelectorProject(pool, partition),
  };
}

export function postgresSelectorState(
  pool: pg.Pool,
  retryConfig: SelectorRetryConfig = selectorRetryDefaults,
): SelectorStateStore {
  return selectorStateWithRetry(pool, checkedRetryConfig(retryConfig));
}
