import type { DispatchCandidate, DispatchViewToken } from "./dispatchView.ts";
import type {
  Accepted,
  Authority,
  OperationId,
  TicketCommand,
} from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type { NotificationBatch, NotificationCursor } from "./notifications.ts";
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
    readonly workingMemory: JsonValue;
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

export interface SelectorProposal {
  readonly interaction: SelectorInteraction;
  readonly operation: OperationId;
  readonly command: Extract<
    TicketCommand,
    { readonly command: "ProposeDispatch" }
  >;
  readonly planningIntent?: JsonValue;
  readonly deliveryMode: "Automatic" | "ApprovalRequired";
}

export interface SelectorDelivery {
  readonly decision: string;
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
    settingsRevision: number,
  ): Promise<void>;
  quarantineAttempt(attempt: string): Promise<void>;
  terminateAttempt(attempt: string, evidence: string): Promise<void>;
  quarantinedAttempts(limit: number): Promise<readonly string[]>;
  inventoryCursor(): Promise<Partition | undefined>;
  saveInventoryCursor(cursor: Partition | undefined): Promise<void>;
  recordInteraction(
    interaction: SelectorInteraction,
    state: SelectorProjectState,
    planningIntent?: JsonValue,
  ): Promise<boolean>;
  record(
    proposal: SelectorProposal,
    state: SelectorProjectState,
  ): Promise<boolean>;
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
  readonly workingMemory: JsonValue;
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

export interface SelectorOperationalContext {
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

/** Whether both scheduler-owned backlog constraints currently admit dispatch. */
export function selectorBacklogsAdmitDispatch(
  backlog: SelectorOperationalContext["backlog"],
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
  readonly operationalContext: SelectorOperationalContext;
  readonly workingMemory: JsonValue;
  readonly nextCandidateScan: Exclude<
    SelectorCandidateScan,
    { readonly state: "Unstarted" }
  >;
  readonly resourceLimit?: "CandidateTooLarge";
}

export interface SelectorPolicyResult {
  readonly selectedTicket?: DispatchCandidate["ticket"];
  readonly planningIntent?: JsonValue;
  readonly attention: SelectorProjectState["attention"];
  readonly workingMemory: JsonValue;
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
    readonly revision: number;
    readonly content: string;
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

function policyResult(value: unknown): SelectorPolicyResult {
  const found = recordOf(value, "selector result");
  const attention = found["attention"];
  if (
    attention !== "Monitoring" &&
    attention !== "Attention" &&
    attention !== "Stopped"
  )
    throw new TypeError("selector attention is invalid");
  if (!("workingMemory" in found))
    throw new TypeError("selector working memory is absent");
  const selectedTicket = found["selectedTicket"];
  if (
    selectedTicket !== undefined &&
    (!Number.isSafeInteger(selectedTicket) || Number(selectedTicket) < 1)
  )
    throw new TypeError("selector ticket is invalid");
  const result: SelectorPolicyResult = {
    attention,
    workingMemory: checkedJson(
      found["workingMemory"],
      "selector working memory",
    ),
    ...(selectedTicket === undefined
      ? {}
      : { selectedTicket: selectedTicket as DispatchCandidate["ticket"] }),
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
  settings: SelectorRuntimeSettings,
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
    operationalContext: interaction.context.operationalContext,
    workingMemory: interaction.context.workingMemory,
    nextCandidateScan: { state: "Exhausted", token: interaction.observedToken },
  };
}

export interface SelectorCycleIdentity {
  readonly operation: OperationId;
  readonly selectorDecisionReference: string;
}

function selectorInteraction(
  execution: SelectorPolicyExecution,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
  partition: Partition,
): SelectorInteraction {
  return {
    decision: identity.selectorDecisionReference,
    partition,
    instructionsVersion: String(settings.revision),
    instructions: settings.basePrompt,
    observedView: observation.candidates,
    observedToken: observation.token,
    context: {
      operationalContext: observation.operationalContext,
      workingMemory: observation.workingMemory,
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
  settings: SelectorRuntimeSettings,
  attempt: string,
): Promise<SelectorPolicyExecution> {
  const policyObservation = persistablePolicyObservation(observation, settings);
  const run = policy.start({
    attempt,
    observation: Object.freeze(policyObservation),
    instructions: Object.freeze({
      revision: settings.revision,
      content: settings.basePrompt,
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

function persistablePolicyObservation(
  observation: SelectorObservation,
  settings: SelectorRuntimeSettings,
): SelectorObservation {
  try {
    if (settings.basePrompt.length < 1 || settings.basePrompt.length > 65_536)
      throw new RangeError("selector instructions must be bounded");
    const persistedInput = checkedJson(
      {
        token: observation.token,
        instructions: settings.basePrompt,
        candidates: observation.candidates,
        context: {
          operationalContext: observation.operationalContext,
          workingMemory: observation.workingMemory,
        },
      },
      "selector interaction input",
      settings.limits.inputBytesPerDecision,
    ) as unknown as {
      readonly candidates: readonly DispatchCandidate[];
      readonly context: SelectorInteraction["context"];
      readonly token: DispatchViewToken;
    };
    return {
      token: persistedInput.token,
      candidates: persistedInput.candidates,
      notificationCursor: observation.notificationCursor,
      operationalContext: persistedInput.context.operationalContext,
      workingMemory: persistedInput.context.workingMemory,
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

function selectedCandidate(
  observation: SelectorObservation,
  selectedTicket: SelectorPolicyResult["selectedTicket"],
): DispatchCandidate | undefined {
  const selected = observation.candidates.find(
    (candidate) => candidate.ticket === selectedTicket,
  );
  if (selectedTicket !== undefined && selected === undefined)
    throw new Error("selector policy chose a ticket outside its observed view");
  return selected;
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
  settings: SelectorRuntimeSettings,
  partition: Partition,
  error: unknown,
  completedAt: string,
): SelectorInteraction {
  const measured =
    error instanceof SelectorExecutionRejected ? error.execution : undefined;
  return {
    decision: identity.selectorDecisionReference,
    partition,
    instructionsVersion: String(settings.revision),
    instructions: settings.basePrompt,
    observedView: observation.candidates,
    observedToken: observation.token,
    context: {
      operationalContext: observation.operationalContext,
      workingMemory: observation.workingMemory,
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
  settings: SelectorRuntimeSettings,
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
      workingMemory: observation.workingMemory,
      candidateScan: observation.nextCandidateScan,
    },
  );
}

async function recordCompletedSelectorCycle(
  store: SelectorStateStore,
  state: SelectorProjectState,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
  execution: SelectorPolicyExecution,
): Promise<SelectorProposal | undefined> {
  const result = execution.result;
  const interaction = selectorInteraction(
    execution,
    observation,
    identity,
    settings,
    state.partition,
  );
  const selected = selectedCandidate(observation, result.selectedTicket);
  const nextState: SelectorProjectState = {
    partition: state.partition,
    notificationCursor: observation.notificationCursor,
    revision: state.revision,
    recoveryEpoch: observation.token.recoveryEpoch,
    attention: result.attention,
    workingMemory: result.workingMemory,
    candidateScan:
      selected === undefined
        ? observation.nextCandidateScan
        : { state: "Unstarted" },
  };
  if (selected === undefined) {
    await store.recordInteraction(
      interaction,
      nextState,
      result.planningIntent,
    );
    return undefined;
  }
  const proposal: SelectorProposal = {
    interaction,
    operation: identity.operation,
    command: proposalCommand({
      ticket: selected,
      token: observation.token,
      selectorDecisionReference: identity.selectorDecisionReference,
    }),
    deliveryMode: settings.dispatchMode,
    ...(result.planningIntent === undefined
      ? {}
      : { planningIntent: result.planningIntent }),
  };
  return (await store.record(proposal, nextState)) ? proposal : undefined;
}

/** Runs one independently timed selector observation and durably records waiting or delivery. */
export async function runSelectorCycle(
  state: SelectorProjectState,
  source: SelectorObservationSource,
  store: SelectorStateStore,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
): Promise<SelectorProposal | undefined> {
  const observation = await observeSelectorProject(
    state,
    source,
    100,
    Math.floor(settings.limits.inputBytesPerDecision / 2),
  );
  if (observation === undefined) return undefined;
  return runObservedSelectorCycle(
    state,
    observation,
    source,
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
  store: SelectorStateStore,
  policy: SelectorPolicyHost,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
): Promise<SelectorProposal | undefined> {
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

/** Polls current state after every wake-up or cursor reset and never mixes view watermarks. */
export async function observeSelectorProject(
  state: SelectorProjectState,
  source: SelectorObservationSource,
  pageLimit = 100,
  candidateBytesMax = 524_288,
): Promise<SelectorObservation | undefined> {
  const notifications = await source.notifications(state.partition, {
    after: state.notificationCursor,
    limit: pageLimit,
  });
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
          operationalContext: await source.operationalContext(state.partition),
          workingMemory: state.workingMemory,
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
          operationalContext: await source.operationalContext(state.partition),
          workingMemory: state.workingMemory,
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
  source: SelectorObservationSource,
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
  submit(delivery: SelectorDelivery): Promise<Accepted>;
}

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
