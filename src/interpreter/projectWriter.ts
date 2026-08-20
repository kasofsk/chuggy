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
 * `docs/design/006-durable-project-dispatch.md` permits that to keep the
 * transaction short, and requires that a failed recheck discard the result and
 * reload. Both halves are here: nothing below awaits between the plan and the
 * commit, and nothing installs a plan the commit refused.
 *
 * A COMMAND IS THE DECISION EVENT IT ASKS FOR, and that is the smallest
 * command vocabulary this tree can have. 006's richer typed commands name a
 * draft revision, an observed ticket version or a selection digest, and each
 * arrives with the slice that has one to name; the parse below is where they
 * will branch. What is already true is the shape: a command that does not read
 * as something the machine could decide is refused durably rather than
 * retried, because no amount of retrying will make it parse.
 *
 * THE PROJECTION IS DERIVED, NEVER OBSERVED. Its rows are a function of the
 * replayed `Core` alone, so rebuilding them from the journal and folding the
 * per-decision changes reach the same table — which is what makes it a
 * projection rather than a second authority.
 */

import type { Entry } from "../actor/journal.ts";
import { genesis, journalLegalOn } from "../actor/journal.ts";
import { ticketEquals } from "../actor/equality.ts";
import {
  decisionEventEnabled,
  execDecisionEvent,
} from "../actor/decisionEvent.ts";
import type { Config } from "../domain/config.ts";
import { ticketAt, ticketIds } from "../domain/core.ts";
import type { Core } from "../domain/generated/modelTypes.ts";
import { asTicketId } from "../domain/ids.ts";
import type { DecisionInput } from "./projectDiscovery.ts";
import type { ProjectDiscovery, Readiness } from "./projectDiscovery.ts";
import type {
  Decided,
  DecisionOutcome,
  ProjectDecision,
  TicketProjection,
} from "./projectDecision.ts";
import type { Lease, ProjectStore } from "./projectStore.ts";
import { materializationOf } from "./decisionPlan.ts";
import {
  observe,
  silentTicketServiceMetrics,
  ticketServiceDefaults,
  type TicketServiceConfig,
  type TicketServiceMetrics,
} from "./ticketService.ts";

/** Everything a writer calls out through: the authority it replays from, and the one it commits to. */
export interface ProjectTicketWriter {
  readonly config: Config;
  readonly store: ProjectStore;
  readonly decisions: ProjectDecision;
}

/** What a writer holds between decisions: the lease that authorizes it, and the state it replayed. */
export interface ProjectMemory {
  readonly lease: Lease;
  readonly core: Core;
  readonly ticketVersions: ReadonlyMap<number, number>;
}

export class IntegrityContradiction extends Error {}

/** A decision's outcome and the memory it leaves behind, which is the old one unless it committed. */
export interface ProjectDecided {
  readonly memory: ProjectMemory;
  readonly decided: Decided;
}

/** Every ticket's current phase, which is the whole projection and the rebuild of it. */
export function projectionOf(core: Core): readonly TicketProjection[] {
  return ticketIds(core).map((ticket) => ({
    ticket,
    phase: ticketAt(core, ticket).phase,
  }));
}

/**
 * The projection rows one decision changed: a ticket it released, and a ticket
 * whose phase it moved. A ticket the decision left alone is not rewritten.
 */
export function projectionChanges(
  pre: Core,
  post: Core,
): readonly TicketProjection[] {
  return projectionOf(post).filter((row) => {
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
): Promise<readonly Entry[]> {
  const loaded = await writer.store.load(lease);
  if (loaded.parsed === "Refused") {
    throw new Error(
      `project writer: the journal could not be replayed — ${loaded.why}`,
    );
  }
  if (!journalLegalOn(writer.config, loaded.value)) {
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
  let core: Core = genesis;
  for (const entry of journal) {
    const post = execDecisionEvent(writer.config, core, entry.event).post;
    for (const projection of projectionChanges(core, post))
      ticketVersions.set(projection.ticket, entry.seq);
    core = post;
  }
  return { lease, core, ticketVersions };
}

/** A decision offered for commit, and the state it would install if it committed. */
interface ProjectPlan {
  readonly outcome: DecisionOutcome;
  readonly post: Core;
}

function continuationFenceOutcome(
  memory: ProjectMemory,
  source: Extract<DecisionInput["source"], { kind: "Continuation" }>,
): DecisionOutcome | undefined {
  const command = source.command;
  if (command.type !== "WorkReduce" && command.type !== "EvalReduce")
    throw new IntegrityContradiction("a continuation does not carry a reducer");
  const ticketId = asTicketId(command.value);
  if (memory.ticketVersions.get(ticketId) !== source.expectedTicketVersion)
    return { outcome: "Stale" };
  const ticket = ticketAt(memory.core, ticketId);
  if (
    ticket.phase !== source.expectedPhase ||
    ticket.spawned !== source.taskSetGeneration
  )
    throw new IntegrityContradiction(
      "continuation fences contradict authoritative ticket state",
    );
  return undefined;
}

/**
 * What one inbox item asks of the state in hand: a decision the machine would
 * take, or the refusal it earns. Nothing here reaches the world.
 */
function projectWriterPlan(
  writer: ProjectTicketWriter,
  memory: ProjectMemory,
  item: DecisionInput,
): ProjectPlan {
  const command =
    item.source.kind === "Operation"
      ? item.source.resolvedEvent
      : item.source.command;
  if (item.source.kind === "Continuation") {
    const fenceOutcome = continuationFenceOutcome(memory, item.source);
    if (fenceOutcome !== undefined)
      return { outcome: fenceOutcome, post: memory.core };
  }
  if (
    item.source.kind === "Operation" &&
    item.source.nativeAction !== undefined &&
    !item.source.nativeAction.open
  ) {
    return {
      outcome: { outcome: "Refused", code: "NotEnabled" },
      post: memory.core,
    };
  }
  if (!decisionEventEnabled(writer.config, memory.core, command)) {
    return {
      outcome: { outcome: "Refused", code: "NotEnabled" },
      post: memory.core,
    };
  }
  const decision = execDecisionEvent(writer.config, memory.core, command);
  const entry: Entry = {
    seq: memory.lease.head + 1,
    event: command,
    rec: decision.rec,
  };
  return {
    outcome: {
      outcome: "Journaled",
      entry,
      projection: projectionChanges(memory.core, decision.post),
      materialization: materializationOf(
        item,
        memory.core,
        decision.post,
        entry,
      ),
    },
    post: decision.post,
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
  const plan = projectWriterPlan(writer, memory, item);
  const decided = await writer.decisions.decide({
    lease: memory.lease,
    cause:
      item.source.kind === "Operation"
        ? { kind: "Operation", id: item.source.operation }
        : { kind: "Continuation", id: item.source.continuation },
    outcome: plan.outcome,
  });
  if (decided.decided !== "Committed") return { memory, decided };
  const ticketVersions = new Map(memory.ticketVersions);
  if (plan.outcome.outcome === "Journaled") {
    for (const row of plan.outcome.projection)
      ticketVersions.set(row.ticket, plan.outcome.entry.seq);
  }
  return {
    memory: { lease: decided.lease, core: plan.post, ticketVersions },
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
  let memory = await projectWriterLoad(writer, lease);
  const started = monotonicNow();
  for (let count = 0; count < config.writerDecisionQuantum; count += 1) {
    if (monotonicNow() - started >= config.writerTimeQuantumMilliseconds) {
      observe(() => {
        metrics.quantumExhausted("Time");
      });
      return memory;
    }
    const input = await discovery.next(
      lease.partition,
      config.agingIntervalSeconds,
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
    if (
      result.decided.decided !== "Committed" &&
      result.decided.decided !== "Refused" &&
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
