import type pg from "pg";

import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
} from "../../interpreter/operationInbox.ts";
import type {
  SelectorDelivery,
  SelectorInteraction,
  SelectorProposal,
  SelectorProjectState,
  SelectorReviewFeedback,
  SelectorPolicyControls,
  SelectorRuntimeControlStore,
  SelectorRuntimeSettings,
  SelectorSettingsUpdate,
  SelectorStateStore,
} from "../../interpreter/selector.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { parseTicketCommand } from "../../interpreter/wire.ts";
import { postgresTransaction } from "./pool.ts";
import { selectorSettingsFunction } from "./schema.ts";

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

function checkedPolicyControls(
  controls: SelectorPolicyControls,
): SelectorPolicyControls {
  for (const [what, values] of [
    ["model allowlist", controls.modelAllowlist],
    ["tool allowlist", controls.toolAllowlist],
  ] as const) {
    if (
      values.length > 64 ||
      values.some((value) => value.length < 1 || value.length > 256)
    )
      throw new RangeError(`${what} must contain at most 64 bounded names`);
  }
  const bounds = {
    ...controls.limits,
    operationalContextMaxAgeMs: controls.operationalContextMaxAgeMs,
  };
  for (const [what, value] of Object.entries(bounds))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${what} must be a positive safe integer`);
  return controls;
}

function settingsOf(row: {
  readonly revision: string;
  readonly mode: SelectorRuntimeSettings["mode"];
  readonly dispatch_mode: SelectorRuntimeSettings["dispatchMode"];
  readonly base_prompt: string;
  readonly controls: string;
}): SelectorRuntimeSettings {
  const controls = JSON.parse(row.controls) as SelectorPolicyControls;
  return {
    revision: Number(row.revision),
    mode: row.mode,
    dispatchMode: row.dispatch_mode,
    basePrompt: row.base_prompt,
    ...controls,
  };
}

async function readSettings(pool: pg.Pool): Promise<SelectorRuntimeSettings> {
  const found = await pool.query<{
    revision: string;
    mode: SelectorRuntimeSettings["mode"];
    dispatch_mode: SelectorRuntimeSettings["dispatchMode"];
    base_prompt: string;
    controls: string;
  }>(
    "SELECT revision::text,mode,dispatch_mode,base_prompt,controls FROM selector_runtime_settings WHERE singleton=1",
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new Error("selector runtime settings are absent");
  return settingsOf(row);
}

async function updateSettings(
  pool: pg.Pool,
  expectedRevision: number,
  update: {
    readonly mode?: SelectorRuntimeSettings["mode"];
    readonly dispatchMode?: SelectorRuntimeSettings["dispatchMode"];
    readonly basePrompt?: string;
    readonly controls?: SelectorPolicyControls;
  },
): Promise<SelectorSettingsUpdate> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    throw new RangeError(
      "selector settings revision must be a positive safe integer",
    );
  if (
    "basePrompt" in update &&
    (update.basePrompt.length < 1 || update.basePrompt.length > 65_536)
  )
    throw new RangeError(
      "selector base prompt must contain between 1 and 65536 characters",
    );
  const found = await pool.query<{
    revision: string;
    mode: SelectorRuntimeSettings["mode"];
    dispatch_mode: SelectorRuntimeSettings["dispatchMode"];
    base_prompt: string;
    controls: string;
  }>(
    `SELECT revision::text,mode,dispatch_mode,base_prompt,controls
       FROM ${selectorSettingsFunction}($1,$2,$3,$4,$5)`,
    [
      expectedRevision,
      "mode" in update ? update.mode : null,
      "dispatchMode" in update ? update.dispatchMode : null,
      "basePrompt" in update ? update.basePrompt : null,
      "controls" in update
        ? encode(checkedPolicyControls(update.controls))
        : null,
    ],
  );
  const row = found.rows[0];
  if (row !== undefined) {
    return { updated: true, settings: settingsOf(row) };
  }
  return { updated: false, settings: await readSettings(pool) };
}

async function settingsHistory(
  pool: pg.Pool,
  afterRevision: number,
  limit: number,
) {
  checkedSelectorLimit(limit, "selector settings history");
  const found = await pool.query<{
    revision: string;
    mode: SelectorRuntimeSettings["mode"];
    dispatch_mode: SelectorRuntimeSettings["dispatchMode"];
    base_prompt: string;
    controls: string;
  }>(
    `SELECT revision::text,mode,dispatch_mode,base_prompt,controls
     FROM selector_runtime_settings_history WHERE revision>$1 ORDER BY revision LIMIT $2`,
    [afterRevision, limit],
  );
  return found.rows.map(settingsOf);
}

async function rollbackSettings(
  pool: pg.Pool,
  expectedRevision: number,
  targetRevision: number,
) {
  const found = await pool.query<{
    mode: SelectorRuntimeSettings["mode"];
    dispatch_mode: SelectorRuntimeSettings["dispatchMode"];
    base_prompt: string;
    controls: string;
  }>(
    `SELECT mode,dispatch_mode,base_prompt,controls FROM selector_runtime_settings_history WHERE revision=$1`,
    [targetRevision],
  );
  const target = found.rows[0];
  if (target === undefined)
    throw new RangeError("selector settings revision does not exist");
  return updateSettings(pool, expectedRevision, {
    mode: target.mode,
    dispatchMode: target.dispatch_mode,
    basePrompt: target.base_prompt,
    controls: JSON.parse(target.controls) as SelectorPolicyControls,
  });
}

export function postgresSelectorRuntimeControl(
  pool: pg.Pool,
): SelectorRuntimeControlStore {
  return {
    settings: () => readSettings(pool),
    pause: (revision) => updateSettings(pool, revision, { mode: "Paused" }),
    unpause: (revision) => updateSettings(pool, revision, { mode: "Running" }),
    setDispatchMode: (revision, dispatchMode) =>
      updateSettings(pool, revision, { dispatchMode }),
    updateBasePrompt: (revision, basePrompt) =>
      updateSettings(pool, revision, { basePrompt }),
    updatePolicyControls: (revision, controls) =>
      updateSettings(pool, revision, { controls }),
    history: (afterRevision, limit) =>
      settingsHistory(pool, afterRevision, limit),
    rollback: (expectedRevision, targetRevision) =>
      rollbackSettings(pool, expectedRevision, targetRevision),
    drainStatus: async () => {
      const settings = await readSettings(pool);
      const found = await pool.query<{
        state: "AwaitingApproval" | "Pending" | "Submitted";
        count: string;
      }>(
        `SELECT state,count(*)::text FROM selector_proposal_delivery
         WHERE state IN ('AwaitingApproval','Pending','Submitted') GROUP BY state`,
      );
      const count = (state: "AwaitingApproval" | "Pending" | "Submitted") =>
        Number(found.rows.find((row) => row.state === state)?.count ?? 0);
      const awaitingApproval = count("AwaitingApproval");
      const pendingDeliveries = count("Pending");
      const submittedDeliveries = count("Submitted");
      return {
        mode: settings.mode,
        awaitingApproval,
        pendingDeliveries,
        submittedDeliveries,
        drained:
          awaitingApproval === 0 &&
          pendingDeliveries === 0 &&
          submittedDeliveries === 0,
      };
    },
  };
}

async function readSelectorProject(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorProjectState | undefined> {
  const found = await pool.query<{
    notification_cursor: string;
    recovery_epoch: string | null;
    attention: SelectorProjectState["attention"];
    working_memory: string;
  }>(
    `SELECT notification_cursor::text,recovery_epoch,attention,working_memory
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
        workingMemory: JSON.parse(row.working_memory) as unknown,
      };
}

async function writeSelectorProject(
  pool: pg.Pool | pg.PoolClient,
  state: SelectorProjectState,
): Promise<void> {
  await pool.query(
    `INSERT INTO selector_project_state
     (tenant,project,notification_cursor,recovery_epoch,attention,working_memory)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant,project) DO UPDATE SET
     notification_cursor=EXCLUDED.notification_cursor,recovery_epoch=EXCLUDED.recovery_epoch,
     attention=EXCLUDED.attention,working_memory=EXCLUDED.working_memory,updated_at=now()`,
    [
      state.partition.tenant,
      state.partition.project,
      state.notificationCursor,
      state.recoveryEpoch ?? null,
      state.attention,
      encode(state.workingMemory),
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

async function awaitingApproval(
  pool: pg.Pool,
  partition: Partition,
  limit: number,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector proposal review");
  const found = await pool.query<DeliveryRow>(
    `SELECT selector_decision,tenant,project,operation,command,attempts::text
     FROM selector_proposal_delivery
     WHERE tenant=$1 AND project=$2 AND state='AwaitingApproval'
     ORDER BY selector_decision LIMIT $3`,
    [partition.tenant, partition.project, limit],
  );
  return found.rows.map(deliveryOf);
}

async function readReviewFeedback(
  pool: pg.Pool,
  partition: Partition,
  after: string | undefined,
  limit: number,
): Promise<readonly SelectorReviewFeedback[]> {
  checkedSelectorLimit(limit, "selector review feedback");
  const found = await pool.query<{
    selector_decision: string;
    review_outcome: SelectorReviewFeedback["outcome"];
    reviewer_kind: string;
    reviewer_subject: string;
    review_feedback: string | null;
    reviewed_at: Date;
  }>(
    `SELECT selector_decision,review_outcome,reviewer_kind,reviewer_subject,
       review_feedback,reviewed_at FROM selector_proposal_delivery
     WHERE tenant=$1 AND project=$2 AND reviewed_at IS NOT NULL
       AND selector_decision>$3 ORDER BY selector_decision LIMIT $4`,
    [partition.tenant, partition.project, after ?? "", limit],
  );
  return found.rows.map((row) => ({
    selectorDecision: row.selector_decision,
    outcome: row.review_outcome,
    reviewer: {
      kind: asAuthorityKind(row.reviewer_kind),
      subject: asAuthoritySubject(row.reviewer_subject),
    },
    ...(row.review_feedback === null ? {} : { feedback: row.review_feedback }),
    reviewedAt: row.reviewed_at.toISOString(),
  }));
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

async function insertSelectorInteraction(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
): Promise<boolean> {
  const values = [
    interaction.decision,
    interaction.partition.tenant,
    interaction.partition.project,
    interaction.instructionsVersion,
    interaction.instructions,
    encode(interaction.observedView),
    interaction.observedToken === undefined
      ? null
      : encode(interaction.observedToken),
    encode(interaction.context),
    encode(interaction.toolActivity),
    encode(interaction.result),
    interaction.implementationRevision,
    interaction.modelRevision,
    interaction.policyRevision,
    encode(interaction.accounting),
    interaction.startedAt,
    interaction.completedAt,
  ];
  const inserted = await client.query<{ selector_decision: string }>(
    `INSERT INTO selector_interaction
     (selector_decision,tenant,project,instructions_version,instructions,observed_view,observed_token,
      context,tool_activity,result,implementation_revision,model_revision,policy_revision,
      accounting,started_at,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (selector_decision) DO NOTHING RETURNING selector_decision`,
    values,
  );
  if (inserted.rowCount === 1) return true;
  const same = await client.query(
    `SELECT 1 FROM selector_interaction WHERE selector_decision=$1
     AND tenant=$2 AND project=$3 AND instructions_version=$4 AND instructions=$5
     AND observed_view=$6 AND observed_token IS NOT DISTINCT FROM $7
     AND context=$8 AND tool_activity=$9 AND result=$10
     AND implementation_revision=$11 AND model_revision=$12 AND policy_revision=$13
     AND accounting=$14 AND started_at=$15 AND completed_at=$16`,
    values,
  );
  if (same.rowCount !== 1)
    throw new Error(
      "selector decision identity conflicts with retained interaction",
    );
  return false;
}

async function recordSelectorState(
  pool: pg.Pool,
  interaction: SelectorInteraction,
  state: SelectorProjectState,
  planningIntent?: unknown,
  proposal?: SelectorProposal,
): Promise<void> {
  await postgresTransaction(pool, async (client) => {
    if (!(await insertSelectorInteraction(client, interaction))) return;
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
       (selector_decision,tenant,project,operation,command,state) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (selector_decision) DO NOTHING`,
        [
          interaction.decision,
          interaction.partition.tenant,
          interaction.partition.project,
          proposal.operation,
          encode(proposal.command),
          proposal.deliveryMode === "Automatic"
            ? "Pending"
            : "AwaitingApproval",
        ],
      );
    await writeSelectorProject(client, state);
  });
}

async function readSelectorHistory(
  pool: pg.Pool,
  partition: Partition,
  after: string | undefined,
  limit: number,
): Promise<readonly SelectorInteraction[]> {
  checkedSelectorLimit(limit, "selector history");
  const found = await pool.query<{
    selector_decision: string;
    instructions_version: string;
    instructions: string;
    observed_view: string;
    observed_token: string | null;
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
    ...(row.observed_token === null
      ? {}
      : {
          observedToken: JSON.parse(row.observed_token) as NonNullable<
            SelectorInteraction["observedToken"]
          >,
        }),
    context: JSON.parse(row.context) as SelectorInteraction["context"],
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
    history: (partition, after, limit) =>
      readSelectorHistory(pool, partition, after, limit),
    project: (partition) => readSelectorProject(pool, partition),
    awaitingApproval: (partition, limit) =>
      awaitingApproval(pool, partition, limit),
    approve: async (partition, decision, reviewer, feedback) => {
      const changed = await pool.query(
        `UPDATE selector_proposal_delivery SET state='Pending',review_feedback=$2,
         reviewed_at=now(),reviewer_kind=$3,reviewer_subject=$4,review_outcome='Approved',
         retry_at=now() WHERE selector_decision=$1 AND tenant=$5
         AND project=$6 AND state='AwaitingApproval'`,
        [
          decision,
          feedback ?? null,
          reviewer.kind,
          reviewer.subject,
          partition.tenant,
          partition.project,
        ],
      );
      return changed.rowCount === 1;
    },
    reject: async (partition, decision, reviewer, feedback) => {
      const changed = await pool.query(
        `UPDATE selector_proposal_delivery SET state='Terminal',review_feedback=$2,
         reviewed_at=now(),reviewer_kind=$3,reviewer_subject=$4,review_outcome='Rejected',
         outcome=$5 WHERE selector_decision=$1 AND tenant=$6
         AND project=$7 AND state='AwaitingApproval'`,
        [
          decision,
          feedback ?? null,
          reviewer.kind,
          reviewer.subject,
          encode({ state: "RejectedByUser", feedback }),
          partition.tenant,
          partition.project,
        ],
      );
      return changed.rowCount === 1;
    },
    reviewFeedback: (partition, after, limit) =>
      readReviewFeedback(pool, partition, after, limit),
  };
}
