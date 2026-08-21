import type pg from "pg";
import { createHash } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import * as z from "zod";

import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  type Authority,
} from "../../interpreter/operationInbox.ts";
import type {
  JsonValue,
  SelectorDelivery,
  SelectorCandidateScan,
  SelectorInteraction,
  SelectorInteractionRecord,
  SelectorProposal,
  SelectorPlanningIntent,
  SelectorProjectState,
  SelectorReviewFeedback,
  SelectorPolicyControls,
  SelectorRuntimeControlStore,
  SelectorRuntimeSettings,
  SelectorObservation,
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
import {
  finalizationPricingSchema,
  reworkPolicySchema,
  stageSchema,
} from "../../generated/model-api.ts";
import { asTicketId } from "../../domain/ids.ts";
import type { SelectorProposalReviewStore } from "../../interpreter/selectorReview.ts";

const jsonValueSchema: z.ZodType<JsonValue> = z.json();
const dispatchViewTokenSchema = z
  .object({
    tenant: z.string().min(1).transform(asTenantId),
    project: z.string().min(1).transform(asProjectId),
    recoveryEpoch: z.string().min(1).max(256),
    schemaVersion: z.literal(1),
    watermark: z.number().int().safe().nonnegative(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .readonly();
const dispatchCandidateSchema = z
  .object({
    ticket: z.number().int().safe().positive().transform(asTicketId),
    ticketVersion: z.number().int().safe().positive(),
    dependencies: z.array(z.number().int().safe().positive()).readonly(),
    workFanout: z.number().int().safe().positive(),
    program: z.array(stageSchema).readonly(),
    reworkPolicy: reworkPolicySchema,
    finalizationPricing: finalizationPricingSchema,
    resumePricing: z.enum(["RetryCharged", "RetryFree"]),
    finalizer: z.enum(["NoFinalizer", "ManagedFinalizer"]),
    configurationRevision: z.string(),
    configurationDigest: z.string(),
    configurationCanonical: z.string(),
  })
  .readonly();
const selectorContextSchema = z
  .object({
    operationalContext: z
      .object({
        observedAt: z.iso.datetime(),
        observedAtEpochMs: z.number().int().safe().nonnegative(),
        reviewFeedback: z
          .array(
            z
              .object({
                ordinal: z.number().int().safe().nonnegative(),
                selectorDecision: z.string(),
                outcome: z.enum(["Approved", "Rejected"]),
                reviewer: z.object({
                  kind: z.string().transform(asAuthorityKind),
                  subject: z.string().transform(asAuthoritySubject),
                }),
                feedback: z.string().optional(),
                reviewedAt: z.iso.datetime(),
              })
              .transform(({ feedback, ...value }) =>
                feedback === undefined ? value : { ...value, feedback },
              ),
          )
          .readonly(),
        activeWork: z
          .array(
            z.object({
              ticket: z.number().int().safe().positive().transform(asTicketId),
              queuedTasks: z.number().int().safe().nonnegative(),
              admittedTasks: z.number().int().safe().nonnegative(),
              runningAttempts: z.number().int().safe().nonnegative(),
            }),
          )
          .readonly(),
        projectCapacity: z.object({
          account: z.string(),
          allocated: z.number().int().safe().nonnegative(),
          limit: z.number().int().safe().nonnegative(),
          available: z.number().int().safe().nonnegative(),
        }),
        clusterCapacity: z.object({
          visibility: z.literal("AuthorizedAggregate"),
          allocated: z.number().int().safe().nonnegative(),
          limit: z.number().int().safe().nonnegative(),
          available: z.number().int().safe().nonnegative(),
          pressure: z.enum(["Normal", "Constrained", "Exhausted", "Unknown"]),
        }),
        executionBacklog: z.object({
          queued: z.number().int().safe().nonnegative(),
          ceiling: z.number().int().safe().nonnegative(),
          dispatchAllowed: z.boolean(),
        }),
      })
      .readonly(),
    workingMemory: jsonValueSchema,
  })
  .readonly();
const interactionResourceManifestSchema = z
  .object({
    kind: z.enum(["ObservedView", "Context", "ToolActivity"]),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().safe().nonnegative(),
    chunks: z.number().int().safe().positive(),
  })
  .readonly();
const selectorPolicyControlsSchema: z.ZodType<SelectorPolicyControls> = z
  .object({
    modelAllowlist: z.array(z.string()).readonly(),
    toolAllowlist: z.array(z.string()).readonly(),
    limits: z
      .object({
        tokensPerDecision: z.number().int().safe(),
        millisecondsPerDecision: z.number().int().safe(),
        toolCallsPerDecision: z.number().int().safe(),
        inputBytesPerDecision: z.number().int().safe(),
        candidatePagesPerDecision: z.number().int().safe(),
        concurrentDecisions: z.number().int().safe(),
        selectionsPerMinute: z.number().int().safe(),
      })
      .readonly(),
    operationalContextMaxAgeMs: z.number().int().safe(),
  })
  .readonly();

function decoded<T>(text: string, schema: z.ZodType<T>, what: string): T {
  try {
    return schema.parse(JSON.parse(text) as unknown);
  } catch (error) {
    throw new TypeError(`${what} is malformed`, { cause: error });
  }
}

async function allocateAttempt(
  pool: pg.Pool,
  attempt: string,
  partition: Partition,
  limits: {
    readonly concurrentDecisions: number;
    readonly selectionsPerMinute: number;
  },
): Promise<boolean> {
  const found = await pool.query<{ allocated: boolean }>(
    sql`SELECT allocate_selector_attempt(
      ${attempt},${partition.tenant},${partition.project},
      ${limits.concurrentDecisions},${limits.selectionsPerMinute}) AS allocated`,
  );
  return found.rows[0]?.allocated ?? false;
}

async function runningAttempt(
  pool: pg.Pool,
  attempt: string,
  observation: SelectorObservation,
  settingsRevision: number,
): Promise<void> {
  const encoded = encode(observation);
  const digest = createHash("sha256").update(encoded).digest("hex");
  await postgresTransaction(pool, async (client) => {
    const inserted = await client.query(
      sql`INSERT INTO selector_observation (attempt,observation,manifest_digest)
       VALUES (${attempt},${encoded},${digest}) ON CONFLICT (attempt) DO NOTHING`,
    );
    if (inserted.rowCount === 0) {
      const same = await client.query(
        sql`SELECT 1 FROM selector_observation
         WHERE attempt=${attempt} AND observation=${encoded} AND manifest_digest=${digest}`,
      );
      if (same.rowCount !== 1)
        throw new Error("selector attempt observation identity conflicts");
    }
    await client.query(
      sql`UPDATE selector_attempt SET settings_revision=${settingsRevision},observation_digest=${digest}
       WHERE attempt=${attempt} AND state='Starting'`,
    );
    const advanced = await client.query<{ advanced: boolean }>(
      sql`SELECT advance_selector_attempt(${attempt},'Running',NULL) AS advanced`,
    );
    if (!(advanced.rows[0]?.advanced ?? false)) {
      const same = await client.query(
        sql`SELECT 1 FROM selector_attempt
         WHERE attempt=${attempt} AND state='Running' AND settings_revision=${settingsRevision}
           AND observation_digest=${digest}`,
      );
      if (same.rowCount !== 1)
        throw new Error("selector attempt cannot enter Running");
    }
  });
}

async function advanceAttempt(
  pool: pg.Pool,
  attempt: string,
  transition: "Quarantined" | "Terminated",
  evidence?: string,
): Promise<void> {
  const found = await pool.query<{ advanced: boolean }>(
    sql`SELECT advance_selector_attempt(${attempt},${transition},${evidence ?? null}) AS advanced`,
  );
  if (!(found.rows[0]?.advanced ?? false))
    throw new Error(`selector attempt cannot enter ${transition}`);
}

async function quarantinedAttempts(
  pool: pg.Pool,
  limit: number,
): Promise<readonly string[]> {
  checkedSelectorLimit(limit, "selector attempt reconciliation");
  const found = await pool.query<{ attempt: string }>(
    sql`SELECT attempt FROM selector_attempt
     WHERE state IN ('Starting','Running','Terminating','Quarantined')
     ORDER BY updated_at,attempt LIMIT ${limit}`,
  );
  return found.rows.map((row) => row.attempt);
}

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
      sql`INSERT INTO selector_interaction_resource
       (selector_decision,kind,ordinal,digest,byte_length,chunk_count,content)
       VALUES (${decision},${resource.manifest.kind},${ordinal},${resource.manifest.digest},
               ${resource.manifest.bytes},${resource.manifest.chunks},${content})`,
    );
}

async function readInteractionResource<T>(
  pool: pg.Pool,
  decision: string,
  manifestText: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const manifest = decoded(
    manifestText,
    interactionResourceManifestSchema,
    "selector interaction resource manifest",
  );
  const found = await pool.query<{
    ordinal: string;
    digest: string;
    byte_length: string;
    chunk_count: string;
    content: string;
  }>(
    sql`SELECT ordinal::text,digest,byte_length::text,chunk_count::text,content
       FROM selector_interaction_resource
       WHERE selector_decision=${decision} AND kind=${manifest.kind} ORDER BY ordinal`,
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
  return decoded(
    bytes.toString("utf8"),
    schema,
    "selector interaction resource",
  );
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
  const controls = decoded(
    row.controls,
    selectorPolicyControlsSchema,
    "selector policy controls",
  );
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
    sql`SELECT revision::text,mode,dispatch_mode,base_prompt,controls
          FROM selector_runtime_settings WHERE singleton=1`,
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
    sql`SELECT revision::text,mode,dispatch_mode,base_prompt,controls
       FROM update_selector_runtime_settings(
         ${expectedRevision},${"mode" in update ? update.mode : null},
         ${"dispatchMode" in update ? update.dispatchMode : null},
         ${"basePrompt" in update ? update.basePrompt : null},
         ${"controls" in update ? encode(checkedPolicyControls(update.controls)) : null},
         ${administrator.kind},${administrator.subject})`,
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
    sql`SELECT revision::text,mode,dispatch_mode,base_prompt,controls,
       administrator_kind,administrator_subject,recorded_at
     FROM selector_runtime_settings_history WHERE revision>${afterRevision}
     ORDER BY revision LIMIT ${limit}`,
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
    sql`SELECT mode,dispatch_mode,base_prompt,controls
          FROM selector_runtime_settings_history WHERE revision=${targetRevision}`,
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
      controls: decoded(
        target.controls,
        selectorPolicyControlsSchema,
        "selector policy controls",
      ),
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
        sql`SELECT state,count(*)::text FROM selector_proposal_delivery
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
    candidate_scan_state: "Unstarted" | "Continue" | "Exhausted";
    candidate_scan_exhausted_token: string | null;
  }>(
    sql`SELECT notification_cursor::text,revision::text,recovery_epoch,attention,working_memory,
       candidate_scan_token,candidate_scan_after::text,candidate_scan_state,
       candidate_scan_exhausted_token
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
        revision: projectRowCounter(row.revision, "selector state revision"),
        ...(row.recovery_epoch === null
          ? {}
          : { recoveryEpoch: row.recovery_epoch }),
        attention: row.attention,
        workingMemory: decoded(
          row.working_memory,
          jsonValueSchema,
          "selector working memory",
        ),
        candidateScan: candidateScanOf(row),
      };
}

function candidateScanOf(row: {
  readonly candidate_scan_state: "Unstarted" | "Continue" | "Exhausted";
  readonly candidate_scan_token: string | null;
  readonly candidate_scan_after: string | null;
  readonly candidate_scan_exhausted_token: string | null;
}): SelectorCandidateScan {
  if (row.candidate_scan_state === "Unstarted") return { state: "Unstarted" };
  if (row.candidate_scan_state === "Exhausted") {
    if (row.candidate_scan_exhausted_token === null)
      throw new Error("selector exhausted scan has no view token");
    return {
      state: "Exhausted",
      token: decoded(
        row.candidate_scan_exhausted_token,
        dispatchViewTokenSchema,
        "selector exhausted scan token",
      ),
    };
  }
  if (row.candidate_scan_token === null || row.candidate_scan_after === null)
    throw new Error("selector continued scan is incomplete");
  return {
    state: "Continue",
    token: decoded(
      row.candidate_scan_token,
      dispatchViewTokenSchema,
      "selector continued scan token",
    ),
    after: projectRowCounter(
      row.candidate_scan_after,
      "selector candidate scan cursor",
    ) as Extract<
      SelectorCandidateScan,
      { readonly state: "Continue" }
    >["after"],
  };
}

async function lockSelectorProject(
  client: pg.PoolClient,
  state: SelectorProjectState,
): Promise<boolean> {
  await client.query(
    sql`INSERT INTO selector_project_state (tenant,project)
       VALUES (${state.partition.tenant},${state.partition.project})
       ON CONFLICT (tenant,project) DO NOTHING`,
  );
  const locked = await client.query<{ revision: string }>(
    sql`SELECT revision::text FROM selector_project_state
       WHERE tenant=${state.partition.tenant} AND project=${state.partition.project}
       FOR UPDATE`,
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
  const scan = state.candidateScan ?? ({ state: "Unstarted" } as const);
  await client.query(
    sql`UPDATE selector_project_state
       SET notification_cursor=${state.notificationCursor},
       recovery_epoch=${state.recoveryEpoch ?? null},attention=${String(state.attention)},
       working_memory=${encode(state.workingMemory)},
       candidate_scan_token=${scan.state === "Continue" ? encode(scan.token) : null},
       candidate_scan_after=${scan.state === "Continue" ? scan.after : null},
       candidate_scan_state=${scan.state},
       candidate_scan_exhausted_token=${scan.state === "Exhausted" ? encode(scan.token) : null},
       revision=revision+1,updated_at=now()
       WHERE tenant=${state.partition.tenant} AND project=${state.partition.project}
         AND revision=${state.revision}`,
  );
}

async function markSubmitted(pool: pg.Pool, decision: string): Promise<void> {
  await pool.query(
    sql`SELECT advance_selector_delivery(${decision},'Submitted',NULL)`,
  );
}

async function submittedDeliveries(
  pool: pg.Pool,
  limit: number,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector reconciliation");
  const found = await pool.query<DeliveryRow>(
    sql`SELECT selector_decision,tenant,project,operation,command,attempts::text
       FROM claim_selector_proposal_reconciliation(${limit})`,
  );
  return found.rows.map(deliveryOf);
}

async function pendingDeliveries(
  pool: pg.Pool,
  limit: number,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector delivery");
  const found = await pool.query<DeliveryRow>(
    sql`SELECT selector_decision,tenant,project,operation,command,attempts::text
       FROM claim_selector_deliveries(${limit})`,
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
    sql`SELECT selector_decision,tenant,project,operation,command,attempts::text
     FROM selector_proposal_delivery
     WHERE tenant=${partition.tenant} AND project=${partition.project}
       AND state='AwaitingApproval'
     ORDER BY selector_decision LIMIT ${limit}`,
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
    sql`SELECT selector_decision,ordinal::text,outcome AS review_outcome,
       reviewer_kind,reviewer_subject,feedback AS review_feedback,reviewed_at
       FROM selector_proposal_review
     WHERE tenant=${partition.tenant} AND project=${partition.project}
       AND ordinal>${after ?? 0} ORDER BY ordinal LIMIT ${limit}`,
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

async function writeInventoryCursor(
  pool: pg.Pool,
  cursor: Partition | undefined,
): Promise<void> {
  await pool.query(
    sql`UPDATE selector_inventory_state
          SET tenant=${cursor?.tenant ?? null},project=${cursor?.project ?? null}
        WHERE singleton=1`,
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
    sql`INSERT INTO selector_interaction
     (selector_decision,tenant,project,instructions_version,instructions,observed_view,observed_token,
      context,tool_activity,result,implementation_revision,model_revision,policy_revision,
      accounting,started_at,completed_at)
     VALUES (${values[0]},${values[1]},${values[2]},${values[3]},${values[4]},
             ${values[5]},${values[6]},${values[7]},${values[8]},${values[9]},
             ${values[10]},${values[11]},${values[12]},${values[13]},
             ${values[14]}::timestamptz,${values[15]}::timestamptz)
     ON CONFLICT (selector_decision) DO NOTHING RETURNING selector_decision`,
  );
  if (inserted.rowCount === 1) {
    for (const resource of resources)
      await insertInteractionResource(client, interaction.decision, resource);
    return true;
  }
  const same = await client.query(
    sql`SELECT 1 FROM selector_interaction WHERE selector_decision=${values[0]}
     AND tenant=${values[1]} AND project=${values[2]}
     AND instructions_version=${values[3]} AND instructions=${values[4]}
     AND observed_view=${values[5]} AND observed_token IS NOT DISTINCT FROM ${values[6]}
     AND context=${values[7]} AND tool_activity=${values[8]} AND result=${values[9]}
     AND implementation_revision=${values[10]} AND model_revision=${values[11]}
     AND policy_revision=${values[12]} AND accounting=${values[13]}
     AND started_at=${values[14]}::timestamptz AND completed_at=${values[15]}::timestamptz`,
  );
  if (same.rowCount !== 1)
    throw new Error(
      "selector decision identity conflicts with retained interaction",
    );
  return false;
}

async function completeSelectorAttempt(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
): Promise<void> {
  const retained = await client.query<{ state: string }>(
    sql`SELECT state FROM selector_attempt WHERE attempt=${interaction.decision} FOR UPDATE`,
  );
  const state = retained.rows[0]?.state;
  if (state === undefined) {
    await client.query(
      sql`INSERT INTO selector_attempt
       (attempt,tenant,project,state,settings_revision,terminal_evidence)
       VALUES (${interaction.decision},${interaction.partition.tenant},
               ${interaction.partition.project},'Completed',
               ${Number(interaction.instructionsVersion)},'recorded trusted interaction')`,
    );
    await client.query(
      sql`INSERT INTO selector_decision_permit (attempt,released_at)
       VALUES (${interaction.decision},now())`,
    );
    return;
  }
  if (state === "Completed") return;
  if (state !== "Running")
    throw new Error("selector interaction requires a completed attempt");
  const completed = await client.query<{ advanced: boolean }>(
    sql`SELECT advance_selector_attempt(
      ${interaction.decision},'Completed','policy execution and capability calls completed') AS advanced`,
  );
  if (!(completed.rows[0]?.advanced ?? false))
    throw new Error("selector attempt cannot enter Completed");
}

async function replacePlanningIntent(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
  planningIntent: unknown,
): Promise<void> {
  if (planningIntent === undefined) {
    await client.query(
      sql`DELETE FROM selector_planning_intent
          WHERE tenant=${interaction.partition.tenant}
            AND project=${interaction.partition.project}`,
    );
    return;
  }
  await client.query(
    sql`INSERT INTO selector_planning_intent (tenant,project,selector_decision,intent)
     VALUES (${interaction.partition.tenant},${interaction.partition.project},
             ${interaction.decision},${encode(planningIntent)})
     ON CONFLICT (tenant,project) DO UPDATE SET
     selector_decision=EXCLUDED.selector_decision,intent=EXCLUDED.intent,updated_at=now()`,
  );
}

async function insertSelectorProposal(
  client: pg.PoolClient,
  proposal: SelectorProposal | undefined,
): Promise<boolean> {
  if (proposal === undefined) return true;
  const interaction = proposal.interaction;
  const inserted = await client.query(
    sql`INSERT INTO selector_proposal_delivery
     (selector_decision,tenant,project,operation,command,state)
     VALUES (${interaction.decision},${interaction.partition.tenant},
             ${interaction.partition.project},${proposal.operation},
             ${encode(proposal.command)},
             ${proposal.deliveryMode === "Automatic" ? "Pending" : "AwaitingApproval"})
     ON CONFLICT (selector_decision) DO NOTHING`,
  );
  return inserted.rowCount === 1;
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
    await completeSelectorAttempt(client, interaction);
    if (!(await insertSelectorInteraction(client, interaction))) return false;
    await replacePlanningIntent(client, interaction, planningIntent);
    const proposalRecorded = await insertSelectorProposal(client, proposal);
    await writeSelectorProject(client, state);
    return proposalRecorded;
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
    sql`SELECT selector_decision,intent,updated_at FROM selector_planning_intent
       WHERE tenant=${partition.tenant} AND project=${partition.project}`,
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        selectorDecision: row.selector_decision,
        intent: decoded(
          row.intent,
          jsonValueSchema,
          "selector planning intent",
        ),
        updatedAt: row.updated_at.toISOString(),
      };
}

interface SelectorInteractionRow {
  readonly selector_decision: string;
  readonly ordinal: string;
  readonly instructions_version: string;
  readonly instructions: string;
  readonly observed_view: string;
  readonly observed_token: string | null;
  readonly context: string;
  readonly tool_activity: string;
  readonly result: string;
  readonly implementation_revision: string;
  readonly model_revision: string;
  readonly policy_revision: string;
  readonly accounting: string;
  readonly started_at: Date;
  readonly completed_at: Date;
}

async function selectorInteractionOf(
  pool: pg.Pool,
  partition: Partition,
  row: SelectorInteractionRow,
): Promise<SelectorInteractionRecord> {
  return {
    decision: row.selector_decision,
    ordinal: projectRowCounter(row.ordinal, "selector interaction ordinal"),
    partition,
    instructionsVersion: row.instructions_version,
    instructions: row.instructions,
    observedView: await readInteractionResource(
      pool,
      row.selector_decision,
      row.observed_view,
      z.array(dispatchCandidateSchema).readonly(),
    ),
    ...(row.observed_token === null
      ? {}
      : {
          observedToken: decoded(
            row.observed_token,
            dispatchViewTokenSchema,
            "selector observed token",
          ),
        }),
    context: await readInteractionResource<SelectorInteraction["context"]>(
      pool,
      row.selector_decision,
      row.context,
      selectorContextSchema,
    ),
    toolActivity: await readInteractionResource(
      pool,
      row.selector_decision,
      row.tool_activity,
      z.array(jsonValueSchema).readonly(),
    ),
    result: decoded(row.result, jsonValueSchema, "selector result"),
    implementationRevision: row.implementation_revision,
    modelRevision: row.model_revision,
    policyRevision: row.policy_revision,
    accounting: decoded(row.accounting, jsonValueSchema, "selector accounting"),
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at.toISOString(),
  };
}

async function readSelectorHistory(
  pool: pg.Pool,
  partition: Partition,
  after: number | undefined,
  limit: number,
): Promise<readonly SelectorInteractionRecord[]> {
  checkedSelectorLimit(limit, "selector history");
  const found = await pool.query<SelectorInteractionRow>(
    sql`SELECT selector_decision,ordinal::text,instructions_version,instructions,observed_view,
       observed_token,context,tool_activity,result,implementation_revision,model_revision,
       policy_revision,accounting,started_at,completed_at
       FROM selector_interaction WHERE tenant=${partition.tenant}
         AND project=${partition.project} AND ordinal>${after ?? 0}
       ORDER BY ordinal LIMIT ${limit}`,
  );
  return Promise.all(
    found.rows.map((row) => selectorInteractionOf(pool, partition, row)),
  );
}

export function postgresSelectorState(pool: pg.Pool): SelectorStateStore {
  return {
    setAutomaticReadiness: async (ready) => {
      await pool.query(sql`SELECT set_selector_host_readiness(${ready})`);
    },
    allocateAttempt: (attempt, partition, limits) =>
      allocateAttempt(pool, attempt, partition, limits),
    runningAttempt: (attempt, observation, settingsRevision) =>
      runningAttempt(pool, attempt, observation, settingsRevision),
    quarantineAttempt: (attempt) =>
      advanceAttempt(pool, attempt, "Quarantined"),
    terminateAttempt: (attempt, evidence) =>
      advanceAttempt(pool, attempt, "Terminated", evidence),
    quarantinedAttempts: (limit) => quarantinedAttempts(pool, limit),
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
        sql`SELECT advance_selector_delivery(${decision},'Terminal',${encode(outcome)})`,
      );
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
        sql`SELECT review_selector_proposal(
          ${decision},${partition.tenant},${partition.project},'Approved',
          ${reviewer.kind},${reviewer.subject},${feedback ?? null}) AS changed`,
      );
      return changed.rows[0]?.changed ?? false;
    },
    reject: async (partition, decision, reviewer, feedback) => {
      const changed = await pool.query<{ changed: boolean }>(
        sql`SELECT review_selector_proposal(
          ${decision},${partition.tenant},${partition.project},'Rejected',
          ${reviewer.kind},${reviewer.subject},${feedback ?? null}) AS changed`,
      );
      return changed.rows[0]?.changed ?? false;
    },
    reviewFeedback: (partition, after, limit) =>
      readReviewFeedback(pool, partition, after, limit),
  };
}
