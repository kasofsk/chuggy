/**
 * The deciders: one pure function per decision the machine can make.
 *
 * A decider takes an observed `Core` and the decision's own arguments and
 * returns the transitions it performs, the effects it asks the world for, and
 * the state after it. IT NEVER PERFORMS ONE. That is what lets a golden trace
 * be replayed through these functions with no world to stub, and what lets the
 * same functions serve any runtime shape.
 *
 * Everything a decision needs is already in the `Core` it is handed. A decider
 * that acquired a read would acquire an await, and then a mock, and then it
 * would no longer be a function.
 * */

import { type Config } from "./config.ts";
import { ticketAt, ticketIds, withTicket, type Decision } from "./core.ts";
import type {
  Core,
  EvaluationFailureDisposition,
  FinalizationOutcome,
  Finalizer,
  Phase,
  Reason,
  Resume,
  Stage,
  Ticket,
  Transition,
  Verdict,
} from "./generated/modelTypes.ts";
import type { TaskId, TicketId } from "./ids.ts";
import { combine } from "./program.ts";
import { evalStage, resolveTask, tkEval, tkWork } from "./task.ts";
import { retireLive, spawnOn } from "./ticket.ts";

/**
 * Both ways a failing evaluation can be taken. The choice is an input to the
 * reduce rather than a field on the ticket: what a failed evaluation means is
 * the evaluation's own report, not something the release settled in advance.
 */
export const dispositionChoices: readonly EvaluationFailureDisposition[] = [
  "ReworkEvaluationFailure",
  "EscalateEvaluationFailure",
];

/** One phase change and the record that reports it — the shape most deciders return. */
function move(
  core: Core,
  id: TicketId,
  to: Phase,
  label: string,
  effects: readonly string[],
): Decision {
  const from = ticketAt(core, id).phase;
  return {
    rec: { label, transitions: [{ ticket: id, from, to }], effects },
    post: withTicket(core, id, { ...ticketAt(core, id), phase: to }),
  };
}

/** A ticket as a release leaves it: Pending, with nothing yet spawned. */
export function freshTicket(authoring: {
  readonly deps: ReadonlySet<number>;
  readonly program: readonly Stage[];
  readonly workFanout: number;
  readonly finalizer: Finalizer;
}): Ticket {
  return {
    phase: "Pending",
    deps: authoring.deps,
    program: authoring.program,
    finalizer: authoring.finalizer,
    artifact: "NoArtifact",
    workFanout: authoring.workFanout,
    tasks: new Set(),
    record: [],
    spawned: 0,
    resumeAt: "NoResume",
    reason: "NoReason",
    completions: 0,
  };
}

/**
 * Release: the ticket enters the fleet already Pending, carrying every value
 * that will affect its behaviour. There is no draft phase and no second step —
 * authoring happens outside this machine, and what arrives is frozen.
 */
export function decideReleaseTicket(
  core: Core,
  id: TicketId,
  authoring: {
    readonly deps: ReadonlySet<number>;
    readonly program: readonly Stage[];
    readonly workFanout: number;
    readonly finalizer: Finalizer;
  },
): Decision {
  const tickets = new Map(core.tickets);
  tickets.set(id, freshTicket(authoring));
  return {
    rec: { label: "ticket-released", transitions: [], effects: [] },
    post: { tickets },
  };
}

/**
 * Park a ticket on the desk, naming the wall, where a resume would put it back,
 * and retiring the failed set into the record rather than dropping it. The open
 * desk task is derived from the phase; `OpenHumanTask` is its visible effect.
 */
function escalate(
  core: Core,
  id: TicketId,
  at: Resume,
  why: Reason,
  label: string,
): Decision {
  const parked = withTicket(core, id, {
    ...retireLive(ticketAt(core, id)),
    resumeAt: at,
    reason: why,
  });
  return move(parked, id, "Escalated", label, ["OpenHumanTask"]);
}

/**
 * Revoke, and in the same decision park every dependent it dooms, each with its
 * own desk task: a cascade that revoked instead would destroy another author's
 * ticket with no human deciding it. Parking only Pending dependents is
 * exhaustive, because dispatch needs every dependency Done and Done absorbs.
 */
export function decideRevoke(
  config: Config,
  core: Core,
  id: TicketId,
): Decision {
  const doomed = new Set<TicketId>([id]);
  for (let round = 0; round < config.nTickets; round++) {
    for (const k of ticketIds(core)) {
      if ([...ticketAt(core, k).deps].some((d) => doomed.has(d as TicketId)))
        doomed.add(k);
    }
  }
  const parked = ticketIds(core).filter(
    (k) => k !== id && doomed.has(k) && ticketAt(core, k).phase === "Pending",
  );

  const transitions: Transition[] = [
    { ticket: id, from: ticketAt(core, id).phase, to: "Revoked" },
    ...parked.map((k) => ({
      ticket: k,
      from: ticketAt(core, k).phase,
      to: "Escalated" as const,
    })),
  ];

  const tickets = new Map(core.tickets);
  tickets.set(id, {
    ...retireLive(ticketAt(core, id)),
    phase: "Revoked",
    resumeAt: "NoResume",
    reason: "NoReason",
  });
  for (const k of parked) {
    tickets.set(k, {
      ...ticketAt(core, k),
      phase: "Escalated",
      reason: "DependencyRevoked",
    });
  }

  return {
    rec: {
      label: "ticket-revoked",
      transitions,
      effects: ["CancelTicketWork", ...parked.map(() => "OpenHumanTask")],
    },
    post: { tickets },
  };
}

/**
 * Ready to Working. Which Ready ticket runs next is an agentic pick rather than
 * a queue position, so it arrives as an argument and the recorded step IS the
 * ticket writer's decision.
 */
export function decideDispatch(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  return move(
    withTicket(core, id, spawnOn(ticket, tkWork, ticket.workFanout)),
    id,
    "Working",
    "dispatch",
    ["SpawnWorkTasks"],
  );
}

/**
 * A task completion, first write wins: resolving a task that is not outstanding
 * changes nothing, which is the idempotence an at-least-once fabric demands.
 * Ids are unique across the ticket's history, so a stale completion names one
 * already retired and matches nothing live.
 */
export function decideTaskDone(
  core: Core,
  id: TicketId,
  taskId: TaskId,
  verdict: Verdict,
): Decision {
  const ticket = ticketAt(core, id);
  return {
    rec: { label: "task-done", transitions: [], effects: [] },
    post: withTicket(core, id, {
      ...ticket,
      tasks: resolveTask(
        ticket.tasks,
        taskId,
        verdict === "Pass" ? "Passed" : "Failed",
      ),
    }),
  };
}

/**
 * The work set has settled. Unanimous pass moves into evaluation and stamps
 * the artifact the dependents will read; anything else parks, resumable at
 * Working.
 */
export function decideWorkReduce(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  const retired = retireLive(ticket);
  const allPassed = [...ticket.tasks].every(
    (t) => t.state !== "Outstanding" && t.state.value === "Passed",
  );
  if (!allPassed) {
    return escalate(
      core,
      id,
      "ResumeWorking",
      "WorkFailed",
      "ticket-escalated work_failed",
    );
  }
  const stage = retired.program[0];
  if (stage === undefined)
    throw new Error("work-reduce: an empty program reached a reduce");
  return move(
    withTicket(core, id, {
      ...spawnOn(retired, tkEval(0), stage.fanout),
      artifact: { type: "ProducedArtifact", value: retired.spawned },
    }),
    id,
    "Evaluating",
    "work-passed",
    ["SpawnEvalTasks"],
  );
}

/**
 * One eval stage has settled. A passing stage advances, or finishes the
 * program; a failing one short-circuits — the later stages are never created —
 * and is taken the way `onFailure` says, which is the only place that choice is
 * read.
 */
export function decideEvalStageReduce(
  core: Core,
  id: TicketId,
  onFailure: EvaluationFailureDisposition,
): Decision {
  const ticket = ticketAt(core, id);
  const stageIndex = evalStage(ticket.tasks);
  const retired = retireLive(ticket);
  const stage = ticket.program[stageIndex];
  if (stage === undefined)
    throw new Error("eval-reduce: the live stage indexes outside the program");

  if (combine(stage.combinator, ticket.tasks)) {
    const next = retired.program[stageIndex + 1];
    if (next !== undefined) {
      return move(
        withTicket(
          core,
          id,
          spawnOn(retired, tkEval(stageIndex + 1), next.fanout),
        ),
        id,
        "Evaluating",
        "eval-stage-passed",
        ["SpawnEvalTasks"],
      );
    }
    switch (ticket.finalizer) {
      case "NoFinalizer":
        return completeTicket(withTicket(core, id, retired), id);
      case "ManagedFinalizer":
        return move(
          withTicket(core, id, retired),
          id,
          "Finalizing",
          "eval-passed",
          ["RunFinalizer"],
        );
    }
  }

  switch (onFailure) {
    case "ReworkEvaluationFailure":
      return move(
        withTicket(core, id, spawnOn(retired, tkWork, retired.workFanout)),
        id,
        "Working",
        "rework-started eval_failure",
        ["SpawnWorkTasks"],
      );
    case "EscalateEvaluationFailure":
      return escalate(
        core,
        id,
        "ResumeReworking",
        "ReworkBudgetExhausted",
        "ticket-escalated rework_budget_exhausted",
      );
  }
}

/**
 * Completion emits no effect. Entering Done IS the completion, recorded in the
 * same journal entry as the decision, so there is nothing left for the world
 * to be asked to do.
 */
function completeTicket(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  return {
    rec: {
      label: "ticket-done",
      transitions: [{ ticket: id, from: ticket.phase, to: "Done" }],
      effects: [],
    },
    post: withTicket(core, id, {
      ...ticket,
      phase: "Done",
      completions: ticket.completions + 1,
    }),
  };
}

/**
 * A failed finalization re-enters work with a fresh work set. There is no wall
 * on this edge: a finalizer that keeps reporting failure keeps buying cycles,
 * which is the finalizer's problem rather than the machine's.
 */
function finalizerFailure(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  return move(
    withTicket(core, id, spawnOn(ticket, tkWork, ticket.workFanout)),
    id,
    "Working",
    "rework-started finalization_failed",
    ["SpawnWorkTasks"],
  );
}

/** The finalizer service's one report. Success completes the ticket; failure reworks it. */
export function decideFinalizationResult(
  core: Core,
  id: TicketId,
  outcome: FinalizationOutcome,
): Decision {
  switch (outcome) {
    case "FinalizationSucceeded":
      return completeTicket(core, id);
    case "FinalizationFailed":
      return finalizerFailure(core, id);
  }
}

/**
 * Infrastructure cannot run an intact contract, which is not failed work: it
 * names its own reason and resumes back at whichever phase held the work.
 */
export function decideExecutionBlocked(
  core: Core,
  id: TicketId,
  why: Reason,
): Decision {
  const phase = ticketAt(core, id).phase;
  const at: Resume =
    phase === "Working"
      ? "ResumeWorking"
      : phase === "Evaluating"
        ? "ResumeEvaluating"
        : "NoResume";
  return escalate(core, id, at, why, "ticket-escalated execution_blocked");
}

/**
 * A parked ticket rejoins the pipeline where its wall said it would, and a
 * park with no modeled resume refuses and records that it did.
 *
 * The walls that stamp a work resume take the same exit: an evaluation wall
 * was reached by a verdict, which has no re-judge to offer, so it buys a new
 * artifact rather than a second opinion on the old one.
 */
export function decideResumeTicket(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  const resumed: Ticket = {
    ...ticket,
    reason: "NoReason",
    resumeAt: "NoResume",
  };
  switch (ticket.resumeAt) {
    case "ResumeWorking":
    case "ResumeReworking":
      return move(
        withTicket(core, id, spawnOn(resumed, tkWork, resumed.workFanout)),
        id,
        "Working",
        "ticket-resumed",
        ["SpawnWorkTasks"],
      );
    case "ResumeEvaluating": {
      const stage = ticket.program[0];
      if (stage === undefined)
        throw new Error("resume: an empty program reached an eval resume");
      return move(
        withTicket(core, id, spawnOn(resumed, tkEval(0), stage.fanout)),
        id,
        "Evaluating",
        "ticket-resumed",
        ["SpawnEvalTasks"],
      );
    }
    case "ResumeFinalizing":
      return move(
        withTicket(core, id, resumed),
        id,
        "Finalizing",
        "ticket-resumed",
        ["RunFinalizer"],
      );
    case "NoResume":
      return {
        rec: { label: "ticket-resume-refused", transitions: [], effects: [] },
        post: core,
      };
  }
}

/** The dead-end stutter: what a quiet fleet records rather than deadlocking. */
export function settledRecord(): Decision["rec"] {
  return { label: "settled", transitions: [], effects: [] };
}
