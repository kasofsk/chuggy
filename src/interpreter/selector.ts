import type { DispatchCandidate, DispatchViewToken } from "./dispatchView.ts";
import type { Accepted, OperationId, TicketCommand } from "./operationInbox.ts";
import type { OperationResource } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { NotificationBatch, NotificationCursor } from "./notifications.ts";
import type { DispatchViewPage, DispatchViewQuery } from "./dispatchView.ts";

export interface SelectorInteraction {
  readonly decision: string;
  readonly partition: Partition;
  readonly instructionsVersion: string;
  readonly instructions: string;
  readonly observedView: readonly DispatchCandidate[];
  readonly context: unknown;
  readonly toolActivity: readonly unknown[];
  readonly result: unknown;
  readonly implementationRevision: string;
  readonly modelRevision: string;
  readonly policyRevision: string;
  readonly accounting: unknown;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface StoredSelectorInteraction extends SelectorInteraction {
  readonly ordinal: number;
}

export interface SelectorProposal {
  readonly interaction: SelectorInteraction;
  readonly operation: OperationId;
  readonly command: Extract<
    TicketCommand,
    { readonly command: "ProposeDispatch" }
  >;
  readonly planningIntent?: unknown;
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
  advanceInventoryCursor(
    previous: Partition | undefined,
    next: Partition | undefined,
  ): Promise<boolean>;
  recordInteraction(
    interaction: SelectorInteraction,
    previous: SelectorProjectState,
    next: SelectorProjectState,
    planningIntent?: unknown,
  ): Promise<boolean>;
  record(
    proposal: SelectorProposal,
    previous: SelectorProjectState,
    next: SelectorProjectState,
  ): Promise<boolean>;
  pending(limit: number): Promise<readonly SelectorDelivery[]>;
  submittedDeliveries(limit: number): Promise<readonly SelectorDelivery[]>;
  submitted(decision: string): Promise<void>;
  retry(decision: string, delayMilliseconds: number): Promise<void>;
  terminal(decision: string, outcome: SelectorTerminalOutcome): Promise<void>;
  history(
    partition: Partition,
    after: number | undefined,
    limit: number,
  ): Promise<readonly StoredSelectorInteraction[]>;
  project(partition: Partition): Promise<SelectorProjectState | undefined>;
}

export interface SelectorProjectState {
  readonly partition: Partition;
  readonly notificationCursor: number;
  readonly recoveryEpoch?: string;
  readonly attention: "Monitoring" | "Attention" | "Stopped";
}

export interface SelectorObservationSource {
  notifications(
    partition: Partition,
    cursor: NotificationCursor,
  ): Promise<NotificationBatch>;
  dispatchView(
    partition: Partition,
    query: DispatchViewQuery,
  ): Promise<DispatchViewPage>;
}

export interface SelectorObservation {
  readonly token: DispatchViewToken;
  readonly candidates: readonly DispatchCandidate[];
  readonly notificationCursor: number;
}

export interface SelectorPolicyResult {
  readonly interaction: SelectorInteraction;
  readonly selectedTicket?: DispatchCandidate["ticket"];
  readonly planningIntent?: unknown;
  readonly attention: SelectorProjectState["attention"];
}

export interface SelectorPolicy {
  decide(observation: SelectorObservation): Promise<SelectorPolicyResult>;
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
    JSON.stringify(interaction.observedView) ===
      JSON.stringify(observation.candidates)
  );
}

/** Runs one independently timed selector observation and durably records waiting or delivery. */
export async function runSelectorCycle(
  state: SelectorProjectState,
  source: SelectorObservationSource,
  store: SelectorStateStore,
  policy: SelectorPolicy,
  identity: SelectorCycleIdentity,
): Promise<SelectorProposal | undefined> {
  const observation = await observeSelectorProject(state, source);
  if (observation === undefined) return undefined;
  const result = await policy.decide(observation);
  if (!interactionMatchesObservation(result, observation, identity))
    throw new Error("selector policy provenance contradicts its observation");
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
  };
  if (selected === undefined) {
    const recorded = await store.recordInteraction(
      result.interaction,
      state,
      nextState,
      result.planningIntent,
    );
    if (!recorded) return undefined;
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
    ...(result.planningIntent === undefined
      ? {}
      : { planningIntent: result.planningIntent }),
  };
  return (await store.record(proposal, state, nextState))
    ? proposal
    : undefined;
}

/**
 * The most view pages one observation walks. The walk follows a cursor the
 * ticket service hands back, so a source that keeps handing one back would walk
 * for as long as it kept doing so and grow the candidate list with it; the
 * bound is what makes both finite, and the observed view is at most this many
 * pages of the view's own limit.
 */
export const selectorViewPagesMax = 100;

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
  let walked = 0;
  do {
    if (walked === selectorViewPagesMax)
      throw new RangeError("selector dispatch view outran its page bound");
    walked += 1;
    const page = await source.dispatchView(state.partition, {
      ...(after === undefined ? {} : { after }),
      limit: pageLimit,
      ...(token === undefined ? {} : { token }),
    });
    if (page.result === "Reset") return undefined;
    token ??= page.token;
    candidates.push(...page.candidates);
    after = page.nextAfter;
  } while (after !== undefined);
  return token === undefined
    ? undefined
    : { token, candidates, notificationCursor: notifications.cursor };
}

export interface SelectorTicketService {
  submit(delivery: SelectorDelivery): Promise<Accepted>;
}

export interface SelectorOperationSource {
  operation(
    partition: Partition,
    operation: OperationId,
  ): Promise<OperationResource | undefined>;
}

export type SelectorTerminalOutcome =
  | Exclude<OperationResource, { readonly state: "Pending" }>
  | Extract<
      Accepted,
      { readonly accepted: "IdempotencyConflict" | "InvalidCommand" }
    >;

export type SelectorDeliveryFailureCode =
  | "SubmissionFailed"
  | "Backpressure"
  | "Unavailable"
  | "NotAdmitted"
  | "IdempotencyConflict"
  | "InvalidCommand";

export interface SelectorDeliveryFailure {
  readonly code: SelectorDeliveryFailureCode;
  readonly message: string;
}

export type SelectorDeliveryResult =
  | { readonly result: "Delivered"; readonly decision: string }
  | {
      readonly result: "Retry";
      readonly decision: string;
      readonly failure: SelectorDeliveryFailure;
    }
  | {
      readonly result: "Terminal";
      readonly decision: string;
      readonly failure: SelectorDeliveryFailure;
    };

const retryAfterMillisecondsMax = 24 * 60 * 60_000;

function retryDelayMilliseconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new RangeError("ticket-service retry delay must be positive");
  return Math.min(Math.ceil(seconds * 1_000), retryAfterMillisecondsMax);
}

/** Delivers durable proposals at least once; operation idempotency absorbs ambiguous retries. */
export async function deliverSelectorProposal(
  store: SelectorStateStore,
  ticketService: SelectorTicketService,
  delivery: SelectorDelivery,
): Promise<SelectorDeliveryResult> {
  let accepted: Accepted;
  try {
    accepted = await ticketService.submit(delivery);
  } catch {
    return {
      result: "Retry",
      decision: delivery.decision,
      failure: {
        code: "SubmissionFailed",
        message: "ticket-service submission failed",
      },
    };
  }
  if (accepted.accepted === "Accepted" || accepted.accepted === "Original") {
    await store.submitted(delivery.decision);
    return { result: "Delivered", decision: delivery.decision };
  }
  if (
    accepted.accepted === "IdempotencyConflict" ||
    accepted.accepted === "InvalidCommand"
  ) {
    await store.terminal(delivery.decision, accepted);
    return {
      result: "Terminal",
      decision: delivery.decision,
      failure: {
        code: accepted.accepted,
        message: "ticket service terminally refused selector proposal",
      },
    };
  }
  if (
    accepted.accepted === "Backpressure" ||
    accepted.accepted === "Unavailable"
  )
    await store.retry(
      delivery.decision,
      retryDelayMilliseconds(accepted.retryAfterSeconds),
    );
  return {
    result: "Retry",
    decision: delivery.decision,
    failure: {
      code: accepted.accepted,
      message: "ticket service deferred selector proposal",
    },
  };
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
  if (outcome === undefined)
    throw new Error("selector accepted operation is unavailable");
  if (outcome.state === "Pending") return false;
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
