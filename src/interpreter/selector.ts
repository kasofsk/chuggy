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
}

export interface SelectorObservationSource {
  currentTimeEpochMs(): Promise<number>;
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

export interface SelectorObservation {
  readonly token: DispatchViewToken;
  readonly candidates: readonly DispatchCandidate[];
  readonly notificationCursor: number;
  readonly operationalContext: SelectorOperationalContext;
  readonly workingMemory: JsonValue;
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
  readonly observation: SelectorObservation;
  readonly instructions: {
    readonly revision: number;
    readonly content: string;
  };
  readonly enforcement: SelectorPolicyEnforcement;
}

export interface SelectorPolicyEnforcement {
  readonly models: readonly string[];
  readonly tools: readonly string[];
  readonly limits: Readonly<SelectorRuntimeSettings["limits"]>;
  authorizeModel(name: string): void;
  authorizeTool(name: string): void;
}

/** Model and tool access is mediated by the supplied enforcement capability. */
export interface SelectorPolicyHost {
  decide(
    request: SelectorPolicyRequest,
    signal: AbortSignal,
  ): Promise<SelectorPolicyExecution>;
}

function allowed(name: string, allowlist: readonly string[]): boolean {
  return allowlist.includes("*") || allowlist.includes(name);
}

class SelectorControlViolation extends Error {}
class SelectorDeadlineExceeded extends Error {}

function policyEnforcement(
  settings: SelectorRuntimeSettings,
): SelectorPolicyEnforcement {
  const models = Object.freeze([...settings.modelAllowlist]);
  const tools = Object.freeze([...settings.toolAllowlist]);
  const limits = Object.freeze({ ...settings.limits });
  return Object.freeze({
    models,
    tools,
    limits,
    authorizeModel: (name: string) => {
      if (!allowed(name, models))
        throw new SelectorControlViolation("selector model is not authorized");
    },
    authorizeTool: (name: string) => {
      if (!allowed(name, tools))
        throw new SelectorControlViolation("selector tool is not authorized");
    },
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

function checkedPolicyExecution(
  execution: SelectorPolicyExecution,
  settings: SelectorRuntimeSettings,
): SelectorPolicyExecution {
  enforcePolicyControls(execution, settings);
  return {
    ...execution,
    result: checkedJson(
      execution.result,
      "selector result",
    ) as unknown as SelectorPolicyResult,
    toolActivity: execution.toolActivity.map((activity) =>
      checkedJson(activity, "selector tool activity"),
    ),
    accounting: checkedJson(
      execution.accounting,
      "selector accounting",
    ) as unknown as SelectorPolicyExecution["accounting"],
  };
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
): Promise<SelectorPolicyExecution> {
  const cancellation = new AbortController();
  const decision = policy.decide(
    {
      observation: checkedJson(
        observation,
        "selector observation",
        196_608,
      ) as unknown as SelectorObservation,
      instructions: {
        revision: settings.revision,
        content: settings.basePrompt,
      },
      enforcement: policyEnforcement(settings),
    },
    cancellation.signal,
  );
  try {
    const execution = await Promise.race([
      decision,
      source
        .decisionDeadline(settings.limits.millisecondsPerDecision)
        .catch(() => {
          throw new SelectorDeadlineExceeded(
            "selector policy deadline exceeded",
          );
        }),
    ]);
    return checkedPolicyExecution(execution, settings);
  } catch (error) {
    cancellation.abort(error);
    void decision.catch(() => undefined);
    throw error;
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
  return error instanceof SelectorDeadlineExceeded
    ? "DeadlineExceeded"
    : error instanceof SelectorControlViolation
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
    toolActivity: [],
    result: { outcome: "Failed", code: policyFailureCode(error) },
    implementationRevision: "Unavailable",
    modelRevision: "Unavailable",
    policyRevision: "Unavailable",
    accounting: { tokens: 0, durationMs: 0 },
    startedAt: completedAt,
    completedAt,
  };
}

async function recordFailedSelectorCycle(
  store: SelectorStateStore,
  state: SelectorProjectState,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
  error: unknown,
): Promise<void> {
  await store.recordInteraction(
    failedSelectorInteraction(
      observation,
      identity,
      settings,
      state.partition,
      error,
      observation.operationalContext.observedAt,
    ),
    {
      partition: state.partition,
      notificationCursor: observation.notificationCursor,
      revision: state.revision,
      recoveryEpoch: observation.token.recoveryEpoch,
      attention: "Attention",
      workingMemory: observation.workingMemory,
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
  const observation = await observeSelectorProject(state, source);
  if (observation === undefined) return undefined;
  if (!observationMatchesProject(observation, state.partition))
    throw new Error("selector observation crossed its project boundary");
  const observedAt = observation.operationalContext.observedAtEpochMs;
  const currentTime = await source.currentTimeEpochMs();
  if (
    !operationalContextIsFresh(
      observedAt,
      currentTime,
      settings.operationalContextMaxAgeMs,
    )
  )
    return undefined;
  let execution: SelectorPolicyExecution;
  try {
    execution = await executeSelectorPolicy(
      source,
      policy,
      observation,
      settings,
    );
  } catch (error) {
    await recordFailedSelectorCycle(
      store,
      state,
      observation,
      identity,
      settings,
      error,
    );
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

/** Polls current state after every wake-up or cursor reset and never mixes view watermarks. */
export async function observeSelectorProject(
  state: SelectorProjectState,
  source: SelectorObservationSource,
  pageLimit = 100,
): Promise<SelectorObservation | undefined> {
  const notifications = await source.notifications(state.partition, {
    after: state.notificationCursor,
    limit: pageLimit,
  });
  const candidates: DispatchCandidate[] = [];
  let after: DispatchCandidate["ticket"] | undefined;
  let token: DispatchViewToken | undefined;
  do {
    const page = await source.dispatchView(state.partition, {
      ...(after === undefined ? {} : { after }),
      limit: pageLimit,
      ...(token === undefined ? {} : { watermark: token.watermark }),
    });
    if (page.result === "Reset") return undefined;
    token ??= page.token;
    candidates.push(...page.candidates);
    after = page.nextAfter;
  } while (after !== undefined);
  return token === undefined
    ? undefined
    : {
        token,
        candidates,
        notificationCursor: notifications.cursor,
        operationalContext: await source.operationalContext(state.partition),
        workingMemory: state.workingMemory,
      };
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
