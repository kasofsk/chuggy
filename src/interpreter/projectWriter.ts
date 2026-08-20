/**
 * The project writer: what a dispatcher does between holding a lease and
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
import { journalLegalOn, replayCore } from "../actor/journal.ts";
import {
  decisionEventEnabled,
  execDecisionEvent,
} from "../actor/decisionEvent.ts";
import type { Config } from "../domain/config.ts";
import { ticketAt, ticketIds } from "../domain/core.ts";
import type { Core } from "../domain/generated/modelTypes.ts";
import type { InboxItem } from "./projectDiscovery.ts";
import type {
  Decided,
  DecisionOutcome,
  ProjectDecision,
  TicketProjection,
} from "./projectDecision.ts";
import type { Lease, ProjectStore } from "./projectStore.ts";
import { parseDecisionEventText } from "./wire.ts";

/** Everything a writer calls out through: the authority it replays from, and the one it commits to. */
export interface ProjectWriter {
  readonly config: Config;
  readonly store: ProjectStore;
  readonly decisions: ProjectDecision;
}

/** What a writer holds between decisions: the lease that authorizes it, and the state it replayed. */
export interface ProjectMemory {
  readonly lease: Lease;
  readonly core: Core;
}

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
  return projectionOf(post).filter(
    (row) => pre.tickets.get(row.ticket)?.phase !== row.phase,
  );
}

/**
 * The journal this partition holds, refused loudly. A journal that does not
 * parse and a journal this machine could not have taken are both failures of
 * the writer's own book to be readable, which leaves no decision to take.
 */
async function projectWriterJournal(
  writer: ProjectWriter,
  lease: Lease,
): Promise<readonly Entry[]> {
  const loaded = await writer.store.load(lease.partition);
  if (loaded.parsed === "Refused") {
    throw new Error(
      `project writer: the stored journal did not parse — ${loaded.why}`,
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
  writer: ProjectWriter,
  lease: Lease,
): Promise<ProjectMemory> {
  const journal = await projectWriterJournal(writer, lease);
  return { lease, core: replayCore(writer.config, journal) };
}

/** A decision offered for commit, and the state it would install if it committed. */
interface ProjectPlan {
  readonly outcome: DecisionOutcome;
  readonly post: Core;
}

/**
 * What one inbox item asks of the state in hand: a decision the machine would
 * take, or the refusal it earns. Nothing here reaches the world.
 */
function projectWriterPlan(
  writer: ProjectWriter,
  memory: ProjectMemory,
  item: InboxItem,
): ProjectPlan {
  const parsed = parseDecisionEventText(item.command);
  if (parsed.parsed === "Refused") {
    return {
      outcome: { outcome: "Refused", code: "CommandUnreadable" },
      post: memory.core,
    };
  }
  if (!decisionEventEnabled(writer.config, memory.core, parsed.value)) {
    return {
      outcome: { outcome: "Refused", code: "NotEnabled" },
      post: memory.core,
    };
  }
  const decision = execDecisionEvent(writer.config, memory.core, parsed.value);
  const entry: Entry = {
    seq: memory.lease.head + 1,
    event: parsed.value,
    rec: decision.rec,
  };
  return {
    outcome: {
      outcome: "Journaled",
      entry,
      projection: projectionChanges(memory.core, decision.post),
    },
    post: decision.post,
  };
}

/**
 * Decides one named inbox item and installs the result only if it committed.
 * Every other outcome leaves the memory it was given exactly as it was.
 */
export async function projectWriterDecide(
  writer: ProjectWriter,
  memory: ProjectMemory,
  item: InboxItem,
): Promise<ProjectDecided> {
  const plan = projectWriterPlan(writer, memory, item);
  const decided = await writer.decisions.decide({
    lease: memory.lease,
    cause: item.operation,
    outcome: plan.outcome,
  });
  if (decided.decided !== "Committed") return { memory, decided };
  return { memory: { lease: decided.lease, core: plan.post }, decided };
}
