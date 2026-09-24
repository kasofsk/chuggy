/**
 * Every step of every trace the ticket package ships, replayed through this
 * implementation's own `evolve` and `decide` under the package's invariants.
 *
 * The traces are the package's `ticket_tests.qnt` run, vendored beside the
 * model it runs (model/AGENTS.md), so they are the specification's output for
 * the part of it chuggy imports. They sit outside chuggy's machine: their
 * stage and evaluator keys are the package's fixtures and break this
 * instance's bounds by design, so only `graphInvariant` and `decisionValid`
 * apply, never chuggy's bundle.
 *
 * EVOLVE FIRST, THEN DECIDE WHERE THE COMMAND CAN BE REBUILT. A trace records
 * the graph either side of a step and the decision between them, never the
 * command. A simulation step names the action it took, and the action is a
 * fixed command over the prior graph; a scenario step's event names its
 * command, and an escalation names the policy that chose it. A refusal names
 * no command and the initial sentinel is no decision at all, so those steps
 * are replayed through `evolve` alone and counted.
 *
 * The rebuild follows the package's own conformance `replay.ts` at the pin,
 * restated here in chuggy's vocabulary rather than imported: the package's
 * TypeScript is not a dependency of this tree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  decodeTicketDecision,
  decodeTicketGraph,
} from "../../src/generated/model-api.ts";
import type {
  EvaluationVerdict,
  FailureKind,
  FinalizationResult,
  ReleasedTicket,
  TaskDefinition,
  TicketCommand,
  TicketDecision,
  TicketEvent,
  TicketGraph,
  TaskObligation,
} from "../../src/domain/generated/modelTypes.ts";
import {
  alwaysPolicy,
  commandValid,
  decide,
  type EvaluationFailurePolicy,
} from "../../src/domain/deciders.ts";
import {
  applyDecision,
  decisionValid,
  graphInvariant,
} from "../../src/domain/decisionValid.ts";
import { graphEquals } from "../../src/domain/equality.ts";
import { currentTaskObligations } from "../../src/domain/evaluation.ts";
import { workTaskObligation } from "../../src/domain/ticket.ts";
import { decodeTrace, stateValue, type ItfState } from "../itf/decode.ts";
import { decodeWith } from "../itf/vocabulary.ts";

const TRACES = join(
  import.meta.dirname,
  "..",
  "..",
  "model",
  "ticket-domain",
  "traces",
);

const rework = alwaysPolicy("ReworkEvaluationFailure");
const escalate = alwaysPolicy("EscalateEvaluationFailure");

/** The package's `noDecision`: what a trace's first state records. */
const NO_DECISION: TicketDecision = {
  type: "TicketRefused",
  value: { type: "TicketNotFound", value: 0 },
};

/** ticket_tests.qnt's fixtures, which its simulation actions are built from. */
const WORK: TaskDefinition = {
  workload: 1,
  inputs: 1,
  executionRequirements: 1,
  resultContract: 1,
};
const EVALUATOR: TaskDefinition = {
  workload: 2,
  inputs: 2,
  executionRequirements: 2,
  resultContract: 2,
};

function released(
  ticket: number,
  dependencies: readonly number[],
  revised = false,
): ReleasedTicket {
  return {
    id: ticket,
    content: ticket * 100 + (revised ? 51 : 1),
    dependencies: new Set(dependencies),
    workConfiguration: WORK,
    evaluationPlan: {
      stages: [
        {
          key: 10,
          evaluators: [
            { key: 11, task: EVALUATOR },
            { key: 12, task: EVALUATOR },
          ],
        },
        { key: 20, evaluators: [{ key: 21, task: EVALUATOR }] },
      ],
    },
    finalizationConfiguration: 1,
  };
}

/** The obligation ticket `id`'s running work cycle owes, as the package's `reportWork*` actions read it. */
function workObligation(prior: TicketGraph, id: number): TaskObligation {
  const ticket = prior.tickets.get(id);
  if (
    ticket === undefined ||
    typeof ticket.state === "string" ||
    ticket.state.type !== "Work"
  ) {
    throw new Error(`ticket ${String(id)} is not in Work`);
  }
  return workTaskObligation(ticket, ticket.workCyclesStarted);
}

/** The first evaluator ticket `id`'s running stage still owes. */
function evaluatorObligation(prior: TicketGraph, id: number): TaskObligation {
  const state = prior.tickets.get(id)?.state;
  if (
    state === undefined ||
    typeof state === "string" ||
    state.type !== "Evaluation"
  ) {
    throw new Error(`ticket ${String(id)} is not in Evaluation`);
  }
  const obligation = currentTaskObligations(state.value)[0];
  if (obligation === undefined) throw new Error("no current evaluator");
  return obligation;
}

function failure(
  prior: TicketGraph,
  evidence: number,
  work: boolean,
  kind: FailureKind,
): TicketCommand {
  const obligation = work
    ? workObligation(prior, 1)
    : evaluatorObligation(prior, 1);
  return {
    type: "ReportTaskTerminal",
    value: {
      type: "TerminalFailureReport",
      value: { ticket: 1, failure: { task: obligation.task, evidence }, kind },
    },
  };
}

function verdict(
  prior: TicketGraph,
  resultRef: number,
  v: EvaluationVerdict,
): TicketCommand {
  return {
    type: "ReportTaskTerminal",
    value: {
      type: "EvaluationResultReport",
      value: {
        ticket: 1,
        result: { obligation: evaluatorObligation(prior, 1), resultRef },
        verdict: v,
      },
    },
  };
}

function finalization(
  prior: TicketGraph,
  result: FinalizationResult,
): TicketCommand {
  const state = prior.tickets.get(1)?.state;
  if (
    state === undefined ||
    typeof state === "string" ||
    state.type !== "Finalization"
  ) {
    throw new Error("ticket 1 is not in Finalization");
  }
  const { workCycle, generation } = state.value;
  return {
    type: "ReportFinalizationResult",
    value: { ticket: 1, workCycle, generation, result },
  };
}

/** The command a simulation action submits over the graph it was taken at. */
function simulated(action: string, prior: TicketGraph): TicketCommand {
  switch (action) {
    case "createOne":
      return { type: "CreateTicket", value: released(1, []) };
    case "createTwo":
      return { type: "CreateTicket", value: released(2, [1]) };
    case "updateOne":
      return {
        type: "UpdateTicket",
        value: {
          ticket: 1,
          expectedRevision: prior.tickets.get(1)?.revision ?? 1,
          definition: released(1, [], true),
        },
      };
    case "dispatchOne":
      return { type: "DispatchTicket", value: { ticket: 1, source: 1001 } };
    case "dispatchTwo":
      return { type: "DispatchTicket", value: { ticket: 2, source: 2001 } };
    case "revokeOne":
      return { type: "RevokeTicket", value: 1 };
    case "resumeOne":
      return { type: "ResumeTicket", value: 1 };
    case "passWorkOne":
      return {
        type: "ReportTaskTerminal",
        value: {
          type: "WorkResultReport",
          value: {
            ticket: 1,
            result: { obligation: workObligation(prior, 1), resultRef: 501 },
            acceptedSourceRef: 501,
          },
        },
      };
    case "failWorkOne":
      return failure(prior, 508, true, "ProcessFailure");
    case "unavailableWorkOne":
      return failure(prior, 509, true, "ExecutionUnavailableFailure");
    case "passEvaluatorOne":
      return verdict(prior, 502, "EvaluatorPass");
    case "failEvaluatorOne":
      return verdict(prior, 503, "EvaluatorFail");
    case "unavailableEvaluatorOne":
      return failure(prior, 504, false, "ExecutionUnavailableFailure");
    case "completeFinalizationOne":
      return finalization(prior, { type: "FinalizationSucceeded", value: 505 });
    case "reworkFinalizationOne":
      return finalization(prior, { type: "FinalizationNeedsWork", value: 506 });
    case "unavailableFinalizationOne":
      return finalization(prior, {
        type: "FinalizationResultUnavailable",
        value: 507,
      });
    default:
      throw new Error(`unknown simulation action ${action}`);
  }
}

/** The finalizer's report a finalization event records. */
function finalizationReport(
  event: TicketEvent & {
    type:
      | "TicketFinalizationSucceeded"
      | "TicketFinalizationNeedsWork"
      | "TicketFinalizationUnavailable";
  },
): TicketCommand {
  const { ticket, workCycle, generation, evidence } = event.value;
  const result: FinalizationResult =
    event.type === "TicketFinalizationSucceeded"
      ? { type: "FinalizationSucceeded", value: evidence }
      : event.type === "TicketFinalizationNeedsWork"
        ? { type: "FinalizationNeedsWork", value: evidence }
        : { type: "FinalizationResultUnavailable", value: evidence };
  return {
    type: "ReportFinalizationResult",
    value: { ticket, workCycle, generation, result },
  };
}

/** The command a scenario's event names. */
function commandOf(event: TicketEvent): TicketCommand {
  switch (event.type) {
    case "TicketCreated":
      return { type: "CreateTicket", value: event.value };
    case "TicketUpdated":
      return {
        type: "UpdateTicket",
        value: {
          ticket: event.value.ticket,
          expectedRevision: event.value.revision - 1,
          definition: event.value.definition,
        },
      };
    case "TicketDispatched":
      return { type: "DispatchTicket", value: event.value };
    case "TicketRevoked":
      return { type: "RevokeTicket", value: event.value };
    case "TicketWorkResumed":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
      return { type: "ResumeTicket", value: event.value };
    case "TicketWorkResultAccepted":
      return {
        type: "ReportTaskTerminal",
        value: { type: "WorkResultReport", value: event.value },
      };
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable": {
      const { ticket, task, evidence } = event.value;
      const kind: FailureKind =
        event.type === "TicketWorkProcessFailed"
          ? "ProcessFailure"
          : "ExecutionUnavailableFailure";
      return {
        type: "ReportTaskTerminal",
        value: {
          type: "TerminalFailureReport",
          value: { ticket, failure: { task, evidence }, kind },
        },
      };
    }
    case "TicketEvaluationFailureEscalated":
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationBlocked":
    case "TicketEvaluationReworkStarted":
      return { type: "ReportTaskTerminal", value: event.value.report };
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      return finalizationReport(event);
  }
}

/** The policy a scenario's event names: an escalation is the one edge rework is not. */
function policyOf(event: TicketEvent): EvaluationFailurePolicy {
  return event.type === "TicketEvaluationFailureEscalated" ? escalate : rework;
}

interface Trace {
  readonly file: string;
  readonly kind: "scenario" | "simulation";
  readonly states: readonly ItfState[];
}

function load(file: string): Trace {
  const raw = JSON.parse(readFileSync(join(TRACES, file), "utf8")) as {
    "#meta"?: { kind?: unknown };
  };
  const kind = raw["#meta"]?.kind;
  if (kind !== "scenario" && kind !== "simulation") {
    throw new Error(`${file}: #meta.kind is ${String(kind)}`);
  }
  return { file, kind, states: decodeTrace(raw).states };
}

const files = readdirSync(TRACES)
  .filter((f) => f.endsWith(".itf.json"))
  .sort();

/** What the whole corpus came to, which the last case holds. */
const tally = { steps: 0, rebuilt: 0, evolveOnly: [] as string[] };

test("the corpus is the one the package's index lists", () => {
  const index = JSON.parse(
    readFileSync(join(TRACES, "index.json"), "utf8"),
  ) as {
    traces: readonly { file: string }[];
  };
  assert.deepEqual(files, index.traces.map((t) => t.file).sort());
  assert.ok(files.length > 0, "no trace to replay");
});

for (const file of files) {
  test(file, () => {
    const trace = load(file);
    for (const state of trace.states.slice(1)) {
      const where = `${file}[${String(state.index)}]`;
      const prior = decodeWith(
        decodeTicketGraph,
        stateValue(state, "priorGraph"),
      );
      const graph = decodeWith(decodeTicketGraph, stateValue(state, "graph"));
      const decision = decodeWith(
        decodeTicketDecision,
        stateValue(state, "lastDecision"),
      );
      tally.steps += 1;

      assert.ok(graphInvariant(prior), `${where}: prior graph invariant`);
      assert.ok(graphInvariant(graph), `${where}: graph invariant`);
      assert.ok(decisionValid(prior, decision), `${where}: decision valid`);
      assert.ok(
        graphEquals(applyDecision(prior, decision), graph),
        `${where}: evolve`,
      );

      let rebuilt:
        readonly [TicketCommand, EvaluationFailurePolicy] | undefined;
      if (trace.kind === "simulation") {
        const action = stateValue(state, "mbt::actionTaken");
        if (typeof action !== "string") throw new Error(`${where}: no action`);
        rebuilt = [simulated(action, prior), rework];
      } else if (decision.type === "TicketDecided") {
        rebuilt = [
          commandOf(decision.value.event),
          policyOf(decision.value.event),
        ];
      }
      if (rebuilt === undefined) {
        tally.evolveOnly.push(
          isDeepStrictEqual(decision, NO_DECISION)
            ? `${where} sentinel`
            : `${where} refusal`,
        );
        continue;
      }
      const [command, policy] = rebuilt;
      assert.ok(
        commandValid(command),
        `${where}: the rebuilt command is valid`,
      );
      assert.deepStrictEqual(
        decide(prior, command, policy),
        decision,
        `${where}: decide`,
      );
      tally.rebuilt += 1;
    }
  });
}

/**
 * Pinned rather than floored: a rebuild that quietly gives up on a class of
 * step would otherwise pass as a smaller replay of the same corpus.
 */
test("every step replays, and every step that names a command is decided", () => {
  assert.equal(tally.steps, tally.rebuilt + tally.evolveOnly.length);
  assert.equal(tally.rebuilt, 299);
  assert.equal(tally.evolveOnly.length, 20, tally.evolveOnly.join("\n"));
});
