import {
  agenticRefusalReasonCharsMax,
  agenticRefusalsAnsweredMax,
  selectorHandoffNoteBytesMax,
  selectorSettingsTextCharsMax,
  sessionTurnInputCharsMax,
  sessionTurnResultCharsMax,
} from "../contract/http.ts";
import type { DispatchCandidate, DispatchViewToken } from "./dispatchView.ts";
import {
  asOperationId,
  type Authority,
  type OperationId,
  type TicketCommand,
} from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import {
  notificationPageLimitMax,
  type NotificationBatch,
  type NotificationCursor,
  type ProjectNotification,
} from "./notifications.ts";
import type { DispatchViewPage, DispatchViewQuery } from "./dispatchView.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface SelectorInteraction {
  readonly decision: string;
  readonly partition: Partition;
  readonly instructionsVersion: string;
  readonly instructions: string;
  readonly observedView: readonly DispatchCandidate[];
  readonly observedToken?: DispatchViewToken;
  readonly context: {
    readonly operationalContext: SelectorOperationalContext;
    readonly handoffNote: JsonValue;
    /** What the lead was told had moved, absent on a row written before the window was recorded. */
    readonly changes?: readonly ProjectNotification[];
  };
  readonly toolActivity: readonly JsonValue[];
  readonly result: JsonValue;
  readonly implementationRevision: string;
  readonly modelRevision: string;
  readonly policyRevision: string;
  readonly accounting: JsonValue;
  readonly startedAt: string;
  readonly completedAt: string;
}

/** One decision's record and the dispatches it asks the runtime to deliver. */
export interface SelectorDecisionProposals {
  readonly interaction: SelectorInteraction;
  readonly fence: SelectorSettingsFence;
  readonly planningIntent?: JsonValue;
  readonly deliveryMode: "Automatic" | "ApprovalRequired";
  /** At most `leadDispatchesMax`, each naming a ticket the others do not, which
   * `enforcePolicyControls` refuses the turn for breaking. */
  readonly dispatches: readonly SelectorProposedDispatch[];
}

/** One ticket a decision asks to dispatch, and the operation it is submitted under. */
export interface SelectorProposedDispatch {
  readonly ticket: DispatchCandidate["ticket"];
  readonly operation: OperationId;
  readonly command: Extract<
    TicketCommand,
    { readonly command: "ProposeDispatch" }
  >;
}

export interface SelectorDelivery {
  readonly decision: string;
  readonly ticket: DispatchCandidate["ticket"];
  readonly partition: Partition;
  readonly operation: OperationId;
  readonly command: Extract<
    TicketCommand,
    { readonly command: "ProposeDispatch" }
  >;
  readonly attempts: number;
}

export interface SelectorStateStore {
  setAutomaticReadiness(ready: boolean): Promise<void>;
  allocateAttempt(
    attempt: string,
    partition: Partition,
    limits: Pick<
      SelectorRuntimeSettings["limits"],
      "concurrentDecisions" | "selectionsPerMinute" | "millisecondsPerDecision"
    >,
  ): Promise<boolean>;
  runningAttempt(
    attempt: string,
    observation: SelectorObservation,
    fence: SelectorSettingsFence,
  ): Promise<void>;
  quarantineAttempt(attempt: string): Promise<void>;
  terminateAttempt(attempt: string, evidence: string): Promise<void>;
  quarantinedAttempts(limit: number): Promise<readonly string[]>;
  inventoryCursor(): Promise<Partition | undefined>;
  saveInventoryCursor(cursor: Partition | undefined): Promise<void>;
  recordInteraction(
    interaction: SelectorInteraction,
    state: SelectorProjectState,
    fence: SelectorSettingsFence,
    planningIntent?: JsonValue,
  ): Promise<boolean>;
  /** Answers how many delivery rows it wrote, so a partial write is not a whole one. */
  record(
    proposals: SelectorDecisionProposals,
    state: SelectorProjectState,
  ): Promise<number>;
  pending(limit: number): Promise<readonly SelectorDelivery[]>;
  submittedDeliveries(limit: number): Promise<readonly SelectorDelivery[]>;
  submitted(decision: string): Promise<void>;
  terminal(decision: string, outcome: JsonValue): Promise<void>;
  history(
    partition: Partition,
    after: number | undefined,
    limit: number,
  ): Promise<readonly SelectorInteractionRecord[]>;
  project(partition: Partition): Promise<SelectorProjectState | undefined>;
  planningIntent(
    partition: Partition,
  ): Promise<SelectorPlanningIntent | undefined>;
}

export interface SelectorInteractionRecord extends SelectorInteraction {
  readonly ordinal: number;
}

export interface SelectorReviewFeedback {
  readonly ordinal: number;
  readonly selectorDecision: string;
  readonly outcome: "Approved" | "Rejected";
  readonly reviewer: Authority;
  readonly feedback?: string;
  readonly reviewedAt: string;
}

export interface SelectorPlanningIntent {
  readonly selectorDecision: string;
  readonly intent: JsonValue;
  readonly updatedAt: string;
}

export interface SelectorProjectState {
  readonly partition: Partition;
  readonly notificationCursor: number;
  readonly revision: number;
  readonly recoveryEpoch?: string;
  readonly attention: "Monitoring" | "Attention" | "Stopped";
  /** The note a lead leaves for a successor that has no transcript. */
  readonly handoffNote: JsonValue;
  /** Missing is accepted only as the persisted pre-I5 spelling of Unstarted. */
  readonly candidateScan?: SelectorCandidateScan;
}

export type SelectorCandidateScan =
  | { readonly state: "Unstarted" }
  | {
      readonly state: "Continue";
      readonly token: DispatchViewToken;
      readonly after: DispatchCandidate["ticket"];
    }
  | { readonly state: "Exhausted"; readonly token: DispatchViewToken };

/** How many change rows one turn's window carries, which is the page the notifications hold. */
export const selectorNotificationPageLimit = notificationPageLimitMax;

/** Whether this project has anything new, read before a permit is spent on it. */
export interface SelectorChangeTrigger {
  moved(
    partition: Partition,
    after: number,
    limit: number,
  ): Promise<NotificationBatch>;
}

export interface SelectorObservationSource {
  currentTimeEpochMs(): Promise<number>;
  currentInstant(): Promise<string>;
  decisionDeadline(milliseconds: number): Promise<never>;
  notifications(
    partition: Partition,
    cursor: NotificationCursor,
  ): Promise<NotificationBatch>;
  dispatchView(
    partition: Partition,
    query: DispatchViewQuery,
  ): Promise<DispatchViewPage>;
  operationalContext(partition: Partition): Promise<SelectorOperationalContext>;
}

export interface SelectorOperationalContextV2 {
  readonly version: 2;
  readonly observedAt: string;
  readonly observedAtEpochMs: number;
  readonly reviewFeedback: readonly SelectorReviewFeedback[];
  readonly activeWork: {
    readonly queued: number;
    readonly admitted: number;
    readonly launching: number;
    readonly running: number;
  };
  readonly capacity: {
    readonly account: string;
    readonly accountMaximum: number;
    readonly accountActive: number;
    readonly accountReservationDeficit: number;
    readonly clusterSlotsMax: number;
    readonly clusterActive: number;
  };
  readonly backlog: {
    readonly project: { readonly queued: number; readonly ceiling: number };
    readonly installation: {
      readonly queued: number;
      readonly ceiling: number;
    };
  };
}

/** Historical policy input retained exactly as written before context versioning. */
export interface SelectorOperationalContextV1 {
  readonly version: 1;
  readonly observedAt: string;
  readonly observedAtEpochMs: number;
  readonly reviewFeedback: readonly SelectorReviewFeedback[];
  readonly activeWork: readonly {
    readonly ticket: DispatchCandidate["ticket"];
    readonly queuedTasks: number;
    readonly admittedTasks: number;
    readonly runningAttempts: number;
  }[];
  readonly projectCapacity: {
    readonly account: string;
    readonly allocated: number;
    readonly limit: number;
    readonly available: number;
  };
  readonly clusterCapacity: {
    readonly visibility: "AuthorizedAggregate";
    readonly allocated: number;
    readonly limit: number;
    readonly available: number;
    readonly pressure: "Normal" | "Constrained" | "Exhausted" | "Unknown";
  };
  readonly executionBacklog: {
    readonly queued: number;
    readonly ceiling: number;
    readonly dispatchAllowed: boolean;
  };
}

export type SelectorOperationalContext =
  SelectorOperationalContextV1 | SelectorOperationalContextV2;

/** Whether both scheduler-owned backlog constraints currently admit dispatch. */
export function selectorBacklogsAdmitDispatch(
  backlog: SelectorOperationalContextV2["backlog"],
): boolean {
  return (
    backlog.project.queued < backlog.project.ceiling &&
    backlog.installation.queued < backlog.installation.ceiling
  );
}

export interface SelectorObservation {
  readonly token: DispatchViewToken;
  readonly candidates: readonly DispatchCandidate[];
  readonly notificationCursor: number;
  /** What moved since the last turn: kinds and resources, never bodies. */
  readonly changes: readonly ProjectNotification[];
  readonly operationalContext: SelectorOperationalContext;
  readonly handoffNote: JsonValue;
  readonly nextCandidateScan: Exclude<
    SelectorCandidateScan,
    { readonly state: "Unstarted" }
  >;
  readonly resourceLimit?: "CandidateTooLarge";
}

/** One ticket a decision chose, fenced on the version the observation showed. */
export interface SelectorDispatchChoice {
  readonly ticket: DispatchCandidate["ticket"];
  /** Absent only in the pre-slice-2 spelling, whose fence is the observed candidate alone. */
  readonly expectedTicketVersion?: number;
}

/** One ticket a decision declined to dispatch, and why. */
export interface SelectorRefusalChoice {
  readonly ticket: DispatchCandidate["ticket"];
  readonly ticketVersion: number;
  readonly reason: string;
}

/**
 * Where one decision's refusals and lifts are entered. It is declared here
 * rather than taken from the ledger's own module because the ledger's module
 * takes its vocabulary from this one, and a port pointing back would be a
 * cycle.
 */
export interface SelectorRefusalLedger {
  /** Appends one decision's refusals and lifts as one transaction, idempotent on the decision. */
  record(input: {
    readonly partition: Partition;
    readonly decision: string;
    readonly refusals: readonly SelectorRefusalChoice[];
    readonly lifts: readonly SelectorLiftChoice[];
  }): Promise<"Recorded" | "AlreadyRecorded">;
}

/** One ticket a decision cleared a standing refusal from. */
export interface SelectorLiftChoice {
  readonly ticket: DispatchCandidate["ticket"];
}

export interface SelectorPolicyResult {
  /** At most `leadDispatchesMax`; empty is a decision to dispatch nothing, which is free. */
  readonly dispatches: readonly SelectorDispatchChoice[];
  readonly refusals: readonly SelectorRefusalChoice[];
  readonly lifts: readonly SelectorLiftChoice[];
  readonly attention: SelectorProjectState["attention"];
  /** The note a lead leaves for a successor that has no transcript. */
  readonly handoffNote: JsonValue;
  readonly planningIntent?: JsonValue;
}

/**
 * The most tickets any decision may dispatch, whatever a project asks for: the
 * parse ceiling, refusing a document naming more before any of it is read. What
 * a project may ask for inside it is `limits.dispatchesPerDecision`, judged on
 * the finished turn — two bounds for two questions, and the project's may only
 * narrow this one.
 */
export const leadDispatchesMax = 8;

/**
 * What a controls row written before `dispatchesPerDecision` existed resolves
 * to: one, which is what a delivery record keyed by the decision alone can
 * carry. A rollback to such a revision reads it the same way, so this outlives
 * the migration that adds the key.
 */
export const dispatchesPerDecisionUnstated = 1;

/** How many tickets one decision may refuse, and how many it may lift. */
export const leadRefusalsPerDecisionMax = 16;

/** How many standing refusals one observation carries, which is what a read of them answers. */
export const leadRefusalsObservedMax = agenticRefusalsAnsweredMax;

/** What one lead turn's observation may weigh, which is what its mailbox row holds. */
export const leadObservationBytesMax = sessionTurnInputCharsMax;

/** What one lead decision may weigh, which is what its mailbox row holds. */
export const leadDecisionBytesMax = sessionTurnResultCharsMax;

/**
 * The budget one decision is actually built under: the settings' or the
 * mailbox's, whichever binds. A decision legal under the settings and too large
 * for the mailbox is a decision the runtime builds and the database refuses.
 */
export function leadInputBytesMax(settings: SelectorResolvedSettings): number {
  return Math.min(
    settings.limits.inputBytesPerDecision,
    leadObservationBytesMax,
  );
}

/** Provenance measured by the trusted policy host, never authored by the model result. */
export interface SelectorPolicyExecution {
  readonly result: SelectorPolicyResult;
  readonly implementationRevision: string;
  readonly modelRevision: string;
  readonly policyRevision: string;
  readonly toolActivity: readonly JsonValue[];
  readonly accounting: {
    readonly tokens: number;
    readonly durationMs: number;
    /** Present only where the host measured it; the two above are what the controls read. */
    readonly costMicros?: number;
  };
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface SelectorRuntimeSettings {
  readonly revision: number;
  readonly mode: "Running" | "Paused";
  readonly dispatchMode: "Automatic" | "ApprovalRequired";
  readonly basePrompt: string;
  readonly modelAllowlist: readonly string[];
  readonly toolAllowlist: readonly string[];
  readonly limits: {
    readonly tokensPerDecision: number;
    readonly millisecondsPerDecision: number;
    readonly toolCallsPerDecision: number;
    readonly dispatchesPerDecision: number;
    readonly inputBytesPerDecision: number;
    readonly candidatePagesPerDecision: number;
    readonly concurrentDecisions: number;
    readonly selectionsPerMinute: number;
  };
  readonly operationalContextMaxAgeMs: number;
}

export type SelectorPolicyControls = Pick<
  SelectorRuntimeSettings,
  "modelAllowlist" | "toolAllowlist" | "limits" | "operationalContextMaxAgeMs"
>;

/**
 * The limits a project may set for itself. `concurrentDecisions` and
 * `selectionsPerMinute` are not among them, because they bound one shared pool
 * rather than one project's behaviour.
 */
export type SelectorProjectLimitOverrides = Partial<
  Omit<
    SelectorRuntimeSettings["limits"],
    "concurrentDecisions" | "selectionsPerMinute"
  >
>;

/** What a project sets for itself, each absent field inheriting the installation default. */
export interface SelectorProjectOverrides {
  readonly northStar?: string;
  readonly mode?: SelectorRuntimeSettings["mode"];
  readonly dispatchMode?: SelectorRuntimeSettings["dispatchMode"];
  readonly basePrompt?: string;
  readonly modelAllowlist?: readonly string[];
  readonly toolAllowlist?: readonly string[];
  readonly limits?: SelectorProjectLimitOverrides;
  readonly operationalContextMaxAgeMs?: number;
}

/**
 * One project's settings, resolved against the installation defaults, where
 * `revision` remains the installation's and `projectRevision` is the project's
 * because either row moving changes what a decision would have run under.
 * `installationMode` is the unresolved default beside the resolved `mode`, so
 * one read answers both what this project runs under and whether the whole
 * installation is stopped.
 */
export interface SelectorResolvedSettings extends SelectorRuntimeSettings {
  readonly partition: Partition;
  readonly projectRevision: number;
  readonly installationMode: SelectorRuntimeSettings["mode"];
  readonly northStar?: string;
}

/** The revisions an in-flight decision is conditioned on, which is both rows it read. */
export interface SelectorSettingsFence {
  readonly settingsRevision: number;
  readonly projectSettingsRevision: number;
}

/** Reads the fence a resolved settings value stands on. */
export function selectorSettingsFence(
  settings: SelectorResolvedSettings,
): SelectorSettingsFence {
  return {
    settingsRevision: settings.revision,
    projectSettingsRevision: settings.projectRevision,
  };
}

/** Whether both halves of the fence still name what the decision started under. */
export function selectorSettingsFenceHolds(
  fence: SelectorSettingsFence,
  settings: SelectorResolvedSettings,
): boolean {
  return (
    fence.settingsRevision === settings.revision &&
    fence.projectSettingsRevision === settings.projectRevision
  );
}

/**
 * Resolves every field to the project's own value, or to the installation
 * default. An installation pause is the one direction the default is a ceiling:
 * it is the kill switch, so `mode` resolves to `Paused` whatever the project
 * asked for, and the resolved value never claims a selector that will not run.
 */
export function resolvedSelectorSettings(
  partition: Partition,
  defaults: SelectorRuntimeSettings,
  projectRevision: number,
  overrides: SelectorProjectOverrides,
): SelectorResolvedSettings {
  const limits = overrides.limits ?? {};
  return {
    partition,
    projectRevision,
    revision: defaults.revision,
    installationMode: defaults.mode,
    mode: defaults.mode === "Paused" ? "Paused" : (overrides.mode ?? "Running"),
    dispatchMode: overrides.dispatchMode ?? defaults.dispatchMode,
    basePrompt: overrides.basePrompt ?? defaults.basePrompt,
    modelAllowlist: overrides.modelAllowlist ?? defaults.modelAllowlist,
    toolAllowlist: overrides.toolAllowlist ?? defaults.toolAllowlist,
    limits: {
      tokensPerDecision:
        limits.tokensPerDecision ?? defaults.limits.tokensPerDecision,
      millisecondsPerDecision:
        limits.millisecondsPerDecision ??
        defaults.limits.millisecondsPerDecision,
      toolCallsPerDecision:
        limits.toolCallsPerDecision ?? defaults.limits.toolCallsPerDecision,
      dispatchesPerDecision:
        limits.dispatchesPerDecision ?? defaults.limits.dispatchesPerDecision,
      inputBytesPerDecision:
        limits.inputBytesPerDecision ?? defaults.limits.inputBytesPerDecision,
      candidatePagesPerDecision:
        limits.candidatePagesPerDecision ??
        defaults.limits.candidatePagesPerDecision,
      concurrentDecisions: defaults.limits.concurrentDecisions,
      selectionsPerMinute: defaults.limits.selectionsPerMinute,
    },
    operationalContextMaxAgeMs:
      overrides.operationalContextMaxAgeMs ??
      defaults.operationalContextMaxAgeMs,
    ...(overrides.northStar === undefined
      ? {}
      : { northStar: overrides.northStar }),
  };
}

export interface SelectorDrainStatus {
  readonly mode: SelectorRuntimeSettings["mode"];
  readonly awaitingApproval: number;
  readonly pendingDeliveries: number;
  readonly submittedDeliveries: number;
  readonly drained: boolean;
}

export type SelectorSettingsUpdate =
  | { readonly updated: true; readonly settings: SelectorRuntimeSettings }
  | { readonly updated: false; readonly settings: SelectorRuntimeSettings };

export interface SelectorSettingsRevision {
  readonly settings: SelectorRuntimeSettings;
  readonly administrator: Authority;
  readonly recordedAt: string;
}

/** Platform-owned, hot-reloadable selector controls with optimistic concurrency. */
export interface SelectorRuntimeSettingsSource {
  settings(): Promise<SelectorRuntimeSettings>;
  projectSettings(partition: Partition): Promise<SelectorResolvedSettings>;
}

export interface SelectorRuntimeControlStore extends SelectorRuntimeSettingsSource {
  pause(
    expectedRevision: number,
    administrator: Authority,
  ): Promise<SelectorSettingsUpdate>;
  unpause(
    expectedRevision: number,
    administrator: Authority,
  ): Promise<SelectorSettingsUpdate>;
  setDispatchMode(
    expectedRevision: number,
    dispatchMode: SelectorRuntimeSettings["dispatchMode"],
    administrator: Authority,
  ): Promise<SelectorSettingsUpdate>;
  updateBasePrompt(
    expectedRevision: number,
    basePrompt: string,
    administrator: Authority,
  ): Promise<SelectorSettingsUpdate>;
  updatePolicyControls(
    expectedRevision: number,
    controls: SelectorPolicyControls,
    administrator: Authority,
  ): Promise<SelectorSettingsUpdate>;
  history(
    afterRevision: number,
    limit: number,
  ): Promise<readonly SelectorSettingsRevision[]>;
  rollback(
    expectedRevision: number,
    targetRevision: number,
    administrator: Authority,
  ): Promise<SelectorSettingsUpdate>;
  drainStatus(): Promise<SelectorDrainStatus>;
}

export interface SelectorPolicyRequest {
  readonly attempt: string;
  readonly observation: SelectorObservation;
  readonly instructions: {
    readonly revision: string;
    readonly content: string;
    readonly northStar?: string;
  };
  readonly constraints: {
    readonly models: readonly string[];
    readonly tools: readonly string[];
    readonly limits: Readonly<SelectorRuntimeSettings["limits"]>;
  };
}

export interface SelectorPolicyRun {
  readonly result: Promise<unknown>;
  terminate(reason: unknown): Promise<SelectorTerminationResult>;
}

export type SelectorTerminationResult =
  | {
      readonly status: "Terminated";
      readonly attempt: string;
      readonly proof: string;
    }
  | { readonly status: "Unconfirmed" };

/** Owns the only model and tool capabilities and hard-terminates each isolated run. */
export interface SelectorPolicyHost {
  readonly productionReady: boolean;
  start(request: SelectorPolicyRequest): SelectorPolicyRun;
  reconcileQuarantined(attempt: string): Promise<SelectorTerminationResult>;
}

function allowed(name: string, allowlist: readonly string[]): boolean {
  return allowlist.includes("*") || allowlist.includes(name);
}

class SelectorControlViolation extends Error {}
class SelectorDeadlineExceeded extends Error {}
class SelectorInputInvalid extends Error {}
class SelectorResourceLimit extends Error {}
export class SelectorTerminationUnconfirmed extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("selector policy termination was not confirmed");
    this.cause = cause;
  }
}
class SelectorExecutionRejected extends Error {
  readonly rejection: unknown;
  readonly execution: SelectorPolicyExecution;

  constructor(rejection: unknown, execution: SelectorPolicyExecution) {
    super("selector execution was rejected");
    this.rejection = rejection;
    this.execution = execution;
  }
}

function policyConstraints(
  settings: SelectorRuntimeSettings,
): SelectorPolicyRequest["constraints"] {
  const models = Object.freeze([...settings.modelAllowlist]);
  const tools = Object.freeze([...settings.toolAllowlist]);
  const limits = Object.freeze({ ...settings.limits });
  return Object.freeze({
    models,
    tools,
    limits,
  });
}

function freezeJson(value: JsonValue): JsonValue {
  if (typeof value !== "object" || value === null) return value;
  for (const member of Object.values(value)) freezeJson(member);
  return Object.freeze(value);
}

function checkedJson(
  value: unknown,
  what: string,
  bytesMax = 65_536,
): JsonValue {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value, (_key, member: unknown) => {
      if (typeof member === "number" && !Number.isFinite(member))
        throw new TypeError(`${what} contains a non-finite number`);
      if (
        member === undefined ||
        typeof member === "bigint" ||
        typeof member === "function" ||
        typeof member === "symbol"
      )
        throw new TypeError(`${what} contains a non-JSON value`);
      return member;
    });
  } catch {
    throw new TypeError(`${what} must be bounded JSON`);
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > bytesMax
  )
    throw new RangeError(`${what} must be bounded JSON`);
  return freezeJson(JSON.parse(encoded) as JsonValue);
}

function enforcePolicyControls(
  execution: SelectorPolicyExecution,
  settings: SelectorRuntimeSettings,
): void {
  if (!allowed(execution.modelRevision, settings.modelAllowlist))
    throw new SelectorControlViolation(
      "selector policy used a model outside its allowlist",
    );
  if (execution.toolActivity.length > settings.limits.toolCallsPerDecision)
    throw new SelectorControlViolation(
      "selector policy exceeded its tool-call budget",
    );
  if (
    execution.result.dispatches.length > settings.limits.dispatchesPerDecision
  )
    throw new SelectorControlViolation(
      "selector policy dispatched more tickets than its budget",
    );
  const dispatched = execution.result.dispatches.map(
    (dispatch) => dispatch.ticket,
  );
  if (new Set(dispatched).size !== dispatched.length)
    throw new SelectorControlViolation(
      "selector policy dispatched one ticket twice",
    );
  for (const activity of execution.toolActivity) {
    if (
      typeof activity !== "object" ||
      activity === null ||
      !("tool" in activity) ||
      typeof activity["tool"] !== "string" ||
      !allowed(activity["tool"], settings.toolAllowlist)
    )
      throw new SelectorControlViolation(
        "selector policy used a tool outside its allowlist",
      );
  }
  const tokens = execution.accounting.tokens;
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    tokens > settings.limits.tokensPerDecision
  )
    throw new SelectorControlViolation(
      "selector policy exceeded its token budget",
    );
  const elapsed = execution.accounting.durationMs;
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > settings.limits.millisecondsPerDecision
  )
    throw new SelectorControlViolation(
      "selector policy exceeded its duration budget",
    );
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function boundedRevision(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256)
    throw new TypeError(`${what} must be a bounded string`);
  return value;
}

function policyInstant(value: unknown, what: string): string {
  if (typeof value !== "string")
    throw new TypeError(`${what} must be a UTC instant`);
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(
      value,
    );
  if (parts === null) throw new TypeError(`${what} must be a UTC instant`);
  const numeric = parts.slice(1, 7).map((part) => Number(part));
  const year = numeric[0] ?? -1;
  const month = numeric[1] ?? -1;
  const day = numeric[2] ?? -1;
  const hour = numeric[3] ?? -1;
  const minute = numeric[4] ?? -1;
  const second = numeric[5] ?? -1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new TypeError(`${what} must be a real canonical UTC instant`);
  const milliseconds = value.length === 20 ? "000" : value.slice(20, 23);
  return `${value.slice(0, 19)}.${milliseconds}Z`;
}

function policyNonnegativeInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${what} must be a nonnegative JSON integer`);
  return value;
}

function policyTicket(
  value: unknown,
  what: string,
): DispatchCandidate["ticket"] {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new TypeError(`${what} is invalid`);
  return value as DispatchCandidate["ticket"];
}

/**
 * Every choice of one kind, bounded by count before any of them is read. An
 * absent member is an empty list, because choosing nothing is what most
 * decisions do and a result that had to spell it out would be refused for
 * saying nothing.
 */
function policyChoices<Choice>(
  value: unknown,
  what: string,
  countMax: number,
  choice: (member: unknown, index: number) => Choice,
): readonly Choice[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${what} must be an array`);
  if (value.length > countMax)
    throw new RangeError(`${what} names more tickets than a decision may`);
  return value.map(choice);
}

function policyDispatch(value: unknown, index: number): SelectorDispatchChoice {
  const found = recordOf(value, "selector dispatch");
  const version = found["expectedTicketVersion"];
  return {
    ticket: policyTicket(found["ticket"], `selector dispatch ${String(index)}`),
    ...(version === undefined
      ? {}
      : {
          expectedTicketVersion: policyNonnegativeInteger(
            version,
            "selector dispatch version",
          ),
        }),
  };
}

function policyRefusal(value: unknown, index: number): SelectorRefusalChoice {
  const found = recordOf(value, "selector refusal");
  const reason = found["reason"];
  if (
    typeof reason !== "string" ||
    reason.length < 1 ||
    reason.length > agenticRefusalReasonCharsMax
  )
    throw new TypeError("selector refusal reason must be bounded text");
  return {
    ticket: policyTicket(found["ticket"], `selector refusal ${String(index)}`),
    ticketVersion: policyNonnegativeInteger(
      found["ticketVersion"],
      "selector refusal version",
    ),
    reason,
  };
}

function policyLift(value: unknown, index: number): SelectorLiftChoice {
  const found = recordOf(value, "selector lift");
  return {
    ticket: policyTicket(found["ticket"], `selector lift ${String(index)}`),
  };
}

/**
 * A result as a policy host answers it. `selectedTicket` is accepted as the
 * pre-slice-2 spelling of a single dispatch, so a recorded interaction still
 * replays; its version is the observation's and is filled in by the caller that
 * holds one.
 */
function policyResult(value: unknown): SelectorPolicyResult {
  const found = recordOf(value, "selector result");
  const attention = found["attention"];
  if (
    attention !== "Monitoring" &&
    attention !== "Attention" &&
    attention !== "Stopped"
  )
    throw new TypeError("selector attention is invalid");
  if (!("handoffNote" in found))
    throw new TypeError("selector handoff note is absent");
  const selectedTicket = found["selectedTicket"];
  if (selectedTicket !== undefined && found["dispatches"] !== undefined)
    throw new TypeError("selector result names its dispatch two ways");
  const dispatches =
    selectedTicket === undefined
      ? policyChoices(
          found["dispatches"],
          "selector dispatches",
          leadDispatchesMax,
          policyDispatch,
        )
      : [{ ticket: policyTicket(selectedTicket, "selector ticket") }];
  const result: SelectorPolicyResult = {
    dispatches,
    refusals: policyChoices(
      found["refusals"],
      "selector refusals",
      leadRefusalsPerDecisionMax,
      policyRefusal,
    ),
    lifts: policyChoices(
      found["lifts"],
      "selector lifts",
      leadRefusalsPerDecisionMax,
      policyLift,
    ),
    attention,
    handoffNote: checkedJson(
      found["handoffNote"],
      "selector handoff note",
      selectorHandoffNoteBytesMax,
    ),
    ...(found["planningIntent"] === undefined
      ? {}
      : {
          planningIntent: checkedJson(
            found["planningIntent"],
            "selector planning intent",
          ),
        }),
  };
  return checkedJson(
    result,
    "selector result",
  ) as unknown as SelectorPolicyResult;
}

function parsedPolicyExecution(value: unknown): SelectorPolicyExecution {
  const found = recordOf(value, "selector execution");
  const toolActivityValue = found["toolActivity"];
  if (!Array.isArray(toolActivityValue))
    throw new TypeError("selector tool activity must be an array");
  const accountingValue = recordOf(found["accounting"], "selector accounting");
  const execution: SelectorPolicyExecution = {
    result: policyResult(found["result"]),
    implementationRevision: boundedRevision(
      found["implementationRevision"],
      "selector implementation revision",
    ),
    modelRevision: boundedRevision(
      found["modelRevision"],
      "selector model revision",
    ),
    policyRevision: boundedRevision(
      found["policyRevision"],
      "selector policy revision",
    ),
    toolActivity: checkedJson(
      toolActivityValue,
      "selector tool activity",
    ) as readonly JsonValue[],
    accounting: {
      tokens: policyNonnegativeInteger(
        accountingValue["tokens"],
        "selector token accounting",
      ),
      durationMs: policyNonnegativeInteger(
        accountingValue["durationMs"],
        "selector duration accounting",
      ),
      ...(accountingValue["costMicros"] === undefined
        ? {}
        : {
            costMicros: policyNonnegativeInteger(
              accountingValue["costMicros"],
              "selector cost accounting",
            ),
          }),
    },
    startedAt: policyInstant(found["startedAt"], "selector start"),
    completedAt: policyInstant(found["completedAt"], "selector completion"),
  };
  if (execution.completedAt < execution.startedAt)
    throw new TypeError("selector completion precedes its start");
  return execution;
}

/** Replays a recorded semantic input without recording or delivering its result. */
export async function dryRunSelectorPolicy(
  policy: SelectorPolicyHost,
  source: Pick<SelectorObservationSource, "decisionDeadline">,
  observation: SelectorObservation,
  settings: SelectorResolvedSettings,
): Promise<SelectorPolicyResult> {
  const execution = await executeSelectorPolicy(
    source,
    policy,
    observation,
    settings,
    "dry-run",
  );
  return execution.result;
}

export function recordedSelectorObservation(
  interaction: SelectorInteraction,
): SelectorObservation | undefined {
  if (interaction.observedToken === undefined) return undefined;
  return {
    token: interaction.observedToken,
    candidates: interaction.observedView,
    notificationCursor: 0,
    changes: [],
    operationalContext: interaction.context.operationalContext,
    handoffNote: interaction.context.handoffNote,
    nextCandidateScan: { state: "Exhausted", token: interaction.observedToken },
  };
}

export interface SelectorCycleIdentity {
  readonly operation: OperationId;
  readonly selectorDecisionReference: string;
}

/**
 * The label a decision's instructions are retained under, naming both revisions
 * they were resolved from. It is read by people rather than by code: the pair a
 * fence is checked against is `SelectorSettingsFence`, carried as two numbers
 * beside this and recorded as two columns, so nothing has to parse this back.
 */
function selectorInstructionsVersion(
  settings: SelectorResolvedSettings,
): string {
  return `${String(settings.revision)}.${String(settings.projectRevision)}`;
}

function selectorInteraction(
  execution: SelectorPolicyExecution,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorResolvedSettings,
  partition: Partition,
): SelectorInteraction {
  return {
    decision: identity.selectorDecisionReference,
    partition,
    instructionsVersion: selectorInstructionsVersion(settings),
    instructions: settings.basePrompt,
    observedView: observation.candidates,
    observedToken: observation.token,
    context: {
      operationalContext: observation.operationalContext,
      handoffNote: observation.handoffNote,
      changes: observation.changes,
    },
    toolActivity: execution.toolActivity,
    result: checkedJson(execution.result, "selector result"),
    implementationRevision: execution.implementationRevision,
    modelRevision: execution.modelRevision,
    policyRevision: execution.policyRevision,
    accounting: checkedJson(execution.accounting, "selector accounting"),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  };
}

async function executeSelectorPolicy(
  source: Pick<SelectorObservationSource, "decisionDeadline">,
  policy: SelectorPolicyHost,
  observation: SelectorObservation,
  settings: SelectorResolvedSettings,
  attempt: string,
): Promise<SelectorPolicyExecution> {
  const policyObservation = persistablePolicyObservation(observation, settings);
  const run = policy.start({
    attempt,
    observation: Object.freeze(policyObservation),
    instructions: Object.freeze({
      revision: selectorInstructionsVersion(settings),
      content: settings.basePrompt,
      ...(settings.northStar === undefined
        ? {}
        : { northStar: settings.northStar }),
    }),
    constraints: policyConstraints(settings),
  });
  try {
    const execution = await Promise.race([
      run.result,
      source
        .decisionDeadline(settings.limits.millisecondsPerDecision)
        .catch(() => {
          throw new SelectorDeadlineExceeded(
            "selector policy deadline exceeded",
          );
        }),
    ]);
    const parsed = parsedPolicyExecution(execution);
    try {
      enforcePolicyControls(parsed, settings);
    } catch (error) {
      throw new SelectorExecutionRejected(error, parsed);
    }
    return parsed;
  } catch (error) {
    let termination: SelectorTerminationResult;
    try {
      termination = await run.terminate(error);
    } catch {
      termination = { status: "Unconfirmed" };
    }
    void run.result.catch(() => undefined);
    if (
      termination.status !== "Terminated" ||
      termination.attempt !== attempt ||
      termination.proof.length < 1 ||
      termination.proof.length > 1024
    )
      throw new SelectorTerminationUnconfirmed(error);
    throw error;
  }
}

/**
 * Everything the policy is given, weighed against `leadInputBytesMax` before any
 * of it is sent. A project's North Star is inside that budget rather than beside
 * it, so a long one narrows the view its own project can carry and does not
 * quietly widen what one decision costs.
 */
function persistablePolicyObservation(
  observation: SelectorObservation,
  settings: SelectorResolvedSettings,
): SelectorObservation {
  try {
    if (
      settings.basePrompt.length < 1 ||
      settings.basePrompt.length > selectorSettingsTextCharsMax
    )
      throw new RangeError("selector instructions must be bounded");
    const persistedInput = checkedJson(
      {
        token: observation.token,
        instructions: settings.basePrompt,
        northStar: settings.northStar ?? null,
        candidates: observation.candidates,
        changes: observation.changes,
        context: {
          operationalContext: observation.operationalContext,
          handoffNote: observation.handoffNote,
        },
      },
      "selector interaction input",
      leadInputBytesMax(settings),
    ) as unknown as {
      readonly candidates: readonly DispatchCandidate[];
      readonly changes: readonly ProjectNotification[];
      readonly context: SelectorInteraction["context"];
      readonly token: DispatchViewToken;
    };
    return {
      token: persistedInput.token,
      candidates: persistedInput.candidates,
      notificationCursor: observation.notificationCursor,
      changes: persistedInput.changes,
      operationalContext: persistedInput.context.operationalContext,
      handoffNote: persistedInput.context.handoffNote,
      nextCandidateScan: observation.nextCandidateScan,
      ...(observation.resourceLimit === undefined
        ? {}
        : { resourceLimit: observation.resourceLimit }),
    };
  } catch (error) {
    if (error instanceof RangeError)
      throw new SelectorResourceLimit("selector input exceeds its byte budget");
    throw new SelectorInputInvalid("selector input cannot be persisted");
  }
}

function operationalContextIsFresh(
  observedAt: number,
  currentTime: number,
  maxAgeMs: number,
): boolean {
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(currentTime) &&
    observedAt <= currentTime &&
    currentTime - observedAt <= maxAgeMs
  );
}

function observationMatchesProject(
  observation: SelectorObservation,
  partition: Partition,
): boolean {
  return (
    observation.token.tenant === partition.tenant &&
    observation.token.project === partition.project
  );
}

/**
 * The candidates a decision's dispatches name, in the order it named them, and
 * total over the list rather than over its first member — one dropped here
 * would be a ticket the lead believes it dispatched and no record mentions. The
 * version each fenced on is checked where the document is read, so this refuses
 * the one thing that check cannot: a ticket the view did not carry at all.
 */
function selectedCandidates(
  observation: SelectorObservation,
  dispatches: SelectorPolicyResult["dispatches"],
): readonly DispatchCandidate[] {
  return dispatches.map((dispatch) => {
    const selected = observation.candidates.find(
      (candidate) => candidate.ticket === dispatch.ticket,
    );
    if (selected === undefined)
      throw new Error(
        "selector policy chose a ticket outside its observed view",
      );
    return selected;
  });
}

function policyFailureCode(error: unknown): string {
  return error instanceof SelectorTerminationUnconfirmed
    ? "TerminationUnconfirmed"
    : error instanceof SelectorResourceLimit
      ? "ResourceLimit"
      : error instanceof SelectorDeadlineExceeded
        ? "DeadlineExceeded"
        : error instanceof SelectorExecutionRejected ||
            error instanceof SelectorControlViolation
          ? "ControlViolation"
          : error instanceof TypeError || error instanceof RangeError
            ? "InvalidResult"
            : "PolicyFailed";
}

function failedSelectorInteraction(
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorResolvedSettings,
  partition: Partition,
  error: unknown,
  completedAt: string,
): SelectorInteraction {
  const measured =
    error instanceof SelectorExecutionRejected ? error.execution : undefined;
  return {
    decision: identity.selectorDecisionReference,
    partition,
    instructionsVersion: selectorInstructionsVersion(settings),
    instructions: settings.basePrompt,
    observedView: observation.candidates,
    observedToken: observation.token,
    context: {
      operationalContext: observation.operationalContext,
      handoffNote: observation.handoffNote,
      changes: observation.changes,
    },
    toolActivity: measured?.toolActivity ?? [],
    result: { outcome: "Failed", code: policyFailureCode(error) },
    implementationRevision: measured?.implementationRevision ?? "Unavailable",
    modelRevision: measured?.modelRevision ?? "Unavailable",
    policyRevision: measured?.policyRevision ?? "Unavailable",
    accounting: measured?.accounting ?? { tokens: 0, durationMs: 0 },
    startedAt: measured?.startedAt ?? completedAt,
    completedAt: measured?.completedAt ?? completedAt,
  };
}

async function recordFailedSelectorCycle(
  store: SelectorStateStore,
  state: SelectorProjectState,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorResolvedSettings,
  error: unknown,
  completedAt: string,
): Promise<void> {
  await store.recordInteraction(
    failedSelectorInteraction(
      observation,
      identity,
      settings,
      state.partition,
      error,
      completedAt,
    ),
    {
      partition: state.partition,
      notificationCursor: observation.notificationCursor,
      revision: state.revision,
      recoveryEpoch: observation.token.recoveryEpoch,
      attention: "Attention",
      handoffNote: observation.handoffNote,
      candidateScan: observation.nextCandidateScan,
    },
    selectorSettingsFence(settings),
  );
}

/**
 * The decision's refusals and lifts, appended after the decision they belong to
 * is recorded. The ledger names the decision, so a refusal written first could
 * name one the log does not carry and no reader could ever explain it; a
 * refusal lost the other way is refused again on the project's next turn, and
 * the door is idempotent on the decision so a retry writes one row.
 */
async function recordDecisionRefusals(
  refusals: SelectorRefusalLedger,
  partition: Partition,
  identity: SelectorCycleIdentity,
  result: SelectorPolicyResult,
): Promise<void> {
  if (result.refusals.length + result.lifts.length === 0) return;
  await refusals.record({
    partition,
    decision: identity.selectorDecisionReference,
    refusals: result.refusals,
    lifts: result.lifts,
  });
}

async function recordCompletedSelectorCycle(
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  state: SelectorProjectState,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorResolvedSettings,
  execution: SelectorPolicyExecution,
): Promise<SelectorDecisionProposals | undefined> {
  const result = execution.result;
  const interaction = selectorInteraction(
    execution,
    observation,
    identity,
    settings,
    state.partition,
  );
  const selected = selectedCandidates(observation, result.dispatches);
  const nextState: SelectorProjectState = {
    partition: state.partition,
    notificationCursor: observation.notificationCursor,
    revision: state.revision,
    recoveryEpoch: observation.token.recoveryEpoch,
    attention: result.attention,
    handoffNote: result.handoffNote,
    candidateScan:
      selected.length === 0
        ? observation.nextCandidateScan
        : { state: "Unstarted" },
  };
  if (selected.length === 0) {
    await store.recordInteraction(
      interaction,
      nextState,
      selectorSettingsFence(settings),
      result.planningIntent,
    );
    await recordDecisionRefusals(refusals, state.partition, identity, result);
    return undefined;
  }
  const proposals: SelectorDecisionProposals = {
    interaction,
    fence: selectorSettingsFence(settings),
    deliveryMode: settings.dispatchMode,
    dispatches: selected.map((candidate) => ({
      ticket: candidate.ticket,
      operation: selectorDispatchOperation(identity, candidate.ticket),
      command: proposalCommand({
        ticket: candidate,
        token: observation.token,
        selectorDecisionReference: identity.selectorDecisionReference,
      }),
    })),
    ...(result.planningIntent === undefined
      ? {}
      : { planningIntent: result.planningIntent }),
  };
  const recorded = await store.record(proposals, nextState);
  await recordDecisionRefusals(refusals, state.partition, identity, result);
  return recorded === proposals.dispatches.length ? proposals : undefined;
}

/** Runs one independently timed selector observation and durably records waiting or delivery. */
export async function runSelectorCycle(
  state: SelectorProjectState,
  source: SelectorObservationSource,
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
  settings: SelectorResolvedSettings,
): Promise<SelectorDecisionProposals | undefined> {
  const observation = await observeSelectorProject(
    state,
    source,
    await source.notifications(state.partition, {
      after: state.notificationCursor,
      limit: selectorNotificationPageLimit,
    }),
    selectorNotificationPageLimit,
    Math.floor(leadInputBytesMax(settings) / 2),
  );
  if (observation === undefined) return undefined;
  return runObservedSelectorCycle(
    state,
    observation,
    source,
    refusals,
    store,
    policy,
    identity,
    settings,
  );
}

/** Executes a previously persisted observation through the trusted policy host. */
export async function runObservedSelectorCycle(
  state: SelectorProjectState,
  observation: SelectorObservation,
  source: SelectorObservationSource,
  refusals: SelectorRefusalLedger,
  store: SelectorStateStore,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
  settings: SelectorResolvedSettings,
): Promise<SelectorDecisionProposals | undefined> {
  if (!observationMatchesProject(observation, state.partition))
    throw new Error("selector observation crossed its project boundary");
  if (
    !(await selectorObservationIsFresh(
      observation,
      source,
      store,
      identity,
      settings,
    ))
  )
    return undefined;
  let execution: SelectorPolicyExecution;
  try {
    if (observation.resourceLimit === "CandidateTooLarge")
      throw new SelectorResourceLimit(
        "selector candidate exceeds the interaction byte budget",
      );
    execution = await executeSelectorPolicy(
      source,
      policy,
      observation,
      settings,
      identity.selectorDecisionReference,
    );
  } catch (error) {
    if (error instanceof SelectorInputInvalid) throw error;
    let auditFailed = false;
    let auditFailure: unknown;
    try {
      const completedAt = await source.currentInstant();
      await recordFailedSelectorCycle(
        store,
        state,
        observation,
        identity,
        settings,
        error,
        completedAt,
      );
    } catch (failed) {
      auditFailed = true;
      auditFailure = failed;
    }
    if (error instanceof SelectorTerminationUnconfirmed) throw error;
    if (auditFailed) throw auditFailure;
    return undefined;
  }
  return recordCompletedSelectorCycle(
    refusals,
    store,
    state,
    observation,
    identity,
    settings,
    execution,
  );
}

async function selectorObservationIsFresh(
  observation: SelectorObservation,
  source: SelectorObservationSource,
  store: SelectorStateStore,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
): Promise<boolean> {
  if (
    operationalContextIsFresh(
      observation.operationalContext.observedAtEpochMs,
      await source.currentTimeEpochMs(),
      settings.operationalContextMaxAgeMs,
    )
  )
    return true;
  await store.terminateAttempt(
    identity.selectorDecisionReference,
    "operational context expired before policy execution",
  );
  return false;
}

/**
 * Whether a project moved past the cursor its last turn stood on, which is a
 * reset — a gap the consumer cannot replay — or a page, or a cursor that moved
 * past rows the page did not carry. Only an empty page at the standing cursor
 * is nothing new.
 */
export function selectorProjectMoved(
  state: SelectorProjectState,
  changes: NotificationBatch,
): boolean {
  return (
    changes.result === "Reset" ||
    changes.events.length > 0 ||
    changes.cursor !== state.notificationCursor
  );
}

/**
 * Polls current state after every wake-up or cursor reset and never mixes view
 * watermarks. The notification page is read by the caller and handed in, so it
 * is read once per cycle: reading it here as well would let a row arrive
 * between the two reads and be counted as the trigger for a window that does
 * not contain it.
 */
export async function observeSelectorProject(
  state: SelectorProjectState,
  source: Pick<
    SelectorObservationSource,
    "dispatchView" | "operationalContext"
  >,
  notifications: NotificationBatch,
  pageLimit = 100,
  candidateBytesMax = 524_288,
): Promise<SelectorObservation | undefined> {
  if (!selectorProjectMoved(state, notifications)) return undefined;
  const changes = notifications.result === "Events" ? notifications.events : [];
  const scan = state.candidateScan ?? ({ state: "Unstarted" } as const);
  const query =
    scan.state === "Unstarted"
      ? { limit: pageLimit }
      : scan.state === "Exhausted"
        ? { limit: 1, watermark: scan.token.watermark }
        : {
            limit: pageLimit,
            after: scan.after,
            watermark: scan.token.watermark,
          };
  let page =
    scan.state === "Exhausted"
      ? await source.dispatchView(state.partition, query)
      : await boundedCandidatePage(
          source,
          state.partition,
          query,
          candidateBytesMax,
        );
  if (scan.state === "Exhausted" && page.result === "Page") return undefined;
  if (page.result === "Reset")
    page = await boundedCandidatePage(
      source,
      state.partition,
      { limit: pageLimit },
      candidateBytesMax,
    );
  return page.result === "Reset"
    ? undefined
    : page.result === "Oversized"
      ? {
          token: page.token,
          candidates: [],
          notificationCursor: notifications.cursor,
          changes,
          operationalContext: await source.operationalContext(state.partition),
          handoffNote: state.handoffNote,
          nextCandidateScan:
            page.nextAfter === undefined
              ? { state: "Exhausted", token: page.token }
              : { state: "Continue", token: page.token, after: page.candidate },
          resourceLimit: "CandidateTooLarge",
        }
      : {
          token: page.token,
          candidates: page.candidates,
          notificationCursor: notifications.cursor,
          changes,
          operationalContext: await source.operationalContext(state.partition),
          handoffNote: state.handoffNote,
          nextCandidateScan:
            page.nextAfter === undefined
              ? { state: "Exhausted", token: page.token }
              : { state: "Continue", token: page.token, after: page.nextAfter },
        };
}

type BoundedCandidatePage =
  | DispatchViewPage
  | {
      readonly result: "Oversized";
      readonly token: DispatchViewToken;
      readonly candidate: DispatchCandidate["ticket"];
      readonly nextAfter?: DispatchCandidate["ticket"];
      readonly notificationCursor: number;
    };

async function boundedCandidatePage(
  source: Pick<SelectorObservationSource, "dispatchView">,
  partition: Partition,
  query: DispatchViewQuery,
  bytesMax: number,
): Promise<BoundedCandidatePage> {
  let limit = query.limit;
  for (;;) {
    const page = await source.dispatchView(partition, { ...query, limit });
    if (page.result === "Reset") return page;
    const bytes = new TextEncoder().encode(
      JSON.stringify(page.candidates),
    ).length;
    if (bytes <= bytesMax) return page;
    if (limit === 1) {
      const candidate = page.candidates[0];
      if (candidate === undefined) return page;
      return {
        result: "Oversized",
        token: page.token,
        candidate: candidate.ticket,
        notificationCursor: page.notificationCursor,
        ...(page.nextAfter === undefined ? {} : { nextAfter: page.nextAfter }),
      };
    }
    limit = Math.max(1, Math.floor(limit / 2));
  }
}

export interface SelectorTicketService {
  submit(delivery: SelectorDelivery): Promise<SelectorProposalAcceptance>;
}

export type SelectorProposalAcceptance =
  | { readonly accepted: "Accepted" | "Original" }
  | { readonly accepted: "IdempotencyConflict" | "InvalidCommand" }
  | {
      readonly accepted: "Backpressure" | "Unavailable";
      readonly retryAfterSeconds: number;
    }
  | { readonly accepted: "NotAdmitted" };

export interface SelectorOperationSource {
  operation(partition: Partition, operation: OperationId): Promise<unknown>;
}

export type SelectorDeliveryResult =
  | { readonly result: "Delivered"; readonly decision: string }
  | { readonly result: "Retry"; readonly decision: string };

/** Delivers durable proposals at least once; operation idempotency absorbs ambiguous retries. */
export async function deliverSelectorProposal(
  store: SelectorStateStore,
  ticketService: SelectorTicketService,
  delivery: SelectorDelivery,
): Promise<SelectorDeliveryResult> {
  try {
    const accepted = await ticketService.submit(delivery);
    if (accepted.accepted === "Accepted" || accepted.accepted === "Original") {
      await store.submitted(delivery.decision);
      return { result: "Delivered", decision: delivery.decision };
    }
    if (
      accepted.accepted === "IdempotencyConflict" ||
      accepted.accepted === "InvalidCommand"
    )
      await store.terminal(delivery.decision, accepted);
    return { result: "Retry", decision: delivery.decision };
  } catch {
    return { result: "Retry", decision: delivery.decision };
  }
}

/** Reconciles an accepted proposal without interpreting ticket-service outcome semantics. */
export async function reconcileSelectorProposal(
  store: SelectorStateStore,
  source: SelectorOperationSource,
  delivery: SelectorDelivery,
): Promise<boolean> {
  const outcome = await source.operation(
    delivery.partition,
    delivery.operation,
  );
  if (outcome === undefined) return false;
  const state =
    typeof outcome === "object" && outcome !== null
      ? (outcome as { readonly state?: unknown }).state
      : undefined;
  if (state === "Pending") return false;
  await store.terminal(
    delivery.decision,
    checkedJson(outcome, "selector operation outcome"),
  );
  return true;
}

/**
 * The operation one decision's dispatch of one ticket is submitted under,
 * derived rather than allocated: a minted list would have to be as long as the
 * ceiling and drawn before the decision is known. Deriving it means a
 * redelivery of the same decision's same ticket is the same operation, so
 * idempotency absorbs the retry — which is an identity only because a decision
 * names each ticket once, and is why that is a control rather than a hope.
 */
export function selectorDispatchOperation(
  identity: SelectorCycleIdentity,
  ticket: DispatchCandidate["ticket"],
): OperationId {
  return asOperationId(`${identity.operation}-t${String(ticket)}`);
}

export function proposalCommand(input: {
  readonly ticket: DispatchCandidate;
  readonly token: DispatchViewToken;
  readonly selectorDecisionReference: string;
}): Extract<TicketCommand, { readonly command: "ProposeDispatch" }> {
  return {
    version: 1,
    command: "ProposeDispatch",
    ticket: input.ticket.ticket,
    expectedTicketVersion: input.ticket.ticketVersion,
    observedViewToken: input.token,
    selectorDecisionReference: input.selectorDecisionReference,
  };
}
