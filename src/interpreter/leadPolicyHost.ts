/**
 * The selector policy that is a turn on the project's lead: it observes the
 * lead through the mailbox, waits for the turn to end, and answers the decision
 * the turn came back with.
 *
 * A PROJECT WITHOUT A LEAD IS ONE THE SELECTOR CANNOT DECIDE FOR. Opening one
 * here would be provisioning, which no runtime role may do, so an absent or
 * closed lead raises and the cycle is recorded as failed.
 *
 * THE TURN'S IDENTITY IS THE DECISION'S, WHICH IS WHAT MAKES THE OFFER
 * IDEMPOTENT. A retry of one decision finds the turn it already enqueued rather
 * than putting a second one in the mailbox.
 *
 * A WITHDRAWAL IS THE TERMINATION PROOF. A turn moved out of the mailbox can
 * never be answered — the plane answers a pod that tries with a conflict — so
 * both `Withdrawn` and `AlreadyEnded` are terminations, and only finding no
 * turn at all leaves the decision unconfirmed.
 *
 * A RESTART LOSES ONE TURN PER IN-FLIGHT PROJECT, DELIBERATELY. The turn row
 * survives the process and the promise over it does not, so the next pass finds
 * the decision quarantined and the project decides again on its next change.
 * Re-attaching would mean minting the decision reference from the project
 * rather than from a uuid, which would let two concurrent decisions for one
 * project collide on one identity.
 *
 * A TURN WITH NO MEASUREMENT IS A DECISION WITH NO PROVENANCE. The controls
 * over a decision are checked against what the pod measured, never against what
 * the model wrote, so an unmeasured turn is answered as an unknown model and
 * nothing spent — which the model allowlist then refuses unless it admits
 * everything. A control that cannot see what it controls refuses.
 */

import {
  asSessionTurnId,
  type SessionTurnId,
  type SessionTurnMeasured,
  type SessionTurnState,
} from "./agentSession.ts";
import type {
  AgenticRefusalRead,
  AgenticRefusalRecord,
} from "./agenticRefusal.ts";
import type {
  LeadMailbox,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "./leadMailbox.ts";
import {
  leadObservationText,
  leadObservedRefusals,
  leadTurnDocumentVersion,
  parseLeadDecision,
  type LeadObservationDocument,
  type LeadObservedRefusal,
  type LeadSeeding,
  type LeadSeedingDecision,
} from "./leadTurn.ts";
import { asProjectId, asTenantId, type Partition } from "./projectStore.ts";
import {
  leadRefusalsObservedMax,
  leadSeedingDecisionsMax,
  type SelectorInteractionRecord,
  type SelectorPolicyExecution,
  type SelectorPolicyRequest,
  type SelectorTerminationResult,
} from "./selector.ts";
import type { SelectorPolicy } from "./selectorPolicyHost.ts";

/**
 * The tail of the decision log a seeding turn carries, newest last. It is a
 * port of its own rather than `SelectorStateStore.history`, which pages forward
 * from a cursor and so answers a project's oldest decisions rather than its
 * latest.
 */
export interface LeadDecisionTail {
  tail(
    partition: Partition,
    limit: number,
  ): Promise<readonly SelectorInteractionRecord[]>;
}

/**
 * One reading of the host's clock. The instant is what a turn is stamped with
 * and the epoch is what an unmeasured turn's duration is taken from, and they
 * are one reading rather than two so a duration is never the difference between
 * two clocks.
 */
export interface LeadPolicyReading {
  readonly instant: string;
  readonly epochMs: number;
}

/** The two things this host needs of time: what to stamp a turn with, and how to wait. */
export interface LeadPolicyClock {
  now(): Promise<LeadPolicyReading>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface LeadPolicyConfig {
  readonly pollIntervalMs: number;
  readonly implementationRevision: string;
}

/** What a turn that measured nothing is answered as, so a control still decides. */
const leadTurnUnmeasured = "Unavailable";

/** What a decision by a session with no bound agent reference is attributed to. */
const leadSessionUnbound = "Unbound";

/** The two states a turn is still in the mailbox for. */
const leadTurnRunning: readonly SessionTurnState[] = ["Queued", "Claimed"];

/**
 * How many decisions this process remembers the project of. An entry lives from
 * the offer until the decision is withdrawn or answered, so the map is the
 * in-flight set plus the decisions waiting to be reconciled; the bound is what
 * keeps a mailbox that refuses every withdrawal from growing it without end.
 */
const leadOfferedRetainedMax = 1_024;

function checkedPollInterval(milliseconds: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1)
    throw new RangeError("lead policy poll interval must be positive");
  return milliseconds;
}

/** The project a decision is for, which is the one its observed view is pinned to. */
function leadPartition(request: SelectorPolicyRequest): Partition {
  return {
    tenant: asTenantId(request.observation.token.tenant),
    project: asProjectId(request.observation.token.project),
  };
}

function leadRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function leadSeedingTickets(value: unknown): LeadSeedingDecision["dispatched"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((member: unknown) => {
    const ticket = leadRecord(member)?.["ticket"];
    return Number.isSafeInteger(ticket)
      ? [ticket as LeadSeedingDecision["dispatched"][number]]
      : [];
  });
}

/**
 * One past decision as a successor needs it: what it did, never what it saw. A
 * cycle that failed decided nothing and carries no attention, so it is not in
 * the tail — an empty summary of a failure would read as a choice to do
 * nothing.
 */
function leadSeedingDecision(
  record: SelectorInteractionRecord,
): readonly LeadSeedingDecision[] {
  const result = leadRecord(record.result);
  if (result === undefined) return [];
  const attention = result["attention"];
  if (
    attention !== "Monitoring" &&
    attention !== "Attention" &&
    attention !== "Stopped"
  )
    return [];
  return [
    {
      ordinal: record.ordinal,
      decision: record.decision,
      completedAt: record.completedAt,
      dispatched: leadSeedingTickets(result["dispatches"]),
      refused: leadSeedingTickets(result["refusals"]),
      attention,
    },
  ];
}

function leadObservationDocument(
  request: SelectorPolicyRequest,
  partition: Partition,
  refusals: readonly LeadObservedRefusal[],
  seeding: LeadSeeding | undefined,
): LeadObservationDocument {
  return {
    version: leadTurnDocumentVersion,
    decision: request.attempt,
    partition,
    instructions: request.instructions,
    ...(seeding === undefined ? {} : { seeding }),
    changes: request.observation.changes,
    candidates: request.observation.candidates,
    token: request.observation.token,
    operationalContext: request.observation.operationalContext,
    handoffNote: request.observation.handoffNote,
    refusals,
  };
}

/**
 * The turn's input text, shrunk until the mailbox row holds it. The seeded
 * decision tail goes oldest first and the seeded refusals go next; the handoff
 * note, the cursor and the refusals the decision will be checked against are
 * never dropped, because a lead shown fewer refusals than it is judged on could
 * lift one it was never told about.
 */
function leadTurnInput(
  request: SelectorPolicyRequest,
  partition: Partition,
  refusals: readonly LeadObservedRefusal[],
  seeding: LeadSeeding | undefined,
): string {
  let current = seeding;
  for (;;) {
    try {
      return leadObservationText(
        leadObservationDocument(request, partition, refusals, current),
      );
    } catch (error) {
      if (!(error instanceof RangeError) || current === undefined) throw error;
      if (current.decisions.length > 0)
        current = { ...current, decisions: current.decisions.slice(1) };
      else if (current.refusals.length > 0)
        current = { ...current, refusals: [] };
      else throw error;
    }
  }
}

function leadTurnAccounting(
  measured: SessionTurnMeasured | undefined,
  started: LeadPolicyReading,
  completed: LeadPolicyReading,
): SelectorPolicyExecution["accounting"] {
  return measured === undefined
    ? {
        tokens: 0,
        durationMs: Math.max(0, completed.epochMs - started.epochMs),
      }
    : {
        tokens: measured.tokens,
        durationMs: measured.durationMs,
        costMicros: measured.costMicros,
      };
}

/** What one lead session's mailbox and record answer for one project. */
interface LeadPolicyPorts {
  readonly mailbox: LeadMailbox;
  readonly refusals: AgenticRefusalRead;
  readonly decisions: LeadDecisionTail;
  readonly clock: LeadPolicyClock;
  readonly config: LeadPolicyConfig;
}

async function leadSeedingBlock(
  ports: LeadPolicyPorts,
  request: SelectorPolicyRequest,
  partition: Partition,
  observed: readonly LeadObservedRefusal[],
): Promise<LeadSeeding> {
  return {
    handoffNote: request.observation.handoffNote,
    decisions: (
      await ports.decisions.tail(partition, leadSeedingDecisionsMax)
    ).flatMap(leadSeedingDecision),
    refusals: observed,
    notificationCursor: request.observation.notificationCursor,
  };
}

/** Polls the turn until it leaves the mailbox, or until the run is abandoned. */
async function leadTurnSettled(
  ports: LeadPolicyPorts,
  partition: Partition,
  turn: SessionTurnId,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<LeadTurnStanding> {
  for (;;) {
    signal.throwIfAborted();
    const standing = await ports.mailbox.turn(partition, turn);
    if (standing === undefined)
      throw new Error("the lead turn this decision offered is gone");
    if (!leadTurnRunning.includes(standing.state)) return standing;
    await ports.clock.wait(pollIntervalMs, signal);
  }
}

async function leadTurnOffer(
  ports: LeadPolicyPorts,
  request: SelectorPolicyRequest,
  partition: Partition,
  standing: readonly AgenticRefusalRecord[],
  agentReference: string | undefined,
): Promise<SessionTurnId> {
  const observed = leadObservedRefusals(
    standing,
    request.observation.candidates,
  );
  const input = leadTurnInput(
    request,
    partition,
    observed,
    agentReference === undefined
      ? await leadSeedingBlock(ports, request, partition, observed)
      : undefined,
  );
  const turn = asSessionTurnId(request.attempt);
  const enqueued = await ports.mailbox.offer({ partition, turn, input });
  if (enqueued.offered !== "Enqueued" && enqueued.offered !== "AlreadyEnqueued")
    throw new Error("the lead mailbox took no turn for this decision", {
      cause: enqueued.offered,
    });
  return turn;
}

function leadTermination(
  attempt: string,
  turn: SessionTurnId,
  withdrawn: LeadTurnWithdrawn,
): SelectorTerminationResult {
  return withdrawn === "NoTurn"
    ? { status: "Unconfirmed" }
    : {
        status: "Terminated",
        attempt,
        proof: `lead turn ${turn} ${withdrawn}`,
      };
}

function leadTurnUnanswered(standing: LeadTurnStanding): Error {
  return new Error("the lead turn ended without an answer", {
    cause: standing.failure ?? standing.state,
  });
}

/** One decision, from the lead it is asked of to the envelope it is answered in. */
async function leadDecision(
  ports: LeadPolicyPorts,
  request: SelectorPolicyRequest,
  pollIntervalMs: number,
  signal: AbortSignal,
  retain: (attempt: string, partition: Partition) => void,
): Promise<SelectorPolicyExecution> {
  const partition = leadPartition(request);
  const lead = await ports.mailbox.lead(partition);
  if (lead === undefined || lead.state !== "Open")
    throw new Error("the project has no open lead to decide for it");
  const standing = await ports.refusals.standing(
    partition,
    leadRefusalsObservedMax,
  );
  const started = await ports.clock.now();
  retain(request.attempt, partition);
  const turn = await leadTurnOffer(
    ports,
    request,
    partition,
    standing,
    lead.agentReference,
  );
  const answered = await leadTurnSettled(
    ports,
    partition,
    turn,
    pollIntervalMs,
    signal,
  );
  const completed = await ports.clock.now();
  if (answered.state !== "Answered" || answered.result === undefined)
    throw leadTurnUnanswered(answered);
  return {
    result: parseLeadDecision(answered.result, request.observation, standing),
    implementationRevision: ports.config.implementationRevision,
    modelRevision: answered.measured?.model ?? leadTurnUnmeasured,
    policyRevision: lead.agentReference ?? leadSessionUnbound,
    toolActivity: (answered.measured?.tools ?? []).map((tool) => ({ tool })),
    accounting: leadTurnAccounting(answered.measured, started, completed),
    startedAt: started.instant,
    completedAt: completed.instant,
  };
}

/** A decision is a turn on the project's lead, and the turn's result is the decision. */
export function leadSelectorPolicy(
  mailbox: LeadMailbox,
  refusals: AgenticRefusalRead,
  decisions: LeadDecisionTail,
  clock: LeadPolicyClock,
  config: LeadPolicyConfig,
): SelectorPolicy {
  const ports: LeadPolicyPorts = {
    mailbox,
    refusals,
    decisions,
    clock,
    config,
  };
  const pollIntervalMs = checkedPollInterval(config.pollIntervalMs);
  const offered = new Map<string, Partition>();

  const retain = (attempt: string, partition: Partition): void => {
    offered.set(attempt, partition);
    for (const oldest of offered.keys()) {
      if (offered.size <= leadOfferedRetainedMax) break;
      offered.delete(oldest);
    }
  };

  const withdraw = async (
    attempt: string,
  ): Promise<SelectorTerminationResult> => {
    const partition = offered.get(attempt);
    if (partition === undefined) return { status: "Unconfirmed" };
    const turn = asSessionTurnId(attempt);
    const termination = leadTermination(
      attempt,
      turn,
      await mailbox.withdraw(partition, turn),
    );
    offered.delete(attempt);
    return termination;
  };

  return {
    execute: async (request, signal) => {
      const execution = await leadDecision(
        ports,
        request,
        pollIntervalMs,
        signal,
        retain,
      );
      offered.delete(request.attempt);
      return execution;
    },
    cancel: (attempt) => withdraw(attempt),
    inspect: (attempt) => withdraw(attempt),
  };
}
