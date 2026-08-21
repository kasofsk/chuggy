import type pg from "pg";

import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  type Authority,
} from "../../interpreter/operationInbox.ts";
import type {
  SelectorDelivery,
  SelectorInteraction,
  SelectorInteractionRecord,
  SelectorProposal,
  SelectorProjectState,
  SelectorReviewFeedback,
  SelectorPolicyControls,
  SelectorRuntimeControlStore,
  SelectorRuntimeSettings,
  SelectorSettingsUpdate,
  SelectorSettingsRevision,
  SelectorStateStore,
} from "../../interpreter/selector.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { parseTicketCommand } from "../../interpreter/wire.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import type { SelectorProposalReviewStore } from "../../interpreter/selectorReview.ts";
import {
  selectorClaimFunction,
  selectorDeliveryFunction,
  selectorReviewFunction,
  selectorSettingsFunction,
} from "./schema.ts";

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
    revision: projectRowCounter(row.revision, "selector settings revision"),
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
  administrator: Authority,
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
       FROM ${selectorSettingsFunction}($1,$2,$3,$4,$5,$6,$7)`,
    [
      expectedRevision,
      "mode" in update ? update.mode : null,
      "dispatchMode" in update ? update.dispatchMode : null,
      "basePrompt" in update ? update.basePrompt : null,
      "controls" in update
        ? encode(checkedPolicyControls(update.controls))
        : null,
      administrator.kind,
      administrator.subject,
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
): Promise<readonly SelectorSettingsRevision[]> {
  checkedSelectorLimit(limit, "selector settings history");
  const found = await pool.query<{
    revision: string;
    mode: SelectorRuntimeSettings["mode"];
    dispatch_mode: SelectorRuntimeSettings["dispatchMode"];
    base_prompt: string;
    controls: string;
    administrator_kind: string;
    administrator_subject: string;
    recorded_at: Date;
  }>(
    `SELECT revision::text,mode,dispatch_mode,base_prompt,controls,
       administrator_kind,administrator_subject,recorded_at
     FROM selector_runtime_settings_history WHERE revision>$1 ORDER BY revision LIMIT $2`,
    [afterRevision, limit],
  );
  return found.rows.map((row) => ({
    settings: settingsOf(row),
    administrator: {
      kind: asAuthorityKind(row.administrator_kind),
      subject: asAuthoritySubject(row.administrator_subject),
    },
    recordedAt: row.recorded_at.toISOString(),
  }));
}

async function rollbackSettings(
  pool: pg.Pool,
  expectedRevision: number,
  targetRevision: number,
  administrator: Authority,
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
  return updateSettings(
    pool,
    expectedRevision,
    {
      mode: target.mode,
      dispatchMode: target.dispatch_mode,
      basePrompt: target.base_prompt,
      controls: JSON.parse(target.controls) as SelectorPolicyControls,
    },
    administrator,
  );
}

export function postgresSelectorRuntimeControl(
  pool: pg.Pool,
): SelectorRuntimeControlStore {
  return {
    settings: () => readSettings(pool),
    pause: (revision, administrator) =>
      updateSettings(pool, revision, { mode: "Paused" }, administrator),
    unpause: (revision, administrator) =>
      updateSettings(pool, revision, { mode: "Running" }, administrator),
    setDispatchMode: (revision, dispatchMode, administrator) =>
      updateSettings(pool, revision, { dispatchMode }, administrator),
    updateBasePrompt: (revision, basePrompt, administrator) =>
      updateSettings(pool, revision, { basePrompt }, administrator),
    updatePolicyControls: (revision, controls, administrator) =>
      updateSettings(pool, revision, { controls }, administrator),
    history: (afterRevision, limit) =>
      settingsHistory(pool, afterRevision, limit),
    rollback: (expectedRevision, targetRevision, administrator) =>
      rollbackSettings(pool, expectedRevision, targetRevision, administrator),
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
    revision: string;
    recovery_epoch: string | null;
    attention: SelectorProjectState["attention"];
    working_memory: string;
  }>(
    `SELECT notification_cursor::text,revision::text,recovery_epoch,attention,working_memory
       FROM selector_project_state WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
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
        revision: projectRowCounter(row.revision, "selector state revision"),
        ...(row.recovery_epoch === null
          ? {}
          : { recoveryEpoch: row.recovery_epoch }),
        attention: row.attention,
        workingMemory: JSON.parse(row.working_memory) as unknown,
      };
}

async function lockSelectorProject(
  client: pg.PoolClient,
  state: SelectorProjectState,
): Promise<boolean> {
  await client.query(
    `INSERT INTO selector_project_state (tenant,project)
       VALUES ($1,$2) ON CONFLICT (tenant,project) DO NOTHING`,
    [state.partition.tenant, state.partition.project],
  );
  const locked = await client.query<{ revision: string }>(
    `SELECT revision::text FROM selector_project_state
       WHERE tenant=$1 AND project=$2 FOR UPDATE`,
    [state.partition.tenant, state.partition.project],
  );
  const revision = locked.rows[0]?.revision;
  return (
    revision !== undefined &&
    projectRowCounter(revision, "selector state revision") === state.revision
  );
}

async function writeSelectorProject(
  client: pg.PoolClient,
  state: SelectorProjectState,
): Promise<void> {
  await client.query(
    `UPDATE selector_project_state SET notification_cursor=$3,recovery_epoch=$4,
       attention=$5,working_memory=$6,revision=revision+1,updated_at=now()
       WHERE tenant=$1 AND project=$2 AND revision=$7`,
    [
      state.partition.tenant,
      state.partition.project,
      state.notificationCursor,
      state.recoveryEpoch ?? null,
      state.attention,
      encode(state.workingMemory),
      state.revision,
    ],
  );
}

async function markSubmitted(pool: pg.Pool, decision: string): Promise<void> {
  await pool.query(`SELECT ${selectorDeliveryFunction}($1,'Submitted',NULL)`, [
    decision,
  ]);
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
    `SELECT selector_decision,tenant,project,operation,command,attempts::text
       FROM ${selectorClaimFunction}($1)`,
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
  after: number | undefined,
  limit: number,
): Promise<readonly SelectorReviewFeedback[]> {
  checkedSelectorLimit(limit, "selector review feedback");
  const found = await pool.query<{
    selector_decision: string;
    ordinal: string;
    review_outcome: SelectorReviewFeedback["outcome"];
    reviewer_kind: string;
    reviewer_subject: string;
    review_feedback: string | null;
    reviewed_at: Date;
  }>(
    `SELECT delivery.selector_decision,interaction.ordinal::text,
       delivery.review_outcome,delivery.reviewer_kind,delivery.reviewer_subject,
       delivery.review_feedback,delivery.reviewed_at
       FROM selector_proposal_delivery delivery JOIN selector_interaction interaction
         USING (selector_decision,tenant,project)
     WHERE delivery.tenant=$1 AND delivery.project=$2 AND delivery.reviewed_at IS NOT NULL
       AND interaction.ordinal>$3 ORDER BY interaction.ordinal LIMIT $4`,
    [partition.tenant, partition.project, after ?? 0, limit],
  );
  return found.rows.map((row) => ({
    ordinal: projectRowCounter(row.ordinal, "selector review ordinal"),
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
): Promise<boolean> {
  return postgresTransaction(pool, async (client) => {
    if (!(await lockSelectorProject(client, state))) return false;
    if (!(await insertSelectorInteraction(client, interaction))) return false;
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
    let proposalRecorded = false;
    if (proposal !== undefined) {
      const inserted = await client.query(
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
      proposalRecorded = inserted.rowCount === 1;
    }
    await writeSelectorProject(client, state);
    return proposal === undefined || proposalRecorded;
  });
}

async function readSelectorHistory(
  pool: pg.Pool,
  partition: Partition,
  after: number | undefined,
  limit: number,
): Promise<readonly SelectorInteractionRecord[]> {
  checkedSelectorLimit(limit, "selector history");
  const found = await pool.query<{
    selector_decision: string;
    ordinal: string;
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
    `SELECT selector_decision,ordinal::text,instructions_version,instructions,observed_view,
       observed_token,context,tool_activity,result,implementation_revision,model_revision,
       policy_revision,accounting,started_at,completed_at
       FROM selector_interaction WHERE tenant=$1 AND project=$2
       AND ordinal>$3 ORDER BY ordinal LIMIT $4`,
    [partition.tenant, partition.project, after ?? 0, limit],
  );
  return found.rows.map((row): SelectorInteractionRecord => ({
    decision: row.selector_decision,
    ordinal: projectRowCounter(row.ordinal, "selector interaction ordinal"),
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
      await pool.query(`SELECT ${selectorDeliveryFunction}($1,'Terminal',$2)`, [
        decision,
        encode(outcome),
      ]);
    },
    history: (partition, after, limit) =>
      readSelectorHistory(pool, partition, after, limit),
    project: (partition) => readSelectorProject(pool, partition),
  };
}

export function postgresSelectorProposalReviews(
  pool: pg.Pool,
): SelectorProposalReviewStore {
  return {
    awaitingApproval: (partition, limit) =>
      awaitingApproval(pool, partition, limit),
    approve: async (partition, decision, reviewer, feedback) => {
      const changed = await pool.query<{ changed: boolean }>(
        `SELECT ${selectorReviewFunction}($1,$2,$3,'Approved',$4,$5,$6) AS changed`,
        [
          decision,
          partition.tenant,
          partition.project,
          reviewer.kind,
          reviewer.subject,
          feedback ?? null,
        ],
      );
      return changed.rows[0]?.changed ?? false;
    },
    reject: async (partition, decision, reviewer, feedback) => {
      const changed = await pool.query<{ changed: boolean }>(
        `SELECT ${selectorReviewFunction}($1,$2,$3,'Rejected',$4,$5,$6) AS changed`,
        [
          decision,
          partition.tenant,
          partition.project,
          reviewer.kind,
          reviewer.subject,
          feedback ?? null,
        ],
      );
      return changed.rows[0]?.changed ?? false;
    },
    reviewFeedback: (partition, after, limit) =>
      readReviewFeedback(pool, partition, after, limit),
  };
}
