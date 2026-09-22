/**
 * The project ticket writer: what the ticket service does between holding a lease and
 * holding a committed decision.
 *
 * MEMORY ADVANCES ONLY AFTER COMMIT, and that is the whole reason this module
 * exists rather than the caller wiring the two ports together. The decision is
 * computed against the state in hand, offered to the durable authority, and
 * only then installed — so a fenced writer, a stale head or an operation
 * somebody already settled leaves the writer holding exactly the state it
 * started from, and reloading is the only way forward.
 *
 * THE DECISION IS COMPUTED BEFORE THE TRANSACTION OPENS.
 * issue #180 permits that to keep the
 * transaction short, and requires that a failed recheck discard the result and
 * reload. Both halves are here: nothing below awaits between the plan and the
 * commit, and nothing installs a plan the commit refused.
 *
 * COMMANDS ARRIVE PARSED AND CLASSIFIED. Structural readability, admission and
 * priority belong to authenticated ingress; this writer alone decides whether
 * the requested domain transition is enabled at its serialized position.
 *
 * AN UNREADABLE EXECUTION SOURCE IS AN OUTCOME, NOT A FAULT. What a remote
 * holds is a fact about the world rather than a contradiction in this
 * partition's journal, so a source the writer cannot read lands as a coded
 * refusal, as a ticket parked on the desk, or as a deferral a later quantum
 * retries — never as a rejection that ends the run the input arrived in.
 *
 * THE PROJECTION IS DERIVED, NEVER OBSERVED. Its rows are a function of the
 * replayed `TicketGraph` alone, so rebuilding them from the journal and folding the
 * per-decision changes reach the same table — which is what makes it a
 * projection rather than a second authority.
 *
 * A DISPATCH FENCE NAMES A CANDIDATE, NOT A VIEW. A `ProposeDispatch` is
 * admitted on the identity of the view its author observed — tenant, project,
 * recovery epoch, schema version — and on the version of the one candidate it
 * names, never on a digest of the whole candidate set. The whole-view digest
 * attested that the alternatives the author chose among still existed, which is
 * a preference rather than a safety property: `decideDispatch` in
 * `model/domain.qnt` conforms with any policy over Ready tickets, and
 * `model/refinement.qnt` re-checks `Dispatch(j)` per ticket at its own prefix.
 * Requiring it also refused every dispatch a decision offered after its first,
 * because the first removes its own ticket from the set the rest are digested
 * against. What the digest covered of the named candidate, its version covers
 * alone: every field `canonicalCandidate` digests is either a ticket field
 * `ticketEquals` compares — so changing it stamps a new version — or a contract
 * pin written once when the ticket is released and never rewritten. The
 * token's digest stays on the command as provenance: which page the author saw.
 */

import type { Entry, StoredEntry } from "../actor/journal.ts";
import { genesis, storedJournalLegalOn } from "../actor/journal.ts";
import { ticketEquals } from "../actor/equality.ts";
import {
  decisionEventEnabled,
  execDecisionEvent,
  taskDoneEvent,
  workReduceEvent,
} from "../actor/decisionEvent.ts";
import type { DecisionEvent } from "../actor/decisionEvent.ts";
import type { Config } from "../domain/config.ts";
import { ticketAt, ticketIds } from "../domain/ticketGraph.ts";
import type { TicketGraph } from "../domain/generated/modelTypes.ts";
import { dependableIn } from "../domain/enablement.ts";
import { effectFromLabel } from "../domain/effect.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import type { DecisionInput } from "./projectDiscovery.ts";
import type { SchedulerCompletionEvent } from "./ticketCommand.ts";
import type {
  ExecutionSourceObservation,
  ExecutionSourceObservationPort,
} from "./executionSource.ts";
import type { GitEvidence } from "./finalizer.ts";
import type { ProjectDiscovery, Readiness } from "./projectDiscovery.ts";
import type {
  Decided,
  DecisionOutcome,
  ProjectDecision,
  RefusalCode,
  TicketProjection,
} from "./projectDecision.ts";
import type { Lease, ProjectStore } from "./projectStore.ts";
import { reworkDisposition, type ReworkCap } from "./reworkCap.ts";
import { materializationOf } from "./decisionPlan.ts";
import {
  deriveDispatchCandidates,
  dispatchViewDigest,
  type DispatchContractPin,
} from "./dispatchView.ts";
import { dispatchViewSchemaVersion } from "../contract/http.ts";
import type { TicketBriefPort } from "./ticketBrief.ts";
import {
  checkedTicketServiceConfig,
  observe,
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
  type TicketServiceMetrics,
} from "./ticketService.ts";

/** Everything a writer calls out through: the authority it replays from, and the one it commits to. */
export interface ProjectTicketWriter {
  readonly config: Config;
  /** The deployment's rework cap, which is what makes an evaluation failure's pick. */
  readonly rework: ReworkCap;
  readonly store: ProjectStore;
  readonly decisions: ProjectDecision;
  readonly executionSources: ExecutionSourceObservationPort;
  readonly ticketBriefs: TicketBriefPort;
}

/** What a writer holds between decisions: the lease that authorizes it, and the state it replayed. */
export interface ProjectMemory {
  readonly lease: Lease;
  readonly graph: TicketGraph;
  readonly ticketVersions: ReadonlyMap<number, number>;
  readonly dispatchContracts?: ReadonlyMap<number, DispatchContractPin>;
}

export class IntegrityContradiction extends Error {}

/**
 * What one input left the writer with: what the durable authority decided, or
 * the transient evidence that stopped a decision being offered for it at all.
 * A deferred input is still pending, so a later quantum decides it.
 */
export type InputDecided =
  Decided | { readonly decided: "Deferred"; readonly evidence: GitEvidence };

/** A decision's outcome and the memory it leaves behind, which is the old one unless it committed. */
export interface ProjectDecided {
  readonly memory: ProjectMemory;
  readonly decided: InputDecided;
}

/**
 * What the fabric said about the wall one decision parks a ticket at. It
 * travels beside the transition rather than inside it: which escalation a
 * block is, is the phase it interrupted, and the label is the fabric's account
 * of the wall, which no decider reads and no entry carries.
 */
export interface TicketEscalationEvidence {
  readonly ticket: TicketId;
  readonly evidence: string;
}

/**
 * Every ticket's current standing, which is the whole projection and the
 * rebuild of it. Every field is read off the same `TicketGraph` this decision left
 * behind, so no two of them can be at different journal positions — and the
 * evidence a decision carried lands on the one row it is about, which is
 * escalated or the decision contradicts itself.
 */
export function projectionOf(
  graph: TicketGraph,
  escalated?: TicketEscalationEvidence,
): readonly TicketProjection[] {
  const dependable = new Set(dependableIn(graph));
  if (
    escalated !== undefined &&
    ticketAt(graph, escalated.ticket).escalation === "NoEscalation"
  )
    throw new IntegrityContradiction(
      "a decision carries evidence for a ticket it did not escalate",
    );
  return ticketIds(graph).map((ticket) => {
    const value = ticketAt(graph, ticket);
    return {
      ticket,
      phase: value.phase,
      dependable: dependable.has(ticket),
      escalation: value.escalation,
      ...(escalated?.ticket === ticket
        ? { escalationEvidence: escalated.evidence }
        : {}),
    };
  });
}

/**
 * The projection rows one decision changed: a ticket it released, and a ticket
 * whose phase it moved. A ticket the decision left alone is not rewritten.
 */
export function projectionChanges(
  pre: TicketGraph,
  post: TicketGraph,
  escalated?: TicketEscalationEvidence,
): readonly TicketProjection[] {
  return projectionOf(post, escalated).filter((row) => {
    const previous = pre.tickets.get(row.ticket);
    return (
      previous === undefined ||
      !ticketEquals(previous, ticketAt(post, row.ticket))
    );
  });
}

/**
 * The journal this partition holds, refused loudly. A journal that does not
 * parse and a journal this machine could not have taken are both failures of
 * the writer's own book to be readable, which leaves no decision to take.
 */
async function projectWriterJournal(
  writer: ProjectTicketWriter,
  lease: Lease,
): Promise<readonly StoredEntry[]> {
  const loaded = await writer.store.load(lease);
  if (loaded.parsed === "Refused") {
    throw new Error(
      `project writer: the journal could not be replayed — ${loaded.why}`,
    );
  }
  if (!storedJournalLegalOn(writer.config, loaded.value)) {
    throw new Error(
      "project writer: the stored journal is not a history this machine could have taken",
    );
  }
  if (loaded.value.length !== lease.head) {
    throw new Error(
      `project writer: the lease claims head ${String(lease.head)} over ${String(loaded.value.length)} stored entr(ies)`,
    );
  }
  return loaded.value;
}

/** Rebuilds the writer's state from the journal alone, which is all a takeover inherits. */
export async function projectWriterLoad(
  writer: ProjectTicketWriter,
  lease: Lease,
): Promise<ProjectMemory> {
  const journal = await projectWriterJournal(writer, lease);
  const ticketVersions = new Map<number, number>();
  let graph: TicketGraph = genesis;
  for (const row of journal) {
    const post = execDecisionEvent(graph, row.entry.event).post;
    for (const projection of projectionChanges(graph, post))
      ticketVersions.set(projection.ticket, row.entry.seq);
    graph = post;
  }
  const dispatchContracts = await writer.store.loadDispatchContracts?.(lease);
  const memory = {
    lease,
    graph,
    ticketVersions,
    ...(dispatchContracts === undefined ? {} : { dispatchContracts }),
  };
  if (
    dispatchContracts !== undefined &&
    writer.decisions.rebuildDispatchView !== undefined
  ) {
    const candidates = deriveDispatchCandidates(
      writer.config,
      graph,
      ticketVersions,
      dispatchContracts,
    );
    await writer.decisions.rebuildDispatchView(lease, {
      digest: dispatchViewDigest(candidates),
      candidates,
    });
  }
  return memory;
}

/** A decision offered for commit, and the state it would install if it committed. */
interface ProjectPlan {
  readonly outcome: DecisionOutcome;
  readonly post: TicketGraph;
}

function continuationFenceOutcome(
  memory: ProjectMemory,
  source: Extract<DecisionInput["source"], { kind: "Continuation" }>,
): DecisionOutcome | undefined {
  const ticketId = source.reduction.ticket;
  if (memory.ticketVersions.get(ticketId) !== source.expectedTicketVersion)
    return { outcome: "Stale" };
  const ticket = ticketAt(memory.graph, ticketId);
  if (
    ticket.phase !== source.expectedPhase ||
    ticket.spawned !== source.taskSetGeneration
  )
    throw new IntegrityContradiction(
      "continuation fences contradict authoritative ticket state",
    );
  return undefined;
}

function operationDispatchFence(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  source: Extract<DecisionInput["source"], { kind: "Operation" }>,
): DecisionOutcome | undefined {
  if (source.command.command === "ManualDispatch")
    return memory.ticketVersions.get(source.command.ticket) ===
      source.command.expectedTicketVersion
      ? undefined
      : { outcome: "Refused", code: "TicketChanged" };
  if (source.command.command !== "ProposeDispatch") return undefined;
  if (memory.dispatchContracts === undefined)
    throw new Error(
      "project writer: strict dispatch contracts were not loaded",
    );
  const candidates = deriveDispatchCandidates(
    writer.config,
    memory.graph,
    memory.ticketVersions,
    memory.dispatchContracts,
  );
  const proposal = source.command;
  const token = proposal.observedViewToken;
  const selected = candidates.find(
    (candidate) => candidate.ticket === proposal.ticket,
  );
  return token.tenant === memory.lease.partition.tenant &&
    token.project === memory.lease.partition.project &&
    token.recoveryEpoch === memory.lease.recoveryEpoch &&
    token.schemaVersion === dispatchViewSchemaVersion &&
    selected?.ticketVersion === proposal.expectedTicketVersion
    ? undefined
    : { outcome: "Refused", code: "SelectionChanged" };
}

function journaledPlan(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  item: DecisionInput,
  command: DecisionEvent,
  executionSource: ExecutionSourceObservation | undefined,
): ProjectPlan {
  const decision = execDecisionEvent(memory.graph, command);
  const entry: Entry = {
    seq: memory.lease.head + 1,
    event: command,
    rec: decision.rec,
  };
  const projection = projectionChanges(
    memory.graph,
    decision.post,
    projectWriterEscalationEvidence(item, command, decision.post),
  );
  const versions = new Map(memory.ticketVersions);
  for (const row of projection) versions.set(row.ticket, entry.seq);
  const contracts = new Map(memory.dispatchContracts ?? []);
  if (
    item.source.kind === "Operation" &&
    item.source.draftRelease !== undefined
  )
    contracts.set(item.source.draftRelease.ticket, {
      configurationRevision: item.source.draftRelease.configurationRevision,
      configurationDigest: item.source.draftRelease.configurationDigest,
      configurationCanonical: item.source.draftRelease.configurationCanonical,
    });
  const materializeView =
    memory.dispatchContracts !== undefined ||
    (item.source.kind === "Operation" &&
      item.source.draftRelease !== undefined);
  const candidates = materializeView
    ? deriveDispatchCandidates(
        writer.config,
        decision.post,
        versions,
        contracts,
      )
    : undefined;
  return {
    outcome: {
      outcome: "Journaled",
      entry,
      projection,
      materialization: materializationOf(
        item,
        memory.graph,
        decision.post,
        entry,
        executionSource,
      ),
      ...(candidates === undefined
        ? {}
        : {
            dispatchView: {
              digest: dispatchViewDigest(candidates),
              candidates,
            },
          }),
    },
    post: decision.post,
  };
}

/**
 * The completion as this writer decides it: what the boundary settled, plus
 * the edge a failing stage would be taken on. THE PICK IS MADE HERE BECAUSE
 * THIS IS WHERE IT CAN BE — the cap is this service's configuration and the
 * count is read off the ticket replayed to this position, neither of which the
 * scheduler's boundary holds, and it rides every completion because the event
 * is one shape while only a stage that failed consults it.
 */
function completionEvent(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  completion: SchedulerCompletionEvent,
): DecisionEvent {
  const ticket = asTicketId(completion.value.ticket);
  const held = memory.graph.tickets.get(ticket);
  return taskDoneEvent(
    ticket,
    completion.value.task,
    completion.value.report,
    held === undefined
      ? "EscalateEvaluationFailure"
      : reworkDisposition(held, writer.rework.cyclesMax),
  );
}

/**
 * What one inbox item asks of the state in hand: a decision the machine would
 * take, or the refusal it earns. Nothing here reaches the world.
 */
function projectWriterPreflight(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  item: DecisionInput,
): ProjectPlan | { readonly command: DecisionEvent } {
  if (item.source.kind === "Operation") {
    const fence = operationDispatchFence(writer, memory, item.source);
    if (fence !== undefined) return { outcome: fence, post: memory.graph };
  }
  if (item.source.kind === "Continuation") {
    const fenceOutcome = continuationFenceOutcome(memory, item.source);
    if (fenceOutcome !== undefined)
      return { outcome: fenceOutcome, post: memory.graph };
  }
  const command =
    item.source.kind === "Operation"
      ? item.source.completion === undefined
        ? item.source.resolvedEvent
        : completionEvent(writer, memory, item.source.completion)
      : workReduceEvent(item.source.reduction.ticket);
  if (
    item.source.kind === "Operation" &&
    (item.source.nativeAction?.open === false ||
      item.source.finalizationRequest?.open === false)
  ) {
    return {
      outcome: { outcome: "Refused", code: "NotEnabled" },
      post: memory.graph,
    };
  }
  const answer =
    item.source.kind === "Operation" ? item.source.nativeAction : undefined;
  if (command === undefined) {
    if (answer === undefined)
      throw new Error(
        "project writer: an input names neither event nor answer",
      );
    return { outcome: { outcome: "Answered", answer }, post: memory.graph };
  }
  if (!decisionEventEnabled(writer.config, memory.graph, command)) {
    return {
      outcome: { outcome: "Refused", code: "NotEnabled" },
      post: memory.graph,
    };
  }
  return { command };
}

/** What the source a decision's spawns would run on was observed to be. */
type SpawnSourceObserved =
  | {
      readonly observed: "Source";
      readonly source?: ExecutionSourceObservation;
    }
  | {
      readonly observed: "Unreadable";
      readonly evidence: GitEvidence;
      readonly ticket: TicketId;
    };

/**
 * The evidence a later observation may find readable, because each names a
 * moment at the remote rather than a fact about what it holds.
 */
const transientGitEvidences: readonly GitEvidence[] = [
  "RemoteUnreachable",
  "PromotionTimedOut",
];

/**
 * Which refusal an unreadable source earns its client: a credential the remote
 * declined is the project's to mend, and every other evidence is the reference
 * the work was to be based on.
 */
function executionSourceRefusalCode(evidence: GitEvidence): RefusalCode {
  return evidence === "RemoteDenied"
    ? "ExecutionSourceDenied"
    : "ExecutionSourceUnreadable";
}

async function projectWriterExecutionSource(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  item: DecisionInput,
  command: DecisionEvent,
): Promise<SpawnSourceObserved> {
  if (
    item.source.kind === "Operation" &&
    item.source.finalizationRequest?.evidence !== undefined
  )
    return { observed: "Source" };
  const rec = execDecisionEvent(memory.graph, command).rec;
  const spawn = rec.effects.find((label) => {
    const effect = effectFromLabel(label);
    return effect === "SpawnWorkTasks" || effect === "SpawnEvalTasks";
  });
  if (spawn === undefined) return { observed: "Source" };
  const effect = effectFromLabel(spawn);
  const spawned = rec.transitions[rec.effects.indexOf(spawn)]?.ticket;
  if (spawned === undefined)
    throw new IntegrityContradiction("a spawn effect has no ticket transition");
  const ticket = asTicketId(spawned);
  const brief = await writer.ticketBriefs.brief(memory.lease.partition, ticket);
  const observed = await writer.executionSources.observe({
    partition: memory.lease.partition,
    ticket,
    kind: effect === "SpawnWorkTasks" ? "Work" : "Evaluation",
    ...(brief?.repository === undefined
      ? {}
      : { repository: brief.repository }),
    ...(brief?.branch === undefined ? {} : { ref: brief.branch }),
  });
  return observed.observed === "Source"
    ? { observed: "Source", source: observed.source }
    : { observed: "Unreadable", evidence: observed.evidence, ticket };
}

/**
 * What a source nobody could read lands as: a transient evidence defers the
 * input so a later quantum retries it, and a durable one answers a client's
 * operation with a code. AN INPUT NO CLIENT IS WAITING ON IS DEFERRED EITHER
 * WAY, because a wall is a task's now and no event parks a ticket whose spawn
 * could not be sourced at all — there is nothing to journal for a
 * continuation, and refusing a completion would settle at this boundary a task
 * the journal never heard settle.
 */
function projectWriterUnreadableLanding(
  item: DecisionInput,
  unreadable: Extract<SpawnSourceObserved, { observed: "Unreadable" }>,
):
  | { readonly landing: "Deferred" }
  | { readonly landing: "Refused"; readonly code: RefusalCode } {
  if (
    transientGitEvidences.includes(unreadable.evidence) ||
    item.source.kind !== "Operation" ||
    item.source.completion !== undefined
  )
    return { landing: "Deferred" };
  return {
    landing: "Refused",
    code: executionSourceRefusalCode(unreadable.evidence),
  };
}

/**
 * What the fabric said about the wall a durable input parks its ticket at: the
 * blocked reason of the execution the scheduler settled, and the hold kind the
 * finalizer's pass could not get past. Every other escalation the machine
 * reaches it reaches by counting its own budgets, which explains itself and
 * leaves nothing for a boundary to have said.
 */
function projectWriterEscalationEvidence(
  item: DecisionInput,
  command: DecisionEvent,
  post: TicketGraph,
): TicketEscalationEvidence | undefined {
  if (item.source.kind !== "Operation") return undefined;
  const source = item.source;
  if (command.type === "TaskDone") {
    const ticket = asTicketId(command.value.ticket);
    return source.executionBlockedBy === undefined ||
      ticketAt(post, ticket).escalation === "NoEscalation"
      ? undefined
      : { ticket, evidence: source.executionBlockedBy };
  }
  if (
    command.type !== "FinalizationResult" ||
    command.value.out !== "FinalizationResultUnavailable" ||
    source.command.command !== "SubmitFinalizationResult" ||
    source.command.kind === undefined
  )
    return undefined;
  return {
    ticket: asTicketId(command.value.ticket),
    evidence: source.command.kind,
  };
}

/**
 * The plan an accepted command earns once the source its spawns would run on
 * has been observed, which is the deferral or refusal that unreadability lands
 * as where there was no source to pin.
 */
async function projectWriterPlan(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  item: DecisionInput,
  command: DecisionEvent,
): Promise<ProjectPlan | { readonly deferred: GitEvidence }> {
  const observed = await projectWriterExecutionSource(
    writer,
    memory,
    item,
    command,
  );
  if (observed.observed === "Source")
    return journaledPlan(writer, memory, item, command, observed.source);
  const landing = projectWriterUnreadableLanding(item, observed);
  if (landing.landing === "Deferred") return { deferred: observed.evidence };
  return {
    outcome: { outcome: "Refused", code: landing.code },
    post: memory.graph,
  };
}

/**
 * Decides one named inbox item and installs the result only if it committed.
 * Every other outcome leaves the memory it was given exactly as it was.
 */
export async function projectWriterDecide(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  item: DecisionInput,
): Promise<ProjectDecided> {
  const preflight = projectWriterPreflight(writer, memory, item);
  const plan =
    "command" in preflight
      ? await projectWriterPlan(writer, memory, item, preflight.command)
      : preflight;
  if ("deferred" in plan)
    return {
      memory,
      decided: { decided: "Deferred", evidence: plan.deferred },
    };
  const decided = await writer.decisions.decide({
    lease: memory.lease,
    cause:
      item.source.kind === "Operation"
        ? { kind: "Operation", id: item.source.operation }
        : { kind: "Continuation", id: item.source.continuation },
    outcome: plan.outcome,
    ...(item.source.kind === "Operation" &&
    item.source.draftRelease !== undefined
      ? { draftRelease: item.source.draftRelease }
      : {}),
  });
  if (decided.decided !== "Committed") return { memory, decided };
  const ticketVersions = new Map(memory.ticketVersions);
  const dispatchContracts = new Map(memory.dispatchContracts ?? []);
  if (plan.outcome.outcome === "Journaled") {
    for (const row of plan.outcome.projection)
      ticketVersions.set(row.ticket, plan.outcome.entry.seq);
    if (
      item.source.kind === "Operation" &&
      item.source.draftRelease !== undefined
    )
      dispatchContracts.set(item.source.draftRelease.ticket, {
        configurationRevision: item.source.draftRelease.configurationRevision,
        configurationDigest: item.source.draftRelease.configurationDigest,
        configurationCanonical: item.source.draftRelease.configurationCanonical,
      });
  }
  return {
    memory: {
      lease: decided.lease,
      graph: plan.post,
      ticketVersions,
      dispatchContracts,
    },
    decided,
  };
}

export async function projectTicketWriterRun(
  writer: ProjectTicketWriter,
  discovery: ProjectDiscovery,
  readiness: Readiness,
  lease: Lease,
  monotonicNow: () => number,
  config: TicketServiceConfig = ticketServiceDefaults,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): Promise<ProjectMemory> {
  const checked = checkedTicketServiceConfig(config);
  let memory = await projectWriterLoad(writer, lease);
  const started = monotonicNow();
  for (let count = 0; count < checked.writerDecisionQuantum; count += 1) {
    if (monotonicNow() - started >= checked.writerTimeQuantumMilliseconds) {
      observe(() => {
        metrics.quantumExhausted("Time");
      });
      return memory;
    }
    const input = await discovery.next(
      lease.partition,
      checked.agingIntervalSeconds,
    );
    if (input === undefined) {
      await discovery.clearReadiness(readiness);
      return memory;
    }
    let result: ProjectDecided;
    try {
      result = await projectWriterDecide(writer, memory, input);
    } catch (error: unknown) {
      if (error instanceof IntegrityContradiction) {
        observe(() => {
          metrics.continuation("Contradictory");
        });
        return memory;
      }
      throw error;
    }
    memory = result.memory;
    if (result.decided.decided === "Deferred") {
      observe(() => {
        metrics.executionSourceDeferred();
      });
      return memory;
    }
    if (
      result.decided.decided !== "Committed" &&
      result.decided.decided !== "Refused" &&
      result.decided.decided !== "Answered" &&
      result.decided.decided !== "Stale"
    ) {
      return memory;
    }
  }
  observe(() => {
    metrics.quantumExhausted("Count");
  });
  return memory;
}
