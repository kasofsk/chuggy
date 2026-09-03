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
  SelectorDeliveryRecord,
  SelectorCandidateScan,
  SelectorInteraction,
  SelectorInteractionRecord,
  SelectorDecisionProposals,
  SelectorPlanningIntent,
  SelectorProjectState,
  SelectorReviewFeedback,
  SelectorPolicyControls,
  SelectorProjectLimitOverrides,
  SelectorProjectOverrides,
  SelectorRuntimeControlStore,
  SelectorRuntimeSettings,
  SelectorObservation,
  SelectorSettingsFence,
  SelectorSettingsUpdate,
  SelectorSettingsRevision,
  SelectorStateStore,
} from "../../interpreter/selector.ts";
import {
  dispatchesPerDecisionUnstated,
  leadDispatchesMax,
  resolvedSelectorSettings,
} from "../../interpreter/selector.ts";
import type {
  SelectorProjectSettingsRecord,
  SelectorProjectSettingsRefusal,
  SelectorProjectSettingsRevision,
  SelectorProjectSettingsStore,
  SelectorProjectSettingsWriteOutcome,
} from "../../interpreter/selectorProjectSettings.ts";
import { selectorAutomaticReadinessErrorCode } from "./schema.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { notificationSchema } from "../../contract/responses.ts";
import { selectorDeliveryStates } from "../../contract/rosters.ts";
import type { ProjectNotification } from "../../interpreter/notifications.ts";
import { parseTicketCommand } from "../../interpreter/wire.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import { sessionRowText } from "./sessionRows.ts";
import {
  finalizationPricingSchema,
  reworkPolicySchema,
  stageSchema,
} from "../../generated/model-api.ts";
import { asTicketId } from "../../domain/ids.ts";
import type { SelectorProposalReviewStore } from "../../interpreter/selectorReview.ts";

const jsonValueSchema: z.ZodType<JsonValue> = z.json();
const reviewFeedbackSchema = z
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
  );
const legacyOperationalContextSchema = z
  .object({
    observedAt: z.iso.datetime(),
    observedAtEpochMs: z.number().int().safe().nonnegative(),
    reviewFeedback: z.array(reviewFeedbackSchema),
    activeWork: z.array(
      z.object({
        ticket: z.number().int().safe().positive().transform(asTicketId),
        queuedTasks: z.number().int().safe().nonnegative(),
        admittedTasks: z.number().int().safe().nonnegative(),
        runningAttempts: z.number().int().safe().nonnegative(),
      }),
    ),
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
  .transform((value) => ({ ...value, version: 1 as const }));
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
/**
 * One decision's delivery rows as the interaction read aggregates them. The
 * outcome is the text column the settlement wrote, parsed here rather than in
 * the aggregate, so a row the reader cannot speak for is one decision's
 * problem and not the page's.
 */
const selectorDeliveryRecordsSchema: z.ZodType<
  readonly SelectorDeliveryRecord[]
> = z
  .array(
    z.object({
      ticket: z.number().int().safe().positive().transform(asTicketId),
      state: z.enum(selectorDeliveryStates),
      outcome: z.string().nullable(),
    }),
  )
  .transform((rows) =>
    rows.map((row) => ({
      ticket: row.ticket,
      state: row.state,
      ...(row.outcome === null
        ? {}
        : {
            outcome: decoded(row.outcome, jsonValueSchema, "delivery outcome"),
          }),
    })),
  );

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
const selectorOperationalContextSchema = z.union([
  legacyOperationalContextSchema,
  z
    .object({
      version: z.literal(2),
      observedAt: z.iso.datetime(),
      observedAtEpochMs: z.number().int().safe().nonnegative(),
      reviewFeedback: z.array(reviewFeedbackSchema).readonly(),
      activeWork: z.object({
        queued: z.number().int().safe().nonnegative(),
        admitted: z.number().int().safe().nonnegative(),
        launching: z.number().int().safe().nonnegative(),
        running: z.number().int().safe().nonnegative(),
      }),
      capacity: z.object({
        account: z.string(),
        accountMaximum: z.number().int().safe().nonnegative(),
        accountActive: z.number().int().safe().nonnegative(),
        accountReservationDeficit: z.number().int().safe().nonnegative(),
        clusterSlotsMax: z.number().int().safe().nonnegative(),
        clusterActive: z.number().int().safe().nonnegative(),
      }),
      backlog: z.object({
        project: z.object({
          queued: z.number().int().safe().nonnegative(),
          ceiling: z.number().int().safe().positive(),
        }),
        installation: z.object({
          queued: z.number().int().safe().nonnegative(),
          ceiling: z.number().int().safe().positive(),
        }),
      }),
    })
    .readonly(),
]);

/** One retained change row, its absent members absent rather than undefined. */
function retainedChange(
  change: z.infer<typeof notificationSchema>,
): ProjectNotification {
  return {
    ordinal: change.ordinal,
    kind: change.kind,
    resource: change.resource,
    ...(change.projectSequence === undefined
      ? {}
      : { projectSequence: change.projectSequence }),
    ...(change.authoringVersion === undefined
      ? {}
      : { authoringVersion: change.authoringVersion }),
  };
}

/**
 * A retained policy input under exactly one spelling of the note. Two strict
 * alternatives are what say a row carrying neither, or both, is a row that is
 * not intact — which is the whole of what this parser is relied on to say.
 */
const selectorContextSchema = z.union([
  z
    .strictObject({
      operationalContext: selectorOperationalContextSchema,
      handoffNote: jsonValueSchema,
      changes: z.array(notificationSchema).readonly().optional(),
    })
    .readonly()
    .transform((value): SelectorInteraction["context"] => ({
      operationalContext: value.operationalContext,
      handoffNote: value.handoffNote,
      ...(value.changes === undefined
        ? {}
        : { changes: value.changes.map(retainedChange) }),
    })),
  z
    .strictObject({
      operationalContext: selectorOperationalContextSchema,
      workingMemory: jsonValueSchema,
    })
    .readonly()
    .transform((value): SelectorInteraction["context"] => ({
      operationalContext: value.operationalContext,
      handoffNote: value.workingMemory,
    })),
]);

/** Parses current and retained historical selector policy inputs. */
export function parseSelectorInteractionContext(
  value: unknown,
): SelectorInteraction["context"] {
  return selectorContextSchema.parse(value);
}
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
        dispatchesPerDecision: z
          .number()
          .int()
          .safe()
          .default(dispatchesPerDecisionUnstated),
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
    readonly millisecondsPerDecision: number;
  },
): Promise<boolean> {
  const found = await pool.query<{ allocated: boolean | null }>(
    sql`SELECT allocate_selector_attempt(
      ${attempt},${partition.tenant},${partition.project},
      ${limits.concurrentDecisions},${limits.selectionsPerMinute},
      ${limits.millisecondsPerDecision})::boolean AS allocated`,
  );
  return found.rows[0]?.allocated ?? false;
}

async function runningAttempt(
  pool: pg.Pool,
  attempt: string,
  observation: SelectorObservation,
  fence: SelectorSettingsFence,
): Promise<void> {
  const encoded = encode(observation);
  const digest = createHash("sha256").update(encoded).digest("hex");
  await postgresTransaction(pool, async (client) => {
    const inserted = await client.query(
      sql`INSERT INTO selector_observation (attempt,observation,manifest_digest)
       VALUES (${attempt},${encoded},${digest}) ON CONFLICT (attempt) DO NOTHING`,
    );
    if (inserted.rowCount === 0) {
      const same = await client.query<{ "?column?": number }>(
        sql`SELECT 1 FROM selector_observation
         WHERE attempt=${attempt} AND observation=${encoded} AND manifest_digest=${digest}`,
      );
      if (same.rowCount !== 1)
        throw new Error("selector attempt observation identity conflicts");
    }
    await client.query(
      sql`UPDATE selector_attempt SET settings_revision=${checkedSelectorFence(fence).settingsRevision},
         project_settings_revision=${fence.projectSettingsRevision},
         observation_digest=${digest}
       WHERE attempt=${attempt} AND state='Starting'`,
    );
    const advanced = await client.query<{ advanced: boolean | null }>(
      sql`SELECT advance_selector_attempt(${attempt},'Running',NULL)::boolean AS advanced`,
    );
    if (!(advanced.rows[0]?.advanced ?? false)) {
      const same = await client.query<{ "?column?": number }>(
        sql`SELECT 1 FROM selector_attempt
         WHERE attempt=${attempt} AND state='Running'
           AND settings_revision=${fence.settingsRevision}
           AND project_settings_revision=${fence.projectSettingsRevision}
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
  const found = await pool.query<{ advanced: boolean | null }>(
    sql`SELECT advance_selector_attempt(${attempt},${transition},${evidence ?? null})::boolean AS advanced`,
  );
  if (!(found.rows[0]?.advanced ?? false))
    throw new Error(`selector attempt cannot enter ${transition}`);
}

async function quarantinedAttempts(
  pool: pg.Pool,
  limit: number,
): Promise<readonly string[]> {
  checkedSelectorLimit(limit, "selector attempt reconciliation");
  const found = await pool.query<{ attempt: string | null }>(
    sql`SELECT attempt FROM claim_selector_attempt_reconciliation(${limit})`,
  );
  return found.rows.map((row) => {
    if (row.attempt === null)
      throw new Error("selector attempt reconciliation returned no identity");
    return row.attempt;
  });
}

interface DeliveryRow {
  readonly selector_decision: string | null;
  readonly ticket: string | null;
  readonly tenant: string | null;
  readonly project: string | null;
  readonly operation: string | null;
  readonly command: string | null;
  readonly attempts: string | null;
}

type CompleteDeliveryRow = { readonly [Key in keyof DeliveryRow]: string };

/**
 * One delivery row as a delivery. The row's key and the command it stores each
 * name a ticket and the two are compared rather than one being believed: they
 * are written from one value and the rekeying backfilled one from the other, so
 * a row where they differ is a row whose key and whose payload disagree — and
 * submitting it would settle a sibling of the row it came from.
 */
function deliveryOf(row: DeliveryRow): SelectorDelivery {
  if (
    row.selector_decision === null ||
    row.ticket === null ||
    row.tenant === null ||
    row.project === null ||
    row.operation === null ||
    row.command === null ||
    row.attempts === null
  )
    throw new Error("selector delivery row is incomplete");
  const parsed = parseTicketCommand(row.command);
  if (parsed.parsed === "Refused" || parsed.value.command !== "ProposeDispatch")
    throw new Error("selector delivery contains an unreadable proposal");
  if (Number(row.ticket) !== parsed.value.ticket)
    throw new Error(
      "selector delivery is keyed by a ticket its command does not dispatch",
    );
  return {
    decision: row.selector_decision,
    ticket: parsed.value.ticket,
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

/**
 * Reassembles one resource from the chunks a reader holds and refuses any that
 * does not answer its manifest. The chunk count, the reassembled length and
 * the reassembled digest are the whole of what a manifest promises, so a
 * caller that read the chunks another way is held to the same three.
 */
export function selectorInteractionResource<T>(
  manifestText: string,
  chunks: readonly string[],
  schema: z.ZodType<T>,
): T {
  const manifest = decoded(
    manifestText,
    interactionResourceManifestSchema,
    "selector interaction resource manifest",
  );
  if (chunks.length !== manifest.chunks)
    throw new Error("selector interaction resource manifest is incomplete");
  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk, "base64")),
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

/**
 * One resource's chunks in the order they were written, over the selector's
 * own grant on the relation. A gap in the ordinals is a resource the reader
 * cannot reassemble, and what the reassembly itself answers for is the
 * manifest's count, length and digest.
 */
async function readInteractionChunks(
  pool: pg.Pool,
  decision: string,
  kind: InteractionResourceKind,
): Promise<readonly string[]> {
  const resourceKind: string = kind;
  const found = await pool.query<{ ordinal: string; content: string }>(
    sql`SELECT ordinal::text,content
       FROM selector_interaction_resource
       WHERE selector_decision=${decision} AND kind=${resourceKind} ORDER BY ordinal`,
  );
  if (
    found.rows.some(
      (row, ordinal) =>
        projectRowCounter(row.ordinal, "selector resource ordinal") !== ordinal,
    )
  )
    throw new Error("selector interaction resource manifest is incomplete");
  return found.rows.map((row) => row.content);
}

/**
 * Refuses a fence no attempt row could hold. `settings_revision` starts at one
 * and `project_settings_revision` at zero, which is the project that has never
 * overridden anything.
 */
function checkedSelectorFence(
  fence: SelectorSettingsFence,
): SelectorSettingsFence {
  if (
    !Number.isSafeInteger(fence.settingsRevision) ||
    fence.settingsRevision < 1
  )
    throw new RangeError(
      "selector settings revision must be a positive safe integer",
    );
  if (
    !Number.isSafeInteger(fence.projectSettingsRevision) ||
    fence.projectSettingsRevision < 0
  )
    throw new RangeError(
      "selector project settings revision must be a non-negative safe integer",
    );
  return fence;
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

interface SelectorSettingsRow {
  readonly revision: string;
  readonly mode: string;
  readonly dispatch_mode: string;
  readonly base_prompt: string;
  readonly controls: string;
}

function selectorMode(value: string): SelectorRuntimeSettings["mode"] {
  if (value !== "Running" && value !== "Paused")
    throw new TypeError("selector runtime mode is invalid");
  return value;
}

function selectorDispatchMode(
  value: string,
): SelectorRuntimeSettings["dispatchMode"] {
  if (value !== "Automatic" && value !== "ApprovalRequired")
    throw new TypeError("selector dispatch mode is invalid");
  return value;
}

function settingsOf(row: SelectorSettingsRow): SelectorRuntimeSettings {
  const controls = decoded(
    row.controls,
    selectorPolicyControlsSchema,
    "selector policy controls",
  );
  return {
    revision: projectRowCounter(row.revision, "selector settings revision"),
    mode: selectorMode(row.mode),
    dispatchMode: selectorDispatchMode(row.dispatch_mode),
    basePrompt: row.base_prompt,
    ...controls,
  };
}

async function readSettings(pool: pg.Pool): Promise<SelectorRuntimeSettings> {
  const found = await pool.query<SelectorSettingsRow>(
    sql`SELECT revision::text,mode,dispatch_mode,base_prompt,controls
          FROM selector_runtime_settings WHERE singleton=1`,
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new Error("selector runtime settings are absent");
  return settingsOf(row);
}

interface SelectorProjectOverrideRow {
  readonly north_star: string | null;
  readonly mode: string | null;
  readonly dispatch_mode: string | null;
  readonly base_prompt: string | null;
  readonly model_allowlist: string | null;
  readonly tool_allowlist: string | null;
  readonly tokens_per_decision: string | null;
  readonly milliseconds_per_decision: string | null;
  readonly tool_calls_per_decision: string | null;
  readonly dispatches_per_decision: string | null;
  readonly input_bytes_per_decision: string | null;
  readonly candidate_pages_per_decision: string | null;
  readonly operational_context_max_age_ms: string | null;
}

/**
 * One project's override columns beside the installation defaults they fall
 * back to, which is what the read and the write both answer with. The project's
 * revision is NULL for a project that has never overridden anything.
 */
interface SelectorProjectSettingsRow extends SelectorProjectOverrideRow {
  readonly revision: string | null;
  readonly installation_revision: string;
  readonly installation_mode: string;
  readonly installation_dispatch_mode: string;
  readonly installation_base_prompt: string;
  readonly installation_controls: string;
}

/**
 * The same row as the write answers it. Every column a set-returning function
 * declares is nullable to the server, whatever the tables beneath it require,
 * so the installation half is narrowed rather than assumed.
 */
type SelectorProjectSettingsWriteRow = {
  readonly [Key in keyof SelectorProjectSettingsRow]:
    SelectorProjectSettingsRow[Key] | null;
};

function selectorProjectSettingsWritten(
  row: SelectorProjectSettingsWriteRow,
): SelectorProjectSettingsRow {
  const installation = {
    installation_revision: row.installation_revision,
    installation_mode: row.installation_mode,
    installation_dispatch_mode: row.installation_dispatch_mode,
    installation_base_prompt: row.installation_base_prompt,
    installation_controls: row.installation_controls,
  };
  for (const [column, value] of Object.entries(installation))
    if (value === null)
      throw new Error(`selector settings write answered no ${column}`);
  return { ...row, ...(installation as SelectorProjectSettingsRow) };
}

const selectorAllowlistSchema = z.array(z.string()).readonly();

function selectorAllowlist(
  value: string | null,
  what: string,
): readonly string[] | undefined {
  return value === null
    ? undefined
    : decoded(value, selectorAllowlistSchema, what);
}

function selectorOverrideCounter(
  value: string | null,
  what: string,
): number | undefined {
  return value === null ? undefined : projectRowCounter(value, what);
}

/** Reads the override columns, each NULL being a field the project inherits. */
function selectorProjectOverridesOf(
  row: SelectorProjectOverrideRow,
): SelectorProjectOverrides {
  const limits: {
    -readonly [Key in keyof SelectorProjectLimitOverrides]: number;
  } = {};
  const counters = [
    ["tokensPerDecision", row.tokens_per_decision],
    ["millisecondsPerDecision", row.milliseconds_per_decision],
    ["toolCallsPerDecision", row.tool_calls_per_decision],
    ["dispatchesPerDecision", row.dispatches_per_decision],
    ["inputBytesPerDecision", row.input_bytes_per_decision],
    ["candidatePagesPerDecision", row.candidate_pages_per_decision],
  ] as const;
  for (const [name, value] of counters) {
    const counter = selectorOverrideCounter(value, `selector ${name}`);
    if (counter !== undefined) limits[name] = counter;
  }
  const models = selectorAllowlist(
    row.model_allowlist,
    "selector model allowlist",
  );
  const tools = selectorAllowlist(
    row.tool_allowlist,
    "selector tool allowlist",
  );
  const contextMaxAge = selectorOverrideCounter(
    row.operational_context_max_age_ms,
    "selector operationalContextMaxAgeMs",
  );
  return {
    ...(row.north_star === null ? {} : { northStar: row.north_star }),
    ...(row.mode === null ? {} : { mode: selectorMode(row.mode) }),
    ...(row.dispatch_mode === null
      ? {}
      : { dispatchMode: selectorDispatchMode(row.dispatch_mode) }),
    ...(row.base_prompt === null ? {} : { basePrompt: row.base_prompt }),
    ...(models === undefined ? {} : { modelAllowlist: models }),
    ...(tools === undefined ? {} : { toolAllowlist: tools }),
    ...(Object.keys(limits).length === 0 ? {} : { limits }),
    ...(contextMaxAge === undefined
      ? {}
      : { operationalContextMaxAgeMs: contextMaxAge }),
  };
}

/** Builds the record from one row, which carries both halves of the resolution. */
function selectorProjectSettingsRecordOf(
  partition: Partition,
  row: SelectorProjectSettingsRow,
): SelectorProjectSettingsRecord {
  const revision =
    row.revision === null
      ? 0
      : projectRowCounter(row.revision, "selector project settings revision");
  const overrides = selectorProjectOverridesOf(row);
  return {
    partition,
    revision,
    overrides,
    effective: resolvedSelectorSettings(
      partition,
      settingsOf({
        revision: row.installation_revision,
        mode: row.installation_mode,
        dispatch_mode: row.installation_dispatch_mode,
        base_prompt: row.installation_base_prompt,
        controls: row.installation_controls,
      }),
      revision,
      overrides,
    ),
  };
}

/**
 * The installation defaults and one project's overrides in a single statement,
 * so a resolved value is never half of one snapshot and half of another. A
 * project with no row of its own is revision zero, which is the revision its
 * first write expects.
 */
async function readProjectSettings(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorProjectSettingsRecord> {
  const found = await pool.query<SelectorProjectSettingsRow>(
    sql`SELECT overrides.revision::text,overrides.north_star,overrides.mode,
         overrides.dispatch_mode,overrides.base_prompt,
         overrides.model_allowlist,overrides.tool_allowlist,
         overrides.tokens_per_decision::text,
         overrides.milliseconds_per_decision::text,
         overrides.tool_calls_per_decision::text,
         overrides.dispatches_per_decision::text,
         overrides.input_bytes_per_decision::text,
         overrides.candidate_pages_per_decision::text,
         overrides.operational_context_max_age_ms::text,
         installation.revision::text AS installation_revision,
         installation.mode AS installation_mode,
         installation.dispatch_mode AS installation_dispatch_mode,
         installation.base_prompt AS installation_base_prompt,
         installation.controls AS installation_controls
       FROM selector_runtime_settings installation
       LEFT JOIN selector_project_settings overrides
         ON overrides.tenant=${partition.tenant}
        AND overrides.project=${partition.project}
      WHERE installation.singleton=1`,
  );
  const row = found.rows[0];
  if (row === undefined)
    throw new Error("selector runtime settings are absent");
  return selectorProjectSettingsRecordOf(partition, row);
}

/** The SQLSTATE a server refused under, for the refusals that are conditions. */
function postgresFailureCode(failure: unknown): string | undefined {
  if (typeof failure !== "object" || failure === null) return undefined;
  const code = (failure as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The SQLSTATEs a write did not complete under. `query_canceled` is every
 * cancellation a statement can meet, its deadline included, and
 * `deadlock_detected` is the cycle a server broke to let one of its writes
 * through; neither says whose lock was in the way, and both leave a write that
 * can be made again.
 */
const postgresIncompleteWriteCodes: readonly string[] = ["57014", "40P01"];

/**
 * Which refusal a server's own code names, and undefined for a failure that is
 * a fault rather than a condition a caller can act on.
 */
function selectorWriteRefusal(
  failure: unknown,
): SelectorProjectSettingsRefusal | undefined {
  const code = postgresFailureCode(failure);
  if (code === selectorAutomaticReadinessErrorCode)
    return "AutomaticDispatchUnavailable";
  if (code !== undefined && postgresIncompleteWriteCodes.includes(code))
    return "SettingsWriteContended";
  return undefined;
}

/**
 * Writes one project's whole override set and answers with the row that write
 * produced, in a single statement so the answer is that write's own and not a
 * later state of the table.
 */
async function writeProjectSettings(
  pool: pg.Pool,
  partition: Partition,
  expectedRevision: number,
  overrides: SelectorProjectOverrides,
  administrator: Authority,
): Promise<SelectorProjectSettingsWriteOutcome> {
  const limits = overrides.limits ?? {};
  let found;
  try {
    found = await pool.query<SelectorProjectSettingsWriteRow>(
      sql`SELECT revision::text,north_star,mode,dispatch_mode,base_prompt,
           model_allowlist,tool_allowlist,tokens_per_decision::text,
           milliseconds_per_decision::text,tool_calls_per_decision::text,
           dispatches_per_decision::text,
           input_bytes_per_decision::text,candidate_pages_per_decision::text,
           operational_context_max_age_ms::text,installation_revision::text,
           installation_mode,installation_dispatch_mode,installation_base_prompt,
           installation_controls
         FROM update_selector_project_settings(
           ${partition.tenant},${partition.project},${expectedRevision},
           ${overrides.northStar ?? null},${overrides.mode ?? null},
           ${overrides.dispatchMode ?? null},${overrides.basePrompt ?? null},
           ${overrides.modelAllowlist === undefined ? null : encode(overrides.modelAllowlist)},
           ${overrides.toolAllowlist === undefined ? null : encode(overrides.toolAllowlist)},
           ${limits.tokensPerDecision ?? null},
           ${limits.millisecondsPerDecision ?? null},
           ${limits.toolCallsPerDecision ?? null},
           ${limits.dispatchesPerDecision ?? null},
           ${limits.inputBytesPerDecision ?? null},
           ${limits.candidatePagesPerDecision ?? null},
           ${overrides.operationalContextMaxAgeMs ?? null},
           ${administrator.kind},${administrator.subject})`,
    );
  } catch (failure) {
    const refusal = selectorWriteRefusal(failure);
    if (refusal !== undefined) return { written: "Refused", refusal };
    throw failure;
  }
  const row = found.rows[0];
  return row === undefined
    ? { written: "FenceMoved" }
    : {
        written: "Settings",
        settings: selectorProjectSettingsRecordOf(
          partition,
          selectorProjectSettingsWritten(row),
        ),
      };
}

async function projectSettingsHistory(
  pool: pg.Pool,
  partition: Partition,
  afterRevision: number,
  limit: number,
): Promise<readonly SelectorProjectSettingsRevision[]> {
  const found = await pool.query<
    SelectorProjectOverrideRow & {
      revision: string;
      administrator_kind: string;
      administrator_subject: string;
      recorded_at: Date;
    }
  >(
    sql`SELECT history.revision::text,history.north_star,history.mode,
         history.dispatch_mode,history.base_prompt,
         history.model_allowlist,history.tool_allowlist,
         history.tokens_per_decision::text,
         history.milliseconds_per_decision::text,
         history.tool_calls_per_decision::text,
         history.dispatches_per_decision::text,
         history.input_bytes_per_decision::text,
         history.candidate_pages_per_decision::text,
         history.operational_context_max_age_ms::text,
         history.administrator_kind,history.administrator_subject,
         history.recorded_at
       FROM selector_project_settings_history history
      WHERE history.tenant=${partition.tenant}
        AND history.project=${partition.project}
        AND history.revision>${afterRevision}
      ORDER BY history.revision LIMIT ${limit}`,
  );
  return found.rows.map((row) => ({
    revision: projectRowCounter(
      row.revision,
      "selector project settings revision",
    ),
    overrides: selectorProjectOverridesOf(row),
    administrator: {
      kind: asAuthorityKind(row.administrator_kind),
      subject: asAuthoritySubject(row.administrator_subject),
    },
    recordedAt: row.recorded_at.toISOString(),
  }));
}

/** The per-project settings the API administers under a project's own membership. */
export function postgresSelectorProjectSettings(
  pool: pg.Pool,
): SelectorProjectSettingsStore {
  return {
    read: (partition) => readProjectSettings(pool, partition),
    write: (partition, expectedRevision, overrides, administrator) =>
      writeProjectSettings(
        pool,
        partition,
        expectedRevision,
        overrides,
        administrator,
      ),
    history: (partition, afterRevision, limit) =>
      projectSettingsHistory(pool, partition, afterRevision, limit),
  };
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
    revision: string | null;
    mode: string | null;
    dispatch_mode: string | null;
    base_prompt: string | null;
    controls: string | null;
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
  if (
    row !== undefined &&
    row.revision !== null &&
    row.mode !== null &&
    row.dispatch_mode !== null &&
    row.base_prompt !== null &&
    row.controls !== null
  ) {
    return {
      updated: true,
      settings: settingsOf({
        revision: row.revision,
        mode: row.mode,
        dispatch_mode: row.dispatch_mode,
        base_prompt: row.base_prompt,
        controls: row.controls,
      }),
    };
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
    mode: string;
    dispatch_mode: string;
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
    mode: string;
    dispatch_mode: string;
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
      mode: selectorMode(target.mode),
      dispatchMode: selectorDispatchMode(target.dispatch_mode),
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
    projectSettings: async (partition) =>
      (await readProjectSettings(pool, partition)).effective,
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
    /**
     * What a drain is still waiting for, counted in delivery rows rather than
     * decisions: one decision's dispatches settle one at a time, so a decision
     * with a row left is not drained by the sibling that already landed.
     */
    drainStatus: async () => {
      const settings = await readSettings(pool);
      const found = await pool.query<{
        state: string;
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
    attention: string;
    handoff_note: string;
    candidate_scan_token: string | null;
    candidate_scan_after: string | null;
    candidate_scan_state: string;
    candidate_scan_exhausted_token: string | null;
  }>(
    sql`SELECT notification_cursor::text,revision::text,recovery_epoch,attention,handoff_note,
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
        attention: selectorAttention(row.attention),
        handoffNote: decoded(
          row.handoff_note,
          jsonValueSchema,
          "selector handoff note",
        ),
        candidateScan: candidateScanOf({
          ...row,
          candidate_scan_state: selectorCandidateScanState(
            row.candidate_scan_state,
          ),
        }),
      };
}

function selectorAttention(value: string): SelectorProjectState["attention"] {
  if (value !== "Monitoring" && value !== "Attention" && value !== "Stopped")
    throw new TypeError("selector attention state is invalid");
  return value;
}

function selectorCandidateScanState(
  value: string,
): SelectorCandidateScan["state"] {
  if (value !== "Unstarted" && value !== "Continue" && value !== "Exhausted")
    throw new TypeError("selector candidate scan state is invalid");
  return value;
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
       handoff_note=${encode(state.handoffNote)},
       candidate_scan_token=${scan.state === "Continue" ? encode(scan.token) : null},
       candidate_scan_after=${scan.state === "Continue" ? scan.after : null},
       candidate_scan_state=${scan.state},
       candidate_scan_exhausted_token=${scan.state === "Exhausted" ? encode(scan.token) : null},
       revision=revision+1,updated_at=now()
       WHERE tenant=${state.partition.tenant} AND project=${state.partition.project}
         AND revision=${state.revision}`,
  );
}

async function markSubmitted(
  pool: pg.Pool,
  decision: string,
  ticket: number,
): Promise<void> {
  await pool.query<{ advance_selector_delivery: string | null }>(
    sql`SELECT advance_selector_delivery(${decision},${ticket},'Submitted',NULL)::text`,
  );
}

async function submittedDeliveries(
  pool: pg.Pool,
  limit: number,
): Promise<readonly SelectorDelivery[]> {
  checkedSelectorLimit(limit, "selector reconciliation");
  const found = await pool.query<DeliveryRow>(
    sql`SELECT selector_decision,ticket::text,tenant,project,operation,command,
         attempts::text
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
    sql`SELECT selector_decision,ticket::text,tenant,project,operation,command,
         attempts::text
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
  const found = await pool.query<CompleteDeliveryRow>(
    sql`SELECT selector_decision,ticket::text,tenant,project,operation,command,
       attempts::text
     FROM selector_proposal_delivery
     WHERE tenant=${partition.tenant} AND project=${partition.project}
       AND state='AwaitingApproval'
     ORDER BY selector_decision,ticket LIMIT ${limit}`,
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
    review_outcome: string;
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
    outcome:
      row.review_outcome === "Approved" || row.review_outcome === "Rejected"
        ? row.review_outcome
        : (() => {
            throw new TypeError("selector review outcome is invalid");
          })(),
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

function selectorInteractionStorage(interaction: SelectorInteraction) {
  const resources = [
    interactionResource("ObservedView", interaction.observedView),
    interactionResource("Context", interaction.context),
    interactionResource("ToolActivity", interaction.toolActivity),
  ] as const;
  const values: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string | null,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ] = [
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
  return { resources, values };
}

async function insertSelectorInteraction(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
): Promise<boolean> {
  const { resources, values } = selectorInteractionStorage(interaction);
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
  const same = await client.query<{ "?column?": number }>(
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

/**
 * Reconstructs the attempt an interaction was recorded without, or completes the
 * one it already has. Both fence columns are written from the two numbers the
 * decision ran under, which the caller carries.
 */
async function completeSelectorAttempt(
  client: pg.PoolClient,
  interaction: SelectorInteraction,
  fence: SelectorSettingsFence,
): Promise<void> {
  const retained = await client.query<{ state: string }>(
    sql`SELECT state FROM selector_attempt WHERE attempt=${interaction.decision} FOR UPDATE`,
  );
  const state = retained.rows[0]?.state;
  if (state === undefined) {
    await client.query(
      sql`INSERT INTO selector_attempt
       (attempt,tenant,project,state,settings_revision,project_settings_revision,
        terminal_evidence)
       VALUES (${interaction.decision},${interaction.partition.tenant},
               ${interaction.partition.project},'Completed',
               ${checkedSelectorFence(fence).settingsRevision},
               ${fence.projectSettingsRevision},'recorded trusted interaction')`,
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
  const completed = await client.query<{ advanced: boolean | null }>(
    sql`SELECT advance_selector_attempt(
      ${interaction.decision},'Completed','policy execution and capability calls completed')::boolean AS advanced`,
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

/**
 * Writes all of a decision's delivery rows in the interaction's own transaction
 * and answers the tickets it wrote. A replayed decision conflicts on the key it
 * is written under and writes nothing; a paused installation's trigger drops
 * each row the same way, so the answer is what reached the relation and never
 * what was offered it.
 */
async function insertSelectorProposals(
  client: pg.PoolClient,
  proposals: SelectorDecisionProposals | undefined,
): Promise<readonly SelectorDelivery["ticket"][]> {
  if (proposals === undefined) return [];
  const interaction = proposals.interaction;
  const written: SelectorDelivery["ticket"][] = [];
  for (const dispatch of proposals.dispatches) {
    const inserted = await client.query(
      sql`INSERT INTO selector_proposal_delivery
       (selector_decision,ticket,tenant,project,operation,command,state)
       VALUES (${interaction.decision},${dispatch.ticket},
               ${interaction.partition.tenant},
               ${interaction.partition.project},${dispatch.operation},
               ${encode(dispatch.command)},
               ${proposals.deliveryMode === "Automatic" ? "Pending" : "AwaitingApproval"})
       ON CONFLICT (selector_decision,ticket) DO NOTHING`,
    );
    if (inserted.rowCount === 1) written.push(dispatch.ticket);
  }
  return written;
}

/**
 * The one transaction a decision is written in: the interaction, the planning
 * intent, its delivery rows and the project's own next state. `recorded` is
 * false where the project moved under the write or the interaction was already
 * retained, and `deliveries` names the tickets this call wrote a row for, which
 * a replay leaves empty without making it a failure.
 */
async function recordSelectorState(
  pool: pg.Pool,
  interaction: SelectorInteraction,
  state: SelectorProjectState,
  fence: SelectorSettingsFence,
  planningIntent?: unknown,
  proposals?: SelectorDecisionProposals,
): Promise<{
  readonly recorded: boolean;
  readonly deliveries: readonly SelectorDelivery["ticket"][];
}> {
  return postgresTransaction(pool, async (client) => {
    if (!(await lockSelectorProject(client, state)))
      return { recorded: false, deliveries: [] };
    await completeSelectorAttempt(client, interaction, fence);
    if (!(await insertSelectorInteraction(client, interaction)))
      return { recorded: false, deliveries: [] };
    await replacePlanningIntent(client, interaction, planningIntent);
    const deliveries = await insertSelectorProposals(client, proposals);
    await writeSelectorProject(client, state);
    return { recorded: true, deliveries };
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

/** One `selector_interaction` row, however the reader was granted it. */
export interface SelectorInteractionRow {
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
  /** The decision's delivery rows as JSON, which is what the log answers landed. */
  readonly dispatches: string;
}

/** The chunked resources one interaction row's three manifests point at. */
export interface SelectorInteractionChunks {
  readonly observedView: readonly string[];
  readonly context: readonly string[];
  readonly toolActivity: readonly string[];
}

/**
 * One decision as the log records it, built from the row and the chunks a
 * reader already holds. The selector's own pool selects those chunks per
 * resource; the API's definer function answers them beside the row, and both
 * are held to the same manifest.
 */
export function selectorInteractionRecord(
  partition: Partition,
  row: SelectorInteractionRow,
  chunks: SelectorInteractionChunks,
): SelectorInteractionRecord {
  return {
    decision: row.selector_decision,
    ordinal: projectRowCounter(row.ordinal, "selector interaction ordinal"),
    partition,
    instructionsVersion: row.instructions_version,
    instructions: row.instructions,
    observedView: selectorInteractionResource(
      row.observed_view,
      chunks.observedView,
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
    context: selectorInteractionResource<SelectorInteraction["context"]>(
      row.context,
      chunks.context,
      selectorContextSchema,
    ),
    toolActivity: selectorInteractionResource(
      row.tool_activity,
      chunks.toolActivity,
      z.array(jsonValueSchema).readonly(),
    ),
    result: decoded(row.result, jsonValueSchema, "selector result"),
    implementationRevision: row.implementation_revision,
    modelRevision: row.model_revision,
    policyRevision: row.policy_revision,
    accounting: decoded(row.accounting, jsonValueSchema, "selector accounting"),
    deliveries: decoded(
      row.dispatches,
      selectorDeliveryRecordsSchema,
      "selector decision deliveries",
    ),
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at.toISOString(),
  };
}

async function selectorInteractionOf(
  pool: pg.Pool,
  partition: Partition,
  row: SelectorInteractionRow,
): Promise<SelectorInteractionRecord> {
  return selectorInteractionRecord(partition, row, {
    observedView: await readInteractionChunks(
      pool,
      row.selector_decision,
      "ObservedView",
    ),
    context: await readInteractionChunks(
      pool,
      row.selector_decision,
      "Context",
    ),
    toolActivity: await readInteractionChunks(
      pool,
      row.selector_decision,
      "ToolActivity",
    ),
  });
}

/**
 * The aggregate the log read answers, which the query checker calls nullable
 * because an aggregate over no rows is. It is narrowed rather than defaulted:
 * a read that stopped answering the column would otherwise draw every decision
 * as having dispatched nothing.
 */
interface SelectorHistoryRow extends Omit<
  SelectorInteractionRow,
  "dispatches"
> {
  readonly dispatches: string | null;
}

async function readSelectorHistory(
  pool: pg.Pool,
  partition: Partition,
  after: number | undefined,
  limit: number,
): Promise<readonly SelectorInteractionRecord[]> {
  checkedSelectorLimit(limit, "selector history");
  const found = await pool.query<SelectorHistoryRow>(
    sql`SELECT selector_decision,ordinal::text,instructions_version,instructions,observed_view,
       observed_token,context,tool_activity,result,implementation_revision,model_revision,
       policy_revision,accounting,started_at,completed_at,
       coalesce((SELECT json_agg(json_build_object(
                  'ticket',landed.ticket,'state',landed.state,'outcome',landed.outcome)
                  ORDER BY landed.ticket)
                   FROM (SELECT d.ticket,d.state,d.outcome
                           FROM selector_proposal_delivery d
                          WHERE d.selector_decision=selector_interaction.selector_decision
                          ORDER BY d.ticket LIMIT ${leadDispatchesMax}) landed),
                '[]'::json)::text AS dispatches
       FROM selector_interaction WHERE tenant=${partition.tenant}
         AND project=${partition.project} AND ordinal>${after ?? 0}
       ORDER BY ordinal LIMIT ${limit}`,
  );
  return Promise.all(
    found.rows.map((row) =>
      selectorInteractionOf(pool, partition, {
        ...row,
        dispatches: sessionRowText(row.dispatches, "a decision's deliveries"),
      }),
    ),
  );
}

export function postgresSelectorState(pool: pg.Pool): SelectorStateStore {
  return {
    setAutomaticReadiness: async (ready) => {
      await pool.query<{ set_selector_host_readiness: string | null }>(
        sql`SELECT set_selector_host_readiness(${ready})::text`,
      );
    },
    allocateAttempt: (attempt, partition, limits) =>
      allocateAttempt(pool, attempt, partition, limits),
    runningAttempt: (attempt, observation, fence) =>
      runningAttempt(pool, attempt, observation, fence),
    quarantineAttempt: (attempt) =>
      advanceAttempt(pool, attempt, "Quarantined"),
    terminateAttempt: (attempt, evidence) =>
      advanceAttempt(pool, attempt, "Terminated", evidence),
    quarantinedAttempts: (limit) => quarantinedAttempts(pool, limit),
    inventoryCursor: () => readInventoryCursor(pool),
    saveInventoryCursor: (cursor) => writeInventoryCursor(pool, cursor),
    recordInteraction: async (interaction, state, fence, planningIntent) =>
      (
        await recordSelectorState(
          pool,
          interaction,
          state,
          fence,
          planningIntent,
        )
      ).recorded,
    record: async (proposals, state) => {
      const written = await recordSelectorState(
        pool,
        proposals.interaction,
        state,
        proposals.fence,
        proposals.planningIntent,
        proposals,
      );
      return { retained: written.recorded, dispatched: written.deliveries };
    },
    pending: (limit) => pendingDeliveries(pool, limit),
    submittedDeliveries: (limit) => submittedDeliveries(pool, limit),
    submitted: (decision, ticket) => markSubmitted(pool, decision, ticket),
    terminal: async (decision, ticket, outcome) => {
      await pool.query<{ advance_selector_delivery: string | null }>(
        sql`SELECT advance_selector_delivery(
          ${decision},${ticket},'Terminal',${encode(outcome)})::text`,
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
      const changed = await pool.query<{ changed: boolean | null }>(
        sql`SELECT review_selector_proposal(
          ${decision},${partition.tenant},${partition.project},'Approved',
          ${reviewer.kind},${reviewer.subject},${feedback ?? null})::boolean AS changed`,
      );
      return changed.rows[0]?.changed ?? false;
    },
    reject: async (partition, decision, reviewer, feedback) => {
      const changed = await pool.query<{ changed: boolean | null }>(
        sql`SELECT review_selector_proposal(
          ${decision},${partition.tenant},${partition.project},'Rejected',
          ${reviewer.kind},${reviewer.subject},${feedback ?? null})::boolean AS changed`,
      );
      return changed.rows[0]?.changed ?? false;
    },
    reviewFeedback: (partition, after, limit) =>
      readReviewFeedback(pool, partition, after, limit),
  };
}
