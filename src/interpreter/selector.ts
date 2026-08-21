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

export interface SelectorInteraction {
  readonly decision: string;
  readonly partition: Partition;
  readonly instructionsVersion: string;
  readonly instructions: string;
  readonly observedView: readonly DispatchCandidate[];
  readonly observedToken?: DispatchViewToken;
  readonly context: {
    readonly operationalContext: SelectorOperationalContext;
    readonly workingMemory: unknown;
  };
  readonly toolActivity: readonly unknown[];
  readonly result: unknown;
  readonly implementationRevision: string;
  readonly modelRevision: string;
  readonly policyRevision: string;
  readonly accounting: unknown;
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
  readonly planningIntent?: unknown;
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
    planningIntent?: unknown,
  ): Promise<void>;
  record(
    proposal: SelectorProposal,
    state: SelectorProjectState,
  ): Promise<void>;
  pending(limit: number): Promise<readonly SelectorDelivery[]>;
  submittedDeliveries(limit: number): Promise<readonly SelectorDelivery[]>;
  submitted(decision: string): Promise<void>;
  terminal(decision: string, outcome: unknown): Promise<void>;
  history(
    partition: Partition,
    after: string | undefined,
    limit: number,
  ): Promise<readonly SelectorInteraction[]>;
  project(partition: Partition): Promise<SelectorProjectState | undefined>;
  awaitingApproval(
    partition: Partition,
    limit: number,
  ): Promise<readonly SelectorDelivery[]>;
  approve(
    partition: Partition,
    decision: string,
    reviewer: Authority,
    feedback?: string,
  ): Promise<boolean>;
  reject(
    partition: Partition,
    decision: string,
    reviewer: Authority,
    feedback?: string,
  ): Promise<boolean>;
  reviewFeedback(
    partition: Partition,
    after: string | undefined,
    limit: number,
  ): Promise<readonly SelectorReviewFeedback[]>;
}

export interface SelectorReviewFeedback {
  readonly selectorDecision: string;
  readonly outcome: "Approved" | "Rejected";
  readonly reviewer: Authority;
  readonly feedback?: string;
  readonly reviewedAt: string;
}

export interface SelectorProjectState {
  readonly partition: Partition;
  readonly notificationCursor: number;
  readonly recoveryEpoch?: string;
  readonly attention: "Monitoring" | "Attention" | "Stopped";
  readonly workingMemory: unknown;
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
  readonly workingMemory: unknown;
}

export interface SelectorPolicyResult {
  readonly interaction: SelectorInteraction;
  readonly selectedTicket?: DispatchCandidate["ticket"];
  readonly planningIntent?: unknown;
  readonly attention: SelectorProjectState["attention"];
  readonly workingMemory: unknown;
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

/** Platform-owned, hot-reloadable selector controls with optimistic concurrency. */
export interface SelectorRuntimeSettingsSource {
  settings(): Promise<SelectorRuntimeSettings>;
}

export interface SelectorRuntimeControlStore extends SelectorRuntimeSettingsSource {
  pause(expectedRevision: number): Promise<SelectorSettingsUpdate>;
  unpause(expectedRevision: number): Promise<SelectorSettingsUpdate>;
  setDispatchMode(
    expectedRevision: number,
    dispatchMode: SelectorRuntimeSettings["dispatchMode"],
  ): Promise<SelectorSettingsUpdate>;
  updateBasePrompt(
    expectedRevision: number,
    basePrompt: string,
  ): Promise<SelectorSettingsUpdate>;
  updatePolicyControls(
    expectedRevision: number,
    controls: SelectorPolicyControls,
  ): Promise<SelectorSettingsUpdate>;
  history(
    afterRevision: number,
    limit: number,
  ): Promise<readonly SelectorRuntimeSettings[]>;
  rollback(
    expectedRevision: number,
    targetRevision: number,
  ): Promise<SelectorSettingsUpdate>;
  drainStatus(): Promise<SelectorDrainStatus>;
}

export interface SelectorPolicy {
  decide(
    observation: SelectorObservation,
    settings: SelectorRuntimeSettings,
  ): Promise<SelectorPolicyResult>;
}

function allowed(name: string, allowlist: readonly string[]): boolean {
  return allowlist.includes("*") || allowlist.includes(name);
}

function enforcePolicyControls(
  result: SelectorPolicyResult,
  settings: SelectorRuntimeSettings,
): void {
  if (!allowed(result.interaction.modelRevision, settings.modelAllowlist))
    throw new Error("selector policy used a model outside its allowlist");
  if (
    result.interaction.toolActivity.length >
    settings.limits.toolCallsPerDecision
  )
    throw new Error("selector policy exceeded its tool-call budget");
  for (const activity of result.interaction.toolActivity) {
    if (
      typeof activity !== "object" ||
      activity === null ||
      !("tool" in activity) ||
      typeof activity.tool !== "string" ||
      !allowed(activity.tool, settings.toolAllowlist)
    )
      throw new Error("selector policy used a tool outside its allowlist");
  }
  const accounting = result.interaction.accounting;
  if (
    typeof accounting !== "object" ||
    accounting === null ||
    !("tokens" in accounting) ||
    !("durationMs" in accounting)
  )
    throw new Error("selector policy returned no trusted accounting");
  const tokens = Number(accounting.tokens);
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    tokens > settings.limits.tokensPerDecision
  )
    throw new Error("selector policy exceeded its token budget");
  const elapsed = Number(accounting.durationMs);
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > settings.limits.millisecondsPerDecision
  )
    throw new Error("selector policy exceeded its duration budget");
}

/** Replays a recorded semantic input without recording or delivering its result. */
export function dryRunSelectorPolicy(
  policy: SelectorPolicy,
  observation: SelectorObservation,
  settings: SelectorRuntimeSettings,
): Promise<SelectorPolicyResult> {
  return policy.decide(observation, settings);
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

function interactionMatchesObservation(
  result: SelectorPolicyResult,
  observation: SelectorObservation,
  identity: SelectorCycleIdentity,
): boolean {
  const interaction = result.interaction;
  return (
    interaction.decision === identity.selectorDecisionReference &&
    interaction.partition.tenant === observation.token.tenant &&
    interaction.partition.project === observation.token.project &&
    JSON.stringify(interaction.observedToken) ===
      JSON.stringify(observation.token) &&
    JSON.stringify(interaction.observedView) ===
      JSON.stringify(observation.candidates) &&
    JSON.stringify(interaction.context) ===
      JSON.stringify({
        operationalContext: observation.operationalContext,
        workingMemory: observation.workingMemory,
      })
  );
}

/** Runs one independently timed selector observation and durably records waiting or delivery. */
export async function runSelectorCycle(
  state: SelectorProjectState,
  source: SelectorObservationSource,
  store: SelectorStateStore,
  policy: SelectorPolicy,
  identity: SelectorCycleIdentity,
  settings: SelectorRuntimeSettings,
): Promise<SelectorProposal | undefined> {
  const observation = await observeSelectorProject(state, source);
  if (observation === undefined) return undefined;
  const observedAt = observation.operationalContext.observedAtEpochMs;
  const currentTime = await source.currentTimeEpochMs();
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(currentTime) ||
    observedAt > currentTime ||
    currentTime - observedAt > settings.operationalContextMaxAgeMs
  )
    return undefined;
  const result = await Promise.race([
    policy.decide(observation, settings),
    source.decisionDeadline(settings.limits.millisecondsPerDecision),
  ]);
  enforcePolicyControls(result, settings);
  if (!interactionMatchesObservation(result, observation, identity))
    throw new Error("selector policy provenance contradicts its observation");
  if (
    result.interaction.instructionsVersion !== String(settings.revision) ||
    result.interaction.instructions !== settings.basePrompt
  )
    throw new Error(
      "selector policy provenance contradicts its runtime prompt",
    );
  const selected = observation.candidates.find(
    (candidate) => candidate.ticket === result.selectedTicket,
  );
  if (result.selectedTicket !== undefined && selected === undefined)
    throw new Error("selector policy chose a ticket outside its observed view");
  const nextState: SelectorProjectState = {
    partition: state.partition,
    notificationCursor: observation.notificationCursor,
    recoveryEpoch: observation.token.recoveryEpoch,
    attention: result.attention,
    workingMemory: result.workingMemory,
  };
  if (selected === undefined) {
    await store.recordInteraction(
      result.interaction,
      nextState,
      result.planningIntent,
    );
    return undefined;
  }
  const proposal: SelectorProposal = {
    interaction: result.interaction,
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
  await store.record(proposal, nextState);
  return proposal;
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
  await store.terminal(delivery.decision, outcome);
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
