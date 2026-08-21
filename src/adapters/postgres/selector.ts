import type pg from "pg";
import { createHash } from "node:crypto";

import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  type Authority,
} from "../../interpreter/operationInbox.ts";
import type {
  JsonValue,
  SelectorDelivery,
  SelectorInteraction,
  SelectorInteractionRecord,
  SelectorProposal,
  SelectorPlanningIntent,
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
  selectorReconcileClaimFunction,
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

type InteractionResourceKind = "ObservedView" | "Context" | "ToolActivity";

interface InteractionResourceManifest {
  readonly kind: InteractionResourceKind;
  readonly digest: string;
  readonly bytes: number;
  readonly chunks: number;
}

interface EncodedInteractionResource {
  readonly manifest: InteractionResourceManifest;
  readonly chunks: readonly string[];
}

function interactionResource(
  kind: InteractionResourceKind,
  value: unknown,
): EncodedInteractionResource {
  const bytes = Buffer.from(encode(value), "utf8");
  const chunkBytes = 45_000;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes)
    chunks.push(bytes.subarray(offset, offset + chunkBytes).toString("base64"));
  if (chunks.length === 0) chunks.push("");
  return {
    manifest: {
      kind,
      digest: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      chunks: chunks.length,
    },
    chunks,
  };
}

async function insertInteractionResource(
  client: pg.PoolClient,
  decision: string,
  resource: EncodedInteractionResource,
): Promise<void> {
  for (const [ordinal, content] of resource.chunks.entries())
    await client.query(
      `INSERT INTO selector_interaction_resource
       (selector_decision,kind,ordinal,digest,byte_length,chunk_count,content)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        decision,
        resource.manifest.kind,
        ordinal,
        resource.manifest.digest,
        resource.manifest.bytes,
        resource.manifest.chunks,
        content,
      ],
    );
}

async function readInteractionResource<T>(
  pool: pg.Pool,
  decision: string,
  manifestText: string,
): Promise<T> {
  const manifest = JSON.parse(manifestText) as InteractionResourceManifest;
  const found = await pool.query<{
    ordinal: string;
    digest: string;
    byte_length: string;
    chunk_count: string;
    content: string;
  }>(
    `SELECT ordinal::text,digest,byte_length::text,chunk_count::text,content
       FROM selector_interaction_resource
       WHERE selector_decision=$1 AND kind=$2 ORDER BY ordinal`,
    [decision, manifest.kind],
  );
  if (
    found.rows.length !== manifest.chunks ||
    found.rows.some(
      (row, ordinal) =>
        projectRowCounter(row.ordinal, "selector resource ordinal") !==
          ordinal ||
        row.digest !== manifest.digest ||
        projectRowCounter(row.byte_length, "selector resource byte length") !==
          manifest.bytes ||
        projectRowCounter(row.chunk_count, "selector resource chunk count") !==
          manifest.chunks,
    )
  )
    throw new Error("selector interaction resource manifest is incomplete");
  const bytes = Buffer.concat(
    found.rows.map((row) => Buffer.from(row.content, "base64")),
  );
  if (
    bytes.length !== manifest.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== manifest.digest
  )
    throw new Error("selector interaction resource failed its digest");
  return JSON.parse(bytes.toString("utf8")) as T;
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
  if (controls.limits.candidatePagesPerDecision !== 1)
    throw new RangeError(
      "candidatePagesPerDecision must be one until multi-page policy tools land",
    );
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
    candidate_scan_token: string | null;
    candidate_scan_after: string | null;
  }>(
    `SELECT notification_cursor::text,revision::text,recovery_epoch,attention,working_memory,
       candidate_scan_token,candidate_scan_after::text
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
        workingMemory: JSON.parse(row.working_memory) as JsonValue,
        ...(row.candidate_scan_token === null ||
        row.candidate_scan_after === null
          ? {}
          : {
              candidateScan: {
                token: JSON.parse(row.candidate_scan_token) as NonNullable<
                  SelectorProjectState["candidateScan"]
                >["token"],
                after: projectRowCounter(
                  row.candidate_scan_after,
                  "selector candidate scan cursor",
                ) as NonNullable<
                  SelectorProjectState["candidateScan"]
                >["after"],
              },
            }),
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
       attention=$5,working_memory=$6,candidate_scan_token=$7,candidate_scan_after=$8,
       revision=revision+1,updated_at=now()
       WHERE tenant=$1 AND project=$2 AND revision=$9`,
    [
      state.partition.tenant,
      state.partition.project,
      state.notificationCursor,
      state.recoveryEpoch ?? null,
      state.attention,
      encode(state.workingMemory),
      state.candidateScan === undefined
        ? null
        : encode(state.candidateScan.token),
      state.candidateScan?.after ?? null,
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
       FROM ${selectorReconcileClaimFunction}($1)`,
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
    `SELECT selector_decision,ordinal::text,outcome AS review_outcome,
       reviewer_kind,reviewer_subject,feedback AS review_feedback,reviewed_at
       FROM selector_proposal_review
     WHERE tenant=$1 AND project=$2 AND ordinal>$3 ORDER BY ordinal LIMIT $4`,
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
  const resources = [
    interactionResource("ObservedView", interaction.observedView),
    interactionResource("Context", interaction.context),
    interactionResource("ToolActivity", interaction.toolActivity),
  ] as const;
  const values = [
    interaction.decision,
    interaction.partition.tenant,
    interaction.partition.project,
    interaction.instructionsVersion,
    interaction.instructions,
    encode(resources[0].manifest),
    interaction.observedToken === undefined
      ? null
      : encode(interaction.observedToken),
    encode(resources[1].manifest),
    encode(resources[2].manifest),
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
  if (inserted.rowCount === 1) {
    for (const resource of resources)
      await insertInteractionResource(client, interaction.decision, resource);
    return true;
  }
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
    if (planningIntent === undefined)
      await client.query(
        `DELETE FROM selector_planning_intent WHERE tenant=$1 AND project=$2`,
        [interaction.partition.tenant, interaction.partition.project],
      );
    else
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

async function readPlanningIntent(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorPlanningIntent | undefined> {
  const found = await pool.query<{
    selector_decision: string;
    intent: string;
    updated_at: Date;
  }>(
    `SELECT selector_decision,intent,updated_at FROM selector_planning_intent
       WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        selectorDecision: row.selector_decision,
        intent: JSON.parse(row.intent) as JsonValue,
        updatedAt: row.updated_at.toISOString(),
      };
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
  return Promise.all(
    found.rows.map(async (row): Promise<SelectorInteractionRecord> => ({
      decision: row.selector_decision,
      ordinal: projectRowCounter(row.ordinal, "selector interaction ordinal"),
      partition,
      instructionsVersion: row.instructions_version,
      instructions: row.instructions,
      observedView: await readInteractionResource<
        SelectorInteraction["observedView"]
      >(pool, row.selector_decision, row.observed_view),
      ...(row.observed_token === null
        ? {}
        : {
            observedToken: JSON.parse(row.observed_token) as NonNullable<
              SelectorInteraction["observedToken"]
            >,
          }),
      context: await readInteractionResource<SelectorInteraction["context"]>(
        pool,
        row.selector_decision,
        row.context,
      ),
      toolActivity: await readInteractionResource<readonly JsonValue[]>(
        pool,
        row.selector_decision,
        row.tool_activity,
      ),
      result: JSON.parse(row.result) as JsonValue,
      implementationRevision: row.implementation_revision,
      modelRevision: row.model_revision,
      policyRevision: row.policy_revision,
      accounting: JSON.parse(row.accounting) as JsonValue,
      startedAt: row.started_at.toISOString(),
      completedAt: row.completed_at.toISOString(),
    })),
  );
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
    planningIntent: (partition) => readPlanningIntent(pool, partition),
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
