/**
 * The deciders: pure functions from an observed state and an event to a
 * record and a post-state. None of them performs an effect; each returns the
 * list of effects the decision asks for, which is what lets the core replay
 * against a golden trace with nothing stubbed.
 *
 * EACH IS PARTIAL, AND ITS GUARD IS IN `enablement.ts`. Callers guarantee the
 * precondition; these assert it and never re-derive it. A decider that
 * restated its own enablement would be the copied guard the model hoisted
 * `dispatchableIn` out of an action to kill.
 *
 * EVERY PHASE FLIP GOES THROUGH `move`, which records exactly one transition,
 * so the trace shape has one definition. `from === to` is a real row: the
 * stage advance records Evaluating to Evaluating.
 */

import { assertNever } from "./assertNever.ts";
import type { Config } from "./config.ts";
import {
  ticketAt,
  ticketIds,
  withTicket,
  type Core,
  type Decision,
  type StepRecord,
  type Transition,
} from "./core.ts";
import type { Reason, Resume } from "./desk.ts";
import type { Effect } from "./effect.ts";
import {
  asTicketId,
  type ProjectId,
  type TaskId,
  type TicketId,
} from "./ids.ts";
import type { Phase } from "./phase.ts";
import { reworkBudget, wrapUpBudget } from "./pricing.ts";
import type { Stage } from "./program.ts";
import { combine } from "./program.ts";
import {
  evalStage,
  resolveTask,
  tkEval,
  tkWork,
  taskPassed,
  type Verdict,
} from "./task.ts";
import { retireLive, spawnOn, type Ticket } from "./ticket.ts";
import {
  aNone,
  aSome,
  woAttempt,
  woNone,
  type WrapUp,
  type WrapUpOutcome,
} from "./wrapUp.ts";
import { leaseOf, resumeCharge } from "./enablement.ts";

/** The one funnel every phase flip goes through, recording exactly one transition. */
export function move(
  core: Core,
  id: TicketId,
  to: Phase,
  label: string,
  effects: readonly Effect[],
): Decision {
  const before = ticketAt(core, id);
  return {
    rec: {
      label,
      transitions: [{ ticket: id, from: before.phase, to }],
      effects,
      attempt: woNone,
    },
    post: withTicket(core, id, { ...before, phase: to }),
  };
}

/** A decision that changes nothing: the idempotent answer to a duplicate delivery. */
export function noop(core: Core, label: string): Decision {
  return {
    rec: { label, transitions: [], effects: [], attempt: woNone },
    post: core,
  };
}

/** Stamp the wrap-up boundary's attribution. Every arm of the wrap-up resolution routes through this. */
export function withWrapUpObs(
  decision: Decision,
  project: ProjectId,
  invalidated: boolean,
): Decision {
  return {
    rec: { ...decision.rec, attempt: woAttempt(project, invalidated) },
    post: decision.post,
  };
}

/** A ticket is born a Draft with its full accounts, and reaches the pipeline only by release. */
export function freshTicket(
  config: Config,
  deps: ReadonlySet<TicketId>,
  program: readonly Stage[],
  project: ProjectId,
  wrapUp: WrapUp,
): Ticket {
  return {
    phase: "PDraft",
    /** Stored ascending, once: the arrival's set carries no order and the folds that read it do. */
    deps: [...deps].sort((a, b) => a - b),
    program,
    wrapUp,
    artifact: aNone,
    project,
    tasks: [],
    record: [],
    spawned: 0,
    reworkLeft: reworkBudget(config.reworkPolicy),
    wrapUpLeft: wrapUpBudget(config.wrapUpPricing),
    gasLeft: config.gas,
    resumeAt: "RNone",
    reason: "RsNone",
  };
}

/** Park a ticket on the desk, naming the wall and where a retry resumes. */
export function escalate(
  core: Core,
  id: TicketId,
  at: Resume,
  why: Reason,
  label: string,
): Decision {
  const parked = {
    ...retireLive(ticketAt(core, id)),
    resumeAt: at,
    reason: why,
  };
  return move(withTicket(core, id, parked), id, "PEscalated", label, [
    "OpenHumanTask",
  ]);
}

/** The completion: one transition, one effect, and that is the whole of it. */
export function completeTicket(core: Core, id: TicketId): Decision {
  const before = ticketAt(core, id);
  return {
    rec: {
      label: "ticket-done",
      transitions: [{ ticket: id, from: before.phase, to: "PDone" }],
      effects: ["Complete"],
      attempt: woNone,
    },
    post: withTicket(core, id, { ...before, phase: "PDone" }),
  };
}

/** A ticket arrives as a Draft. Ids are dense and never reused: the next is the fleet size plus one. */
export function decideArrive(
  config: Config,
  core: Core,
  deps: ReadonlySet<TicketId>,
  program: readonly Stage[],
  project: ProjectId,
  wrapUp: WrapUp,
): Decision {
  const id = asTicketId(core.tickets.size + 1);
  const tickets = new Map(core.tickets);
  tickets.set(id, freshTicket(config, deps, program, project, wrapUp));
  return {
    rec: {
      label: "ticket-arrived",
      transitions: [],
      effects: ["CreateDraft"],
      attempt: woNone,
    },
    post: { tickets },
  };
}

/** Draft to Pending: the ticket enters the released pipeline, charging nothing. */
export function decideRelease(core: Core, id: TicketId): Decision {
  return move(core, id, "PPending", "ticket-released", []);
}

/**
 * Revoke, and the cascade that parks every dependent doomed by it, atomically:
 * one decision and one record, so the safety property holds in every reachable
 * state rather than eventually. Only pre-flight dependents are parked, and that
 * is exhaustive because a dependent of a revocable ticket can never have
 * dispatched — dispatch needs every dep Done and the revoked ancestor is not.
 */
export function decideRevoke(core: Core, id: TicketId): Decision {
  const ids = ticketIds(core);
  /** Deps point strictly downward, so one ascending pass decides each id after every id it depends on. */
  const doomed = new Set<TicketId>();
  for (const k of ids) {
    const deps = ticketAt(core, k).deps;
    if (deps.includes(id) || deps.some((d) => doomed.has(d))) doomed.add(k);
  }
  const parked = ids.filter((k) => {
    if (!doomed.has(k)) return false;
    const phase = ticketAt(core, k).phase;
    return phase === "PDraft" || phase === "PPending";
  });

  const transitions: Transition[] = [
    { ticket: id, from: ticketAt(core, id).phase, to: "PRevoked" },
    ...parked.map((k) => ({
      ticket: k,
      from: ticketAt(core, k).phase,
      to: "PEscalated" as const,
    })),
  ];
  const effects: Effect[] = [
    "Revoke",
    ...parked.map((): Effect => "OpenHumanTask"),
  ];

  const tickets = new Map<TicketId, Ticket>();
  for (const k of ids) {
    const ticket = ticketAt(core, k);
    if (k === id) {
      tickets.set(k, {
        ...retireLive(ticket),
        phase: "PRevoked",
        resumeAt: "RNone",
        reason: "RsNone",
      });
    } else if (parked.includes(k)) {
      tickets.set(k, {
        ...ticket,
        phase: "PEscalated",
        reason: "RsDependencyRevoked",
      });
    } else {
      tickets.set(k, ticket);
    }
  }

  return {
    rec: { label: "ticket-revoked", transitions, effects, attempt: woNone },
    post: { tickets },
  };
}

/** Ready to Working. Every entry to Working charges one gas: there is no free re-entry. */
export function decideDispatch(
  config: Config,
  core: Core,
  id: TicketId,
): Decision {
  const before = ticketAt(core, id);
  return move(
    withTicket(core, id, {
      ...spawnOn(before, tkWork, config.nTasks),
      gasLeft: before.gasLeft - 1,
    }),
    id,
    "PWorking",
    "dispatch",
    ["SpawnWorkTasks"],
  );
}

/**
 * A task-completion event, where first write wins: a delivery naming a task
 * that is not running in the live set is a duplicate or a stale re-delivery,
 * and the decision is a state-identical no-op. Ids are unique across the
 * ticket's whole history, so a stale completion no-ops by identity.
 */
export function decideTaskDone(
  core: Core,
  id: TicketId,
  taskId: TaskId,
  verdict: Verdict,
): Decision {
  const ticket = ticketAt(core, id);
  const live = ticket.tasks.some(
    (t) => t.id === taskId && t.state.state === "TSRunning",
  );
  if (!live) return noop(core, "task-done-duplicate");
  return {
    rec: { label: "task-done", transitions: [], effects: [], attempt: woNone },
    post: withTicket(core, id, {
      ...ticket,
      tasks: resolveTask(
        ticket.tasks,
        taskId,
        verdict === "VPass" ? "TPassed" : "TFailed",
      ),
    }),
  };
}

/**
 * The work set fully resolved. A pass retires it and spawns the eval program's
 * lowest stage in full; a failed set is a failed cycle and escalates, because
 * the fabric has already retried each task below this grain.
 */
export function decideWorkReduce(core: Core, id: TicketId): Decision {
  const before = ticketAt(core, id);
  const retired = retireLive(before);
  if (!before.tasks.every(taskPassed)) {
    return escalate(
      core,
      id,
      "RWorking",
      "RsWorkFailed",
      "ticket-escalated work_failed",
    );
  }
  const first = retired.program[0];
  if (first === undefined) {
    throw new Error(
      `decideWorkReduce: ticket ${String(id)} has an empty program`,
    );
  }
  return move(
    withTicket(core, id, {
      ...spawnOn(retired, tkEval(0), first.fanout),
      artifact: aSome(retired.spawned),
    }),
    id,
    "PEvaluating",
    "work-passed",
    ["SpawnEvalTasks"],
  );
}

/**
 * The eval-program interpreter. The stage's own combinator decides, and a
 * failure short-circuits: the later stages are never created, so no task
 * records exist for them, and the next evaluation restarts from the lowest
 * stage rather than resuming mid-sequence.
 */
export function decideEvalStageReduce(
  config: Config,
  core: Core,
  id: TicketId,
): Decision {
  const before = ticketAt(core, id);
  const stage = evalStage(before.tasks);
  const current = before.program[stage];
  if (current === undefined) {
    throw new Error(
      `decideEvalStageReduce: ticket ${String(id)} has no stage ${String(stage)}`,
    );
  }
  return combine(current.combinator, before.tasks)
    ? evalStagePassedArm(core, id, stage)
    : evalStageFailedArm(config, core, id);
}

/**
 * The passing stage's two edges: advance into the next stage's fan-out, or, on
 * the final stage, take the wrap-up route the ticket's authored kind decides.
 */
function evalStagePassedArm(core: Core, id: TicketId, stage: number): Decision {
  const before = ticketAt(core, id);
  const retired = retireLive(before);
  const next = retired.program[stage + 1];
  if (next !== undefined) {
    return move(
      withTicket(core, id, spawnOn(retired, tkEval(stage + 1), next.fanout)),
      id,
      "PEvaluating",
      "eval-stage-passed",
      ["SpawnEvalTasks"],
    );
  }
  switch (before.wrapUp.wrapUp) {
    case "WNone":
      /** On the retired ticket: skipping the wrap-up phases skips the retirement they would have done, and a Done ticket holding live eval tasks is ill-formed. */
      return completeTicket(withTicket(core, id, retired), id);
    case "WExclusive":
      return move(withTicket(core, id, retired), id, "PWrapUp", "eval-passed", [
        "EnqueueWrapUp",
      ]);
    default:
      return assertNever(before.wrapUp);
  }
}

/**
 * The failing stage short-circuits into the same rework economy any stage
 * failure enters: a cycle costs one rework and one gas, and an empty account
 * parks the ticket behind the wall that emptied — the budget one checked first.
 */
function evalStageFailedArm(
  config: Config,
  core: Core,
  id: TicketId,
): Decision {
  const before = ticketAt(core, id);
  if (before.reworkLeft > 0 && before.gasLeft > 0) {
    return move(
      withTicket(core, id, {
        ...spawnOn(retireLive(before), tkWork, config.nTasks),
        reworkLeft: before.reworkLeft - 1,
        gasLeft: before.gasLeft - 1,
      }),
      id,
      "PWorking",
      "rework-started eval_failure",
      ["SpawnWorkTasks"],
    );
  }
  if (before.reworkLeft === 0) {
    return escalate(
      core,
      id,
      "REvaluating",
      "RsReworkBudgetExhausted",
      "ticket-escalated rework_budget_exhausted",
    );
  }
  return escalate(
    core,
    id,
    "REvaluating",
    "RsGasExhausted",
    "ticket-escalated gas_exhausted",
  );
}

/** The dequeue's moved arm: the gate runs, and the ticket takes its project's slot. */
export function decideWrapUpStart(core: Core, id: TicketId): Decision {
  return move(core, id, "PWrapUpHolding", "wrapup-started", ["OpenGate"]);
}

/**
 * How a dequeue routes on the environment's choice. It is a decider rather
 * than a composition inside an action because the routing is machine
 * semantics: with it inline, rerouting a valid artifact into the lease shipped
 * green through every layer, because every driver carried a copy.
 */
export function decideDequeue(
  config: Config,
  core: Core,
  id: TicketId,
  moved: boolean,
): Decision {
  return moved
    ? decideWrapUpStart(core, id)
    : decideWrapUpResolve(config, core, id, "WOk", false);
}

/**
 * The wrap-up resolves at the end of a concrete path: a success is the ticket's
 * single completion, and a failure re-enters work priced per the gate pricing,
 * either wall parking the ticket re-enqueued rather than in the gate. Every arm
 * stamps the attempt's attribution.
 */
export function decideWrapUpResolve(
  config: Config,
  core: Core,
  id: TicketId,
  outcome: WrapUpOutcome,
  moved: boolean,
): Decision {
  const project = ticketAt(core, id).project;
  return withWrapUpObs(resolveArm(config, core, id, outcome), project, moved);
}

function resolveArm(
  config: Config,
  core: Core,
  id: TicketId,
  outcome: WrapUpOutcome,
): Decision {
  if (outcome === "WOk") return completeTicket(core, id);
  const ticket = ticketAt(core, id);
  const reworkIntoWork = (): Decision =>
    move(
      withTicket(core, id, {
        ...spawnOn(ticket, tkWork, config.nTasks),
        wrapUpLeft:
          config.wrapUpPricing.pricing === "Budgeted"
            ? ticket.wrapUpLeft - 1
            : ticket.wrapUpLeft,
        gasLeft: ticket.gasLeft - 1,
      }),
      id,
      "PWorking",
      "rework-started wrapup_failure",
      ["SpawnWorkTasks"],
    );

  switch (config.wrapUpPricing.pricing) {
    case "Budgeted":
      if (ticket.wrapUpLeft > 0 && ticket.gasLeft > 0) return reworkIntoWork();
      if (ticket.wrapUpLeft === 0) {
        return escalate(
          core,
          id,
          "RWrapUp",
          "RsWrapUpBudgetExhausted",
          "ticket-escalated wrapup_budget_exhausted",
        );
      }
      return escalate(
        core,
        id,
        "RWrapUp",
        "RsGasExhausted",
        "ticket-escalated gas_exhausted",
      );
    case "DeadlineOnly":
      if (ticket.gasLeft > 0) return reworkIntoWork();
      return escalate(
        core,
        id,
        "RWrapUp",
        "RsGasExhausted",
        "ticket-escalated gas_exhausted",
      );
    default:
      return assertNever(config.wrapUpPricing);
  }
}

/**
 * A duplicate completion for an already-Done ticket. No completion effect is
 * emitted, and that no-op is the exactly-once claim at the completion boundary.
 */
export function decideCompleteDuplicate(core: Core, id: TicketId): Decision {
  /** The precondition asserted rather than re-decided: a re-delivery names a ticket the fleet holds. */
  ticketAt(core, id);
  return noop(core, "complete-duplicate");
}

/** The pre-work revalidation wall: the world changed under a ticket before it ever ran. */
export function decideRevalFail(core: Core, id: TicketId): Decision {
  return escalate(
    core,
    id,
    "RPending",
    "RsRevalidationFailed",
    "ticket-escalated revalidation_failed",
  );
}

/**
 * The operator resume: one decider, a flavour per resume point, one label. The
 * evaluating flavour spawns a fresh lowest stage rather than resuming
 * mid-sequence, so the retried tasks are new records and the failed ones stay
 * retired in the log.
 */
export function decideOpRetry(
  config: Config,
  core: Core,
  id: TicketId,
): Decision {
  const before = ticketAt(core, id);
  const resumed: Ticket = {
    ...before,
    reason: "RsNone",
    resumeAt: "RNone",
    gasLeft: before.gasLeft - resumeCharge(config, before.resumeAt),
  };
  switch (before.resumeAt) {
    case "RPending":
      return move(
        withTicket(core, id, resumed),
        id,
        "PPending",
        "operator-retry",
        [],
      );
    case "RWorking":
      return move(
        withTicket(core, id, spawnOn(resumed, tkWork, config.nTasks)),
        id,
        "PWorking",
        "operator-retry",
        ["SpawnWorkTasks"],
      );
    case "REvaluating": {
      const first = before.program[0];
      if (first === undefined) {
        throw new Error(
          `decideOpRetry: ticket ${String(id)} has an empty program`,
        );
      }
      return move(
        withTicket(core, id, spawnOn(resumed, tkEval(0), first.fanout)),
        id,
        "PEvaluating",
        "operator-retry",
        ["SpawnEvalTasks"],
      );
    }
    case "RWrapUp":
      return move(
        withTicket(core, id, resumed),
        id,
        "PWrapUp",
        "operator-retry",
        ["EnqueueWrapUp"],
      );
    case "RNone":
      /** Unreachable: the enablement refuses a ticket with no modeled resume. */
      return noop(core, "operator-retry-unreachable");
    default:
      return assertNever(before.resumeAt);
  }
}

/** The quiesced fleet's stutter: nothing is enabled, and the state is identical. */
export function settledRecord(): StepRecord {
  return { label: "settled", transitions: [], effects: [], attempt: woNone };
}

/** Which resource a ticket's wrap-up needs, re-exported so a caller reads one name. */
export { leaseOf };
