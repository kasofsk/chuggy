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
 *
 * The metering lives here rather than in a caller: every entry to Working
 * charges gas, every eval failure charges the rework account, every
 * finalization failure charges the finalization account, and nothing refunds.
 * Those charges are what make the termination measure descend, so a change to
 * any of them is a change to `model/measure.qnt` first.
 */

import { boundsOf, type Config } from "./config.ts";
import { ticketAt, ticketIds, withTicket, type Decision } from "./core.ts";
import type {
  Core,
  FinalizationOutcome,
  FinalizationPricing,
  Finalizer,
  Phase,
  Reason,
  Resume,
  RetryPricing,
  ReworkPolicy,
  Stage,
  Ticket,
  Transition,
  Verdict,
} from "./generated/modelTypes.ts";
import type { TaskId, TicketId } from "./ids.ts";
import { finalizationBudget, reworkBudget } from "./pricing.ts";
import { combine } from "./program.ts";
import { resumeCharge } from "./enablement.ts";
import { evalStage, resolveTask, tkEval, tkWork } from "./task.ts";
import { retireLive, spawnOn } from "./ticket.ts";

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

/** A ticket as a release leaves it: Pending, with every account at its grant. */
export function freshTicket(authoring: {
  readonly deps: ReadonlySet<number>;
  readonly program: readonly Stage[];
  readonly workFanout: number;
  readonly reworkPolicy: ReworkPolicy;
  readonly finalizationPricing: FinalizationPricing;
  readonly resumePricing: RetryPricing;
  readonly finalizer: Finalizer;
  readonly gas: number;
}): Ticket {
  return {
    phase: "Pending",
    deps: authoring.deps,
    program: authoring.program,
    finalizer: authoring.finalizer,
    artifact: "NoArtifact",
    workFanout: authoring.workFanout,
    reworkPolicy: authoring.reworkPolicy,
    finalizationPricing: authoring.finalizationPricing,
    resumePricing: authoring.resumePricing,
    tasks: new Set(),
    record: [],
    spawned: 0,
    reworkLeft: reworkBudget(authoring.reworkPolicy),
    finalizationLeft: finalizationBudget(authoring.finalizationPricing),
    gasLeft: authoring.gas,
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
  config: Config,
  core: Core,
  id: TicketId,
  authoring: {
    readonly deps: ReadonlySet<number>;
    readonly program: readonly Stage[];
    readonly workFanout: number;
    readonly reworkPolicy: ReworkPolicy;
    readonly finalizationPricing: FinalizationPricing;
    readonly resumePricing: RetryPricing;
    readonly finalizer: Finalizer;
  },
): Decision {
  const tickets = new Map(core.tickets);
  tickets.set(id, freshTicket({ ...authoring, gas: config.gas }));
  return {
    rec: { label: "ticket-released", transitions: [], effects: [] },
    post: { tickets },
  };
}

/**
 * Park a ticket on the desk, naming the wall and where a resume would put it
 * back. The open desk task is derived from the phase; `OpenHumanTask` is its
 * trace-visible effect. The failed set is retired into the record rather than
 * dropped.
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
 * Revoke, and park every dependent it dooms in the same decision.
 *
 * The cascade parks rather than revokes, so no author's revocation destroys
 * another author's ticket without a human deciding it, and every doomed
 * dependent gets its own desk task saying why. Parking only Pending dependents
 * is exhaustive: a dependent of a revocable ticket can never have dispatched,
 * because dispatch needs every dependency Done and Done is absorbing.
 *
 * The closure is a bounded fixpoint over the ids the map actually holds, not
 * an ascending pass — ids are sparse and a dependency may point at a
 * numerically larger ticket.
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
 * Ready to Working: launch a cycle for the ticket THE DISPATCHER CHOSE.
 *
 * The choice is the decision. Which Ready ticket runs next is an agentic pick
 * rather than a queue position, so this decider takes it as an argument and
 * the recorded step IS the dispatcher's decision event. Any policy conforms,
 * because every policy refines an unrestricted choice among Ready tickets.
 *
 * Charges one gas, as every entry to Working does.
 */
export function decideDispatch(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  return move(
    withTicket(core, id, {
      ...spawnOn(ticket, tkWork, ticket.workFanout),
      gasLeft: ticket.gasLeft - 1,
    }),
    id,
    "Working",
    "dispatch",
    ["SpawnWorkTasks"],
  );
}

/**
 * A task completion. First write wins: resolving a task that is not
 * outstanding changes nothing, which is the idempotence an at-least-once
 * fabric demands. Task ids are unique across the ticket's whole history, so a
 * completion for an earlier stage or incarnation names an id that is already
 * retired and matches nothing live.
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
 * program; a failing one short-circuits into the rework economy, which charges
 * both the rework account and gas, and walls when either is spent.
 */
export function decideEvalStageReduce(core: Core, id: TicketId): Decision {
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

  if (ticket.reworkLeft > 0 && ticket.gasLeft > 0) {
    return move(
      withTicket(core, id, {
        ...spawnOn(retired, tkWork, retired.workFanout),
        reworkLeft: ticket.reworkLeft - 1,
        gasLeft: ticket.gasLeft - 1,
      }),
      id,
      "Working",
      "rework-started eval_failure",
      ["SpawnWorkTasks"],
    );
  }
  if (ticket.reworkLeft === 0) {
    return escalate(
      core,
      id,
      "ResumeEvaluating",
      "ReworkBudgetExhausted",
      "ticket-escalated rework_budget_exhausted",
    );
  }
  return escalate(
    core,
    id,
    "ResumeEvaluating",
    "GasExhausted",
    "ticket-escalated gas_exhausted",
  );
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
 * A failed finalization re-enters work under whichever account the ticket was
 * authored with: a budgeted ticket spends its finalization account and its
 * gas, an unbudgeted one is metered by gas alone. Both wall when spent.
 */
function finalizerFailure(core: Core, id: TicketId, label: string): Decision {
  const ticket = ticketAt(core, id);
  const gasWall = (): Decision =>
    escalate(
      core,
      id,
      "ResumeFinalizing",
      "GasExhausted",
      "ticket-escalated gas_exhausted",
    );
  const rework = (spend: number): Decision =>
    move(
      withTicket(core, id, {
        ...spawnOn(ticket, tkWork, ticket.workFanout),
        finalizationLeft: ticket.finalizationLeft - spend,
        gasLeft: ticket.gasLeft - 1,
      }),
      id,
      "Working",
      label,
      ["SpawnWorkTasks"],
    );

  if (ticket.finalizationPricing === "DeadlineOnly") {
    return ticket.gasLeft > 0 ? rework(0) : gasWall();
  }
  if (ticket.finalizationLeft > 0 && ticket.gasLeft > 0) return rework(1);
  if (ticket.finalizationLeft === 0) {
    return escalate(
      core,
      id,
      "ResumeFinalizing",
      "FinalizationBudgetExhausted",
      "ticket-escalated finalization_budget_exhausted",
    );
  }
  return gasWall();
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
      return finalizerFailure(core, id, "rework-started finalization_failed");
  }
}

/**
 * Infrastructure cannot run an intact contract. This is not failed work: it
 * consumes no rework and no finalization budget, and it names its own reason
 * so the desk can act on it. The resume points back at whichever phase held
 * the work.
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
 * A parked ticket rejoins the pipeline where its wall said it would, paying
 * whatever its authored pricing charges. A park with no modeled resume refuses
 * and records that it did.
 */
export function decideResumeTicket(core: Core, id: TicketId): Decision {
  const ticket = ticketAt(core, id);
  const resumed: Ticket = {
    ...ticket,
    reason: "NoReason",
    resumeAt: "NoResume",
    gasLeft: ticket.gasLeft - resumeCharge(ticket, ticket.resumeAt),
  };
  switch (ticket.resumeAt) {
    case "ResumeWorking":
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

/** The measure's bounds, read off the configuration a decision was made under. */
export { boundsOf };
