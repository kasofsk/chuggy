/**
 * The rows of a ticket whose evaluation is abandoned twice, once by a command
 * and once by a failing verdict the policy takes back to work, decided by the
 * deciders themselves so the journal is one `decide` could have written.
 */

import {
  createTicketCommand,
  dispatchTicketCommand,
  invalidateEvaluationCommand,
  reportTaskTerminalCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import { genesis, replayStep, type Replayed } from "../../src/actor/journal.ts";
import { alwaysPolicy, decide } from "../../src/domain/deciders.ts";
import { aDispatchSource } from "../../src/domain/config.ts";
import { currentTaskObligations } from "../../src/domain/evaluation.ts";
import type {
  Entry,
  TaskIdentity,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { genesisLedgers } from "../../src/domain/ledger.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { plainDefinitionOf, plainPolicy } from "../actor/harness.ts";
import {
  acceptedOf,
  id,
  judgedReport,
  producedReport,
} from "../domain/fixtures.ts";

/** The one task a single-width ticket owes. */
function owed(graph: TicketGraph): TaskIdentity {
  const ticket = ticketAt(graph, id(1));
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Evaluation")
    return workTaskIdentity(1, ticket.workCyclesStarted);
  const [obligation] = currentTaskObligations(state.value);
  if (obligation === undefined)
    throw new Error("invalidation journal: the ticket owes no task");
  return obligation.task;
}

/** Every row the invalidating walk journals, in order. */
export function invalidationEntries(): readonly Entry[] {
  let held: Replayed = { graph: genesis, ledgers: genesisLedgers };
  const entries: Entry[] = [];
  const step = (command: TicketCommand, policy = plainPolicy) => {
    const { event } = acceptedOf(decide(held.graph, command, policy));
    entries.push({ seq: entries.length + 1, event });
    held = replayStep(held, event);
  };
  const worked = () => {
    step(reportTaskTerminalCommand(producedReport(owed(held.graph))));
  };
  const evaluationCycle = (): number => {
    const state = ticketAt(held.graph, id(1)).state;
    if (typeof state === "string" || state.type !== "Evaluation")
      throw new Error("invalidation journal: the ticket is not evaluating");
    return state.value.workCycle;
  };
  step(createTicketCommand(plainDefinitionOf(1)));
  step(dispatchTicketCommand(id(1), aDispatchSource));
  worked();
  step(invalidateEvaluationCommand(id(1), evaluationCycle(), 1));
  worked();
  step(
    reportTaskTerminalCommand(judgedReport(owed(held.graph), "EvaluatorFail")),
    alwaysPolicy({ type: "InvalidateEvaluationFailure", value: 2 }),
  );
  return entries;
}
