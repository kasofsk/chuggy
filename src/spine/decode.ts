/**
 * A decoded trace into REPLAY PLANS — one per step, in the one `Cmd`
 * vocabulary, from either tier.
 *
 * TIER 1 IS THE DECISION EVENT ITSELF. `quint run --mbt` gives every state the
 * action that fired and the picks it drew, so the plan is a translation:
 * `(actionTaken, nondetPicks)` to `Cmd`, with the picks each action needs
 * demanded rather than defaulted.
 *
 * TIER 2 IS RECONSTRUCTION, and it is exact rather than clever. `quint test`
 * has no `--mbt`, so a witness trace carries only the machine's vars — and that
 * is enough, because every non-stutter label is fully determined by what the
 * step record and the two states already say: the head transition carries the
 * stepped ticket, an arrival's authored data rides the new ticket record, a
 * task completion is the one running task that became resolved, a dequeue's
 * `moved` is the target phase, and a landing resolution's outcome is its label.
 * Where two routes share a label — `ticket-done` arrives from a passing
 * evaluation, a quiet dequeue or a gated resolution, and `gas_exhausted` from
 * either the eval interpreter or the gate — the landing observation separates
 * them, and the from-phase is checked against it so the two agree rather than
 * one being trusted.
 *
 * A DECODE FAILURE IS NEVER A GUESS. Every arm that cannot determine its
 * command raises, because the alternative is a corpus that replays green
 * against a command the model did not take. The emitter decodes what it
 * regenerates, so a failure surfaces there; the gate reports one as
 * could-not-run.
 *
 * THE STUTTER STEPS ARE PLANNED, NOT DECODED, and the label is what routes
 * them: `task-done-duplicate` and `complete-duplicate` record no transition and
 * move no state, so no pair of states carries their pick. Their treatment is
 * `replay.ts`'s absorbing pick class. Tier 1 does carry the pick, and it rides
 * along as `recorded` — the class is the check, and the recorded pick is one
 * more member of it.
 */

import { assertNever } from "../domain/assert.ts";
import { firstTicketId } from "../domain/domain.ts";
import type {
  Core,
  Phase,
  StepRecord,
  TaskOutcome,
  Verdict,
} from "../domain/measure.ts";
import type { Cmd } from "./cmd.ts";
import { DecodeError, type DecodedTrace, type Picks } from "./itf.ts";

/**
 * `model/domain.qnt`'s REACHABLE step labels. The model emits one more —
 * `operator-retry-unreachable`, the guarded no-op `retryableIn` refuses — and a
 * trace carrying it would be a machine this roster does not describe, so it is
 * absent here and a decode failure if it arrives.
 */
export type StepLabel =
  | "init"
  | "ticket-arrived"
  | "ticket-released"
  | "ticket-revoked"
  | "dispatch"
  | "task-done"
  | "task-done-duplicate"
  | "work-passed"
  | "eval-stage-passed"
  | "eval-passed"
  | "rework-started eval_failure"
  | "rework-started wrapup_failure"
  | "wrapup-started"
  | "ticket-done"
  | "ticket-escalated work_failed"
  | "ticket-escalated rework_budget_exhausted"
  | "ticket-escalated wrapup_budget_exhausted"
  | "ticket-escalated gas_exhausted"
  | "ticket-escalated revalidation_failed"
  | "complete-duplicate"
  | "operator-retry"
  | "settled";

/** The same roster as data, for the corpus's coverage obligation. */
export const reachableStepLabels: readonly StepLabel[] = [
  "init",
  "ticket-arrived",
  "ticket-released",
  "ticket-revoked",
  "dispatch",
  "task-done",
  "task-done-duplicate",
  "work-passed",
  "eval-stage-passed",
  "eval-passed",
  "rework-started eval_failure",
  "rework-started wrapup_failure",
  "wrapup-started",
  "ticket-done",
  "ticket-escalated work_failed",
  "ticket-escalated rework_budget_exhausted",
  "ticket-escalated wrapup_budget_exhausted",
  "ticket-escalated gas_exhausted",
  "ticket-escalated revalidation_failed",
  "complete-duplicate",
  "operator-retry",
  "settled",
];

/** What the replayer does with one step of a trace. */
export type StepPlan =
  | { readonly kind: "decided"; readonly cmd: Cmd }
  | {
      readonly kind: "stutter";
      readonly label: "task-done-duplicate" | "complete-duplicate";
      readonly recorded?: Cmd;
    }
  | { readonly kind: "settled" };

/** The label of a state's record, narrowed to the reachable roster. */
export function stepLabel(rec: StepRecord, where: string): StepLabel {
  const known = reachableStepLabels.find((l) => l === rec.label);
  if (known === undefined) {
    throw new DecodeError(
      `${where}: ${JSON.stringify(rec.label)} is outside the reachable step-label roster`,
    );
  }
  return known;
}

/**
 * One plan per step of the trace — state `i` for `i >= 1`, since state 0 is
 * `init` and no decision produced it.
 */
export function decodeSteps(
  trace: DecodedTrace,
  where: string,
): readonly StepPlan[] {
  const plans: StepPlan[] = [];
  for (let i = 1; i < trace.states.length; i += 1) {
    const at = `${where}.states[${String(i)}]`;
    const previous = trace.states[i - 1];
    const state = trace.states[i];
    if (previous === undefined || state === undefined) {
      throw new DecodeError(`${at}: the trace is not dense`);
    }
    const label = stepLabel(state.lastStep, at);
    plans.push(
      trace.hasDecisionEvents
        ? fromDecisionEvent(state.action, state.picks, label, at)
        : reconstruct(previous.core, state.core, state.lastStep, label, at),
    );
  }
  return plans;
}

// === Tier 1: the native decision event =====================================

/**
 * The model's thirteen actions, by the name `mbt::actionTaken` carries.
 * `settle` is here because the machine takes it; `init` is not, because it
 * produces no step.
 */
function fromDecisionEvent(
  action: string | undefined,
  picks: Picks | undefined,
  label: StepLabel,
  where: string,
): StepPlan {
  if (action === undefined || picks === undefined) {
    throw new DecodeError(`${where}: a decision-event trace names its action`);
  }
  if (label === "settled") {
    expectAction(action, "settle", where);
    return { kind: "settled" };
  }
  const cmd = cmdOfAction(action, picks, where);
  if (label === "task-done-duplicate" || label === "complete-duplicate") {
    expectAction(
      action,
      label === "task-done-duplicate" ? "taskDone" : "completeDuplicate",
      where,
    );
    return { kind: "stutter", label, recorded: cmd };
  }
  return { kind: "decided", cmd };
}

function expectAction(action: string, expected: string, where: string): void {
  if (action !== expected) {
    throw new DecodeError(
      `${where}: this label is ${expected}'s, and the trace names ${action}`,
    );
  }
}

function cmdOfAction(action: string, picks: Picks, where: string): Cmd {
  switch (action) {
    case "arrive":
      return {
        tag: "JArrive",
        deps: need(picks.deps, "deps_", where),
        program: need(picks.program, "prog", where),
        project: need(picks.project, "project_", where),
        wrapUp: need(picks.wrapUp, "wrapUp_", where),
      };
    case "release":
      return { tag: "JRelease", ticket: need(picks.ticket, "j", where) };
    case "revoke":
      return { tag: "JRevoke", ticket: need(picks.ticket, "j", where) };
    case "dispatch":
      return { tag: "JDispatch", ticket: need(picks.ticket, "j", where) };
    case "taskDone":
      return {
        tag: "JTaskDone",
        ticket: need(picks.ticket, "j", where),
        tid: need(picks.tid, "tid", where),
        verdict: need(picks.verdict, "v", where),
      };
    case "workReduce":
      return { tag: "JWorkReduce", ticket: need(picks.ticket, "j", where) };
    case "evalReduce":
      return { tag: "JEvalReduce", ticket: need(picks.ticket, "j", where) };
    case "wrapUpStart":
      return {
        tag: "JDequeue",
        ticket: need(picks.ticket, "j", where),
        moved: need(picks.moved, "moved", where),
      };
    case "wrapUpResolve":
      return {
        tag: "JGateResolve",
        ticket: need(picks.ticket, "j", where),
        out: need(picks.out, "out", where),
      };
    case "completeDuplicate":
      return {
        tag: "JCompleteDuplicate",
        ticket: need(picks.ticket, "j", where),
      };
    case "revalFail":
      return { tag: "JRevalFail", ticket: need(picks.ticket, "j", where) };
    case "opRetry":
      return { tag: "JOpRetry", ticket: need(picks.ticket, "j", where) };
    default:
      throw new DecodeError(`${where}: ${action} is not a machine action`);
  }
}

function need<T>(value: T | undefined, binder: string, where: string): T {
  if (value === undefined) {
    throw new DecodeError(
      `${where}: this action draws ${binder}, and the trace bound nothing`,
    );
  }
  return value;
}

// === Tier 2: reconstruction ================================================

function reconstruct(
  previous: Core,
  next: Core,
  rec: StepRecord,
  label: StepLabel,
  where: string,
): StepPlan {
  switch (label) {
    case "init":
      throw new DecodeError(`${where}: init is the trace's base, not a step`);
    case "settled":
      return { kind: "settled" };
    case "task-done-duplicate":
    case "complete-duplicate":
      return { kind: "stutter", label };
    case "ticket-arrived":
      return { kind: "decided", cmd: arrivalOf(previous, next, where) };
    case "ticket-released":
      return {
        kind: "decided",
        cmd: { tag: "JRelease", ticket: stepped(rec, where) },
      };
    case "ticket-revoked":
      return {
        kind: "decided",
        cmd: { tag: "JRevoke", ticket: stepped(rec, where) },
      };
    case "dispatch":
      return {
        kind: "decided",
        cmd: { tag: "JDispatch", ticket: stepped(rec, where) },
      };
    case "task-done":
      return { kind: "decided", cmd: completionOf(previous, next, where) };
    case "work-passed":
    case "ticket-escalated work_failed":
      return {
        kind: "decided",
        cmd: { tag: "JWorkReduce", ticket: stepped(rec, where) },
      };
    case "eval-stage-passed":
    case "eval-passed":
    case "rework-started eval_failure":
    case "ticket-escalated rework_budget_exhausted":
      return {
        kind: "decided",
        cmd: { tag: "JEvalReduce", ticket: stepped(rec, where) },
      };
    case "wrapup-started":
      return {
        kind: "decided",
        cmd: { tag: "JDequeue", ticket: stepped(rec, where), moved: true },
      };
    case "ticket-done":
      return { kind: "decided", cmd: completionRoute(rec, where) };
    case "rework-started wrapup_failure":
    case "ticket-escalated wrapup_budget_exhausted":
      return { kind: "decided", cmd: gateFailure(rec, where) };
    case "ticket-escalated gas_exhausted":
      return {
        kind: "decided",
        cmd:
          rec.landing.tag === "WONone"
            ? { tag: "JEvalReduce", ticket: stepped(rec, where) }
            : gateFailure(rec, where),
      };
    case "ticket-escalated revalidation_failed":
      return {
        kind: "decided",
        cmd: { tag: "JRevalFail", ticket: stepped(rec, where) },
      };
    case "operator-retry":
      return {
        kind: "decided",
        cmd: { tag: "JOpRetry", ticket: stepped(rec, where) },
      };
    default:
      return assertNever(label, `${where}: unhandled step label`);
  }
}

/**
 * The stepped ticket: `model/domain.qnt`'s `move` records it as the head
 * transition, and `refinement.qnt`'s world accounting reads it the same way
 * ("every effect-bearing record's head transition is the stepped ticket").
 */
function stepped(rec: StepRecord, where: string): number {
  const [head] = rec.transitions;
  if (head === undefined) {
    throw new DecodeError(
      `${where}: this label steps a ticket and records no transition`,
    );
  }
  return head.ticket;
}

/**
 * An arrival's four authored draws, read off the ticket it created. The id is
 * the one `decideArrive` mints — the fleet's size plus the first id — and it is
 * checked to be absent before and present after, so a fixture whose arrival did
 * not densely extend the fleet fails here rather than in the comparison.
 */
function arrivalOf(previous: Core, next: Core, where: string): Cmd {
  const id = previous.tickets.size + firstTicketId;
  if (previous.tickets.has(id)) {
    throw new DecodeError(
      `${where}: ticket ${String(id)} predates its own arrival`,
    );
  }
  const born = next.tickets.get(id);
  if (born === undefined) {
    throw new DecodeError(`${where}: no ticket ${String(id)} arrived`);
  }
  return {
    tag: "JArrive",
    deps: born.deps,
    program: born.program,
    project: born.project,
    wrapUp: born.wrapUp,
  };
}

/**
 * A task completion, from the one task that stopped running. Exactly one is
 * required in both directions: a step that resolved none is not this label, and
 * a step that resolved two is not one delivery.
 */
function completionOf(previous: Core, next: Core, where: string): Cmd {
  const resolved: Cmd[] = [];
  for (const [ticket, before] of previous.tickets) {
    const after = next.tickets.get(ticket);
    if (after === undefined) {
      continue;
    }
    for (const task of before.tasks) {
      if (task.state.tag !== "TSRunning") {
        continue;
      }
      const now = after.tasks.find((t) => t.id === task.id);
      if (now === undefined || now.state.tag !== "TSResolved") {
        continue;
      }
      resolved.push({
        tag: "JTaskDone",
        ticket,
        tid: task.id,
        verdict: verdictOf(now.state.outcome, where),
      });
    }
  }
  const only = resolved[0];
  if (only === undefined || resolved.length !== 1) {
    throw new DecodeError(
      `${where}: a task-done step resolves exactly one live task, and this one resolved ${String(resolved.length)}`,
    );
  }
  return only;
}

/** The event's verdict behind a stored resolution. Cancellation is retirement, not delivery. */
function verdictOf(outcome: TaskOutcome, where: string): Verdict {
  switch (outcome) {
    case "TPassed":
      return "VPass";
    case "TFailed":
      return "VFail";
    // A cancellation is a RETIREMENT mark rather than an outcome an event can
    // deliver — `retireLive` stamps it — so a task-done step that produced one
    // is not a step this machine takes.
    case "TCancelled":
      throw new DecodeError(
        `${where}: no completion event resolves a task ${outcome}`,
      );
    default:
      return assertNever(outcome, `${where}: unhandled TaskOutcome`);
  }
}

/**
 * Which route landed the ticket. The landing observation is the discriminator —
 * `WONone` is the passing evaluation of a `WNone` ticket, an attempt the
 * environment left valid is the quiet dequeue, an invalidated one is the gated
 * resolution — and the from-phase is checked against it, so the two independent
 * carriers of the same fact must agree.
 */
function completionRoute(rec: StepRecord, where: string): Cmd {
  const ticket = stepped(rec, where);
  switch (rec.landing.tag) {
    case "WONone":
      expectFrom(rec, "PEvaluating", where);
      return { tag: "JEvalReduce", ticket };
    case "WOAttempt":
      if (rec.landing.invalidated) {
        expectFrom(rec, "PWrapUpHolding", where);
        return { tag: "JGateResolve", ticket, out: "WOk" };
      }
      expectFrom(rec, "PWrapUp", where);
      return { tag: "JDequeue", ticket, moved: false };
    default:
      return assertNever(rec.landing, `${where}: unhandled WrapUpObs`);
  }
}

/**
 * A landing that failed. `wrapUpOutcomes` makes `WFailed` undrawable on a quiet
 * attempt, so every failing landing resolved out of the gate — which is what
 * the invalidated flag and the from-phase are checked to say.
 */
function gateFailure(rec: StepRecord, where: string): Cmd {
  if (rec.landing.tag !== "WOAttempt" || !rec.landing.invalidated) {
    throw new DecodeError(
      `${where}: a landing failure resolves an invalidated attempt, and this step records none`,
    );
  }
  expectFrom(rec, "PWrapUpHolding", where);
  return { tag: "JGateResolve", ticket: stepped(rec, where), out: "WFailed" };
}

function expectFrom(rec: StepRecord, from: Phase, where: string): void {
  const [head] = rec.transitions;
  if (head === undefined || head.from !== from) {
    throw new DecodeError(
      `${where}: this route leaves ${from}, and the step leaves ${String(head?.from)}`,
    );
  }
}
