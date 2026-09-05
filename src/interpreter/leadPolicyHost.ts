/**
 * The selector policy that is a turn on the project's lead: it observes the
 * lead through the mailbox, waits for the turn to end, and answers the decision
 * the turn came back with.
 *
 * A PROJECT WITH NO OPEN LEAD GETS A SUCCESSOR, AND THE RECORD IS WHAT MAKES
 * ONE SUFFICIENT. A lead that closed is a context that ended, not a claim on
 * the project for ever, so the cycle opens the next one and decides through it.
 * The successor is seeded like any lead with no bound runtime reference — the
 * handoff note, the tail of the decision log, the standing refusals and the
 * cursor — which is the same block `leadSeedingBlock` composes below. Closing a
 * lead is still provisioning and is still no runtime role's.
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
 * IT HOLDS NO STATE OF ITS OWN. Reading and withdrawing name the turn, which is
 * the decision, so a process that never offered a turn can still settle it: a
 * restart's quarantined decisions reconcile from the row rather than from a map
 * that did not survive. A restart still loses the turn in flight, because the
 * promise over it did not survive, and the project decides again on its next
 * change.
 *
 * THE OBSERVATION SHEDS ONLY WHAT A SUCCESSOR CAN DO WITHOUT. The composed
 * objectives, the handoff note, the cursor and the refusals a decision is
 * judged against are never shed — a lead shown fewer refusals than it is judged
 * on could lift one it was never told about — so only the seeded decision tail
 * and the seeded refusals shrink, and a document those fixed parts alone
 * overflow is refused with what overflowed rather than emptied until it fits.
 *
 * A TURN WITH NO MEASUREMENT IS A DECISION WITH NO PROVENANCE. The controls
 * over a decision are checked against what the pod measured, never against what
 * the model wrote, so an unmeasured turn is answered as an unknown model and
 * nothing spent — which the model allowlist then refuses unless it admits
 * everything. A control that cannot see what it controls refuses.
 */

import { leadSeedingDecisionsMax } from "../contract/http.ts";
import {
  asSessionTurnId,
  type SessionTurnId,
  type SessionTurnMeasured,
  type SessionTurnState,
} from "./agentSession.ts";
import type {
  LeadMailbox,
  LeadSessionMint,
  LeadSessionStanding,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "./leadMailbox.ts";
import { leadSystemPrompt } from "./leadTools.ts";
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
import type {
  SelectorInteractionRecord,
  SelectorPolicyExecution,
  SelectorPolicyRequest,
  SelectorTerminationResult,
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
  /**
   * Whose authorization a lead this process opens acts under, which is this
   * process's own principal: the lead speaks through the membership the
   * installation already grants the selector, and a second configured identity
   * would be a second thing to keep in step with that membership.
   */
  readonly principal: string;
  /** The named credential mount a lead's pod speaks through, which a deployment decides. */
  readonly credentialSlot: string;
}

/** What a turn that measured nothing is answered as, so a control still decides. */
const leadTurnUnmeasured = "Unavailable";

/** What a decision by a session with no bound agent reference is attributed to. */
const leadSessionUnbound = "Unbound";

/** The two states a turn is still in the mailbox for. */
const leadTurnRunning: readonly SessionTurnState[] = ["Queued", "Claimed"];

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

/**
 * The objectives one turn carries: this installation's base prompt, the
 * project's North Star and what the lead's own tools mean, composed once here.
 * The North Star is inside them rather than beside them, so the turn weighs it
 * once and the mailbox's derived ceiling counts it once.
 */
function leadTurnInstructions(
  request: SelectorPolicyRequest,
): NonNullable<LeadObservationDocument["instructions"]> {
  return {
    revision: request.instructions.revision,
    content: leadSystemPrompt({
      basePrompt: request.instructions.content,
      ...(request.instructions.northStar === undefined
        ? {}
        : { northStar: request.instructions.northStar }),
    }),
  };
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
    instructions: leadTurnInstructions(request),
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
 * The turn's input text, shed until the mailbox row holds it. Only the seeded
 * decision tail, oldest first, and then the seeded refusals are shed; when
 * there is nothing sheddable left the document is refused rather than emptied.
 */
export function leadTurnInput(
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
      if (!(error instanceof RangeError)) throw error;
      if (
        current === undefined ||
        current.decisions.length + current.refusals.length === 0
      )
        throw new RangeError(leadTurnOverflowed(current), { cause: error });
      current =
        current.decisions.length > 0
          ? { ...current, decisions: current.decisions.slice(1) }
          : { ...current, refusals: [] };
    }
  }
}

/**
 * What overflowed, said rather than implied. The mailbox ceiling is derived
 * from these parts at their own ceilings, so reaching this is a part the
 * derivation does not cover and the reason has to name where to look.
 */
function leadTurnOverflowed(seeding: LeadSeeding | undefined): string {
  return seeding === undefined
    ? "lead observation exceeds its mailbox row with nothing sheddable in it: objectives, handoff note, cursor and refusals alone"
    : "lead observation exceeds its mailbox row with its seeding shed to nothing: objectives, handoff note, cursor and refusals alone";
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
  readonly decisions: LeadDecisionTail;
  readonly sessions: LeadSessionMint;
  readonly clock: LeadPolicyClock;
  readonly config: LeadPolicyConfig;
}

/**
 * The lead this decision is taken by, opening a successor where the project has
 * none open. The standing is re-read rather than assembled from what opening
 * answered, because `AlreadyOpen` names a session this process did not write
 * and whose runtime reference decides whether the next turn is seeded.
 */
async function leadStanding(
  ports: LeadPolicyPorts,
  request: SelectorPolicyRequest,
  partition: Partition,
): Promise<LeadSessionStanding> {
  const held = await ports.mailbox.lead(partition);
  if (held !== undefined && held.state === "Open") return held;
  await ports.mailbox.openLead({
    partition,
    session: ports.sessions.session(),
    principal: ports.config.principal,
    credentialSlot: ports.config.credentialSlot,
    systemPrompt: leadTurnInstructions(request).content,
  });
  const opened = await ports.mailbox.lead(partition);
  if (opened === undefined || opened.state !== "Open")
    throw new Error("the project has no open lead to decide for it");
  return opened;
}

async function leadSeedingBlock(
  ports: LeadPolicyPorts,
  request: SelectorPolicyRequest,
  partition: Partition,
  observed: readonly LeadObservedRefusal[],
): Promise<LeadSeeding> {
  return {
    handoffNote: request.observation.handoffNote,
    decisions: [
      ...(await ports.decisions.tail(partition, leadSeedingDecisionsMax)),
    ]
      .reverse()
      .flatMap(leadSeedingDecision),
    refusals: observed,
    notificationCursor: request.observation.notificationCursor,
  };
}

/** Polls the turn until it leaves the mailbox, or until the run is abandoned. */
async function leadTurnSettled(
  ports: LeadPolicyPorts,
  turn: SessionTurnId,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<LeadTurnStanding> {
  for (;;) {
    signal.throwIfAborted();
    const standing = await ports.mailbox.turn(turn);
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
  agentReference: string | undefined,
): Promise<SessionTurnId> {
  const observed = leadObservedRefusals(
    request.observation.refusals,
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
): Promise<SelectorPolicyExecution> {
  const partition = leadPartition(request);
  const lead = await leadStanding(ports, request, partition);
  const started = await ports.clock.now();
  const turn = await leadTurnOffer(
    ports,
    request,
    partition,
    lead.agentReference,
  );
  const answered = await leadTurnSettled(ports, turn, pollIntervalMs, signal);
  const completed = await ports.clock.now();
  if (answered.state !== "Answered" || answered.result === undefined)
    throw leadTurnUnanswered(answered);
  return {
    result: parseLeadDecision(answered.result, request.observation),
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
  decisions: LeadDecisionTail,
  sessions: LeadSessionMint,
  clock: LeadPolicyClock,
  config: LeadPolicyConfig,
): SelectorPolicy {
  const ports: LeadPolicyPorts = {
    mailbox,
    decisions,
    sessions,
    clock,
    config,
  };
  const pollIntervalMs = checkedPollInterval(config.pollIntervalMs);
  const withdraw = async (
    attempt: string,
  ): Promise<SelectorTerminationResult> => {
    const turn = asSessionTurnId(attempt);
    return leadTermination(attempt, turn, await mailbox.withdraw(turn));
  };
  return {
    execute: (request, signal) =>
      leadDecision(ports, request, pollIntervalMs, signal),
    cancel: (attempt) => withdraw(attempt),
    inspect: (attempt) => withdraw(attempt),
  };
}
