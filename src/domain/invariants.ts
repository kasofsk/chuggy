/**
 * Every safety invariant `model/domain.qnt` proves, as an executable pure
 * predicate, plus the two rosters the model itself keeps: the leaves, and the
 * bundle a run checks.
 *
 * ONE SIGNATURE, NEVER A MIXTURE. Some of these read only the state, some read
 * the step record beside it, and two need the state before the step — so each
 * takes the same `StepView` and ignores what it does not need. A bundle whose
 * members took different arguments would be a bundle nobody can iterate, and
 * the `Invariant` annotation on every one of them is what makes that a compile
 * error rather than a convention. The configuration rides in front of the view
 * because the model's constants are module constants it instantiates a module
 * per configuration for, and this tree passes them instead — the shape every
 * decider already has.
 *
 * `pre` IS THE CORE BEFORE THE LAST DOMAIN *DECISION*, and `rec` is that
 * decision's record — not the state one step ago. `model/domain.qnt`'s
 * `installCore` declines to re-snapshot its two ghosts precisely so a
 * refinement-layer step leaves them stale, and an implementation reading `pre`
 * as the immediately preceding state breaks `stepDescends` on the emit step:
 * it would compare a measure against itself, find no exemption for the label,
 * and report a broken invariant on a step the model proves harmless. So the
 * pair is carried unchanged across emit, crash-recover and the hazard step,
 * and advances only when a decision lands. With that, neither ghost is stored:
 * one carried `Core` computes both `prevMeasure` and `prevRecords`.
 *
 * THE FAILURE REPORT NAMES ITS MEMBERS rather than collapsing to one answer,
 * because which invariant failed is the finding. It is deliberately not called
 * a verdict: `Verdict` is this machine's noun for a task completion's pass or
 * fail, and one noun means one thing.
 */

import { assertNever } from "./assertNever.ts";
import { boundsOf, projects, wrapUpChoices, type Config } from "./config.ts";
import {
  liveTickets,
  ticketAt,
  ticketIds,
  type Core,
  type StepRecord,
} from "./core.ts";
import {
  canFinishSet,
  coveredSet,
  revokeDoomed,
  stuckSet,
  subsetOf,
} from "./derived.ts";
import { leaseOf } from "./enablement.ts";
import { firstTaskId, type TicketId } from "./ids.ts";
import { phaseRank, rankSettled, type Phase } from "./phase.ts";
import { reworkBudget, wrapUpBudget } from "./pricing.ts";
import type { Stage } from "./program.ts";
import { sysMeasure } from "./measure.ts";
import { evalStage, taskEquals, type Task } from "./task.ts";
import { completionsOf, hasOpenHumanTask, type Ticket } from "./ticket.ts";
import { wrapUpEquals } from "./wrapUp.ts";

/** What one invariant is evaluated against: the last decision, and the states either side of it. */
export interface StepView {
  readonly pre: Core;
  readonly rec: StepRecord;
  readonly post: Core;
}

/** The one signature all of them have, whatever each of them reads. */
export type Invariant = (config: Config, view: StepView) => boolean;

/** One invariant under the name `model/domain.qnt` declares it by. */
export interface NamedInvariant {
  readonly invariant: string;
  readonly holds: Invariant;
}

/** Every live ticket satisfies this, read in ascending id order. */
function everyLiveTicket(
  core: Core,
  holds: (ticket: Ticket, id: TicketId) => boolean,
): boolean {
  return liveTickets(core).every((id) => holds(ticketAt(core, id), id));
}

/**
 * Exactly one completion per ticket, exactly when it is Done. This record
 * derives the count the model stores as a ghost, so no state can carry the
 * disagreement — see `completionExclusiveFor`, which is where the defect lives.
 */
export const completionExclusive: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) =>
    completionExclusiveFor(completionsOf(t), t.phase),
  );

/**
 * The per-ticket conjunction, stated over a count rather than a ticket. A
 * stored ghost that disagreed with the phase is the mutant this rejects, and
 * feeding it one is the only way this predicate can be made to fail here.
 */
export function completionExclusiveFor(
  completions: number,
  phase: Phase,
): boolean {
  return completions <= 1 && (completions === 1) === (phase === "PDone");
}

/**
 * A revoked ticket has emitted no completion and never will. The model states
 * it named rather than leaving it a corollary, and so does this.
 */
export const revokedNeverCompletes: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) =>
    revokedNeverCompletesFor(completionsOf(t), t.phase),
  );

/** The per-ticket implication, over a count, for `completionExclusiveFor`'s reason. */
export function revokedNeverCompletesFor(
  completions: number,
  phase: Phase,
): boolean {
  return phase !== "PRevoked" || completions === 0;
}

/**
 * Wrap-up isolation: a step carrying an attempt is exactly a step resolving
 * one, attributed to the stepped ticket's own project, and a gate failure can
 * only follow that project's own branch moving.
 */
export const wrapUpIsolation: Invariant = (config, view) => {
  const rec = view.rec;
  switch (rec.attempt.attempt) {
    case "WONone":
      return (
        wrapUpIsolationUnattributedDone(view) &&
        rec.label !== "rework-started wrapup_failure" &&
        rec.label !== "ticket-escalated wrapup_budget_exhausted"
      );
    case "WOAttempt": {
      const attempt = rec.attempt;
      const first = rec.transitions[0];
      return (
        projects(config).includes(attempt.project) &&
        first !== undefined &&
        ticketAt(view.post, first.ticket).project === attempt.project &&
        wrapUpIsolationResolves(rec.label) &&
        (rec.label === "ticket-done" || attempt.invalidated) &&
        first.from === (attempt.invalidated ? "PWrapUpHolding" : "PWrapUp") &&
        rec.transitions.length === 1
      );
    }
    default:
      return assertNever(rec.attempt);
  }
};

/**
 * The one completion that legitimately carries no attribution: a ticket whose
 * kind needed no lease resolved no wrap-up attempt at all.
 */
function wrapUpIsolationUnattributedDone(view: StepView): boolean {
  if (view.rec.label !== "ticket-done") return true;
  const first = view.rec.transitions[0];
  return (
    view.rec.transitions.length === 1 &&
    first !== undefined &&
    ticketAt(view.post, first.ticket).wrapUp.wrapUp === "WNone"
  );
}

/** The labels a resolved attempt may carry; the gas wall is shared with the eval side. */
function wrapUpIsolationResolves(label: string): boolean {
  return (
    label === "ticket-done" ||
    label === "rework-started wrapup_failure" ||
    label === "ticket-escalated wrapup_budget_exhausted" ||
    label === "ticket-escalated gas_exhausted"
  );
}

/**
 * An attempt the environment chose quiet resolves as the success, full stop.
 * The per-project reading is not a state theorem and the model says why; this
 * is the per-attempt form, which is.
 */
export const quietProjectLandsCleanly: Invariant = (_config, view) => {
  const attempt = view.rec.attempt;
  switch (attempt.attempt) {
    case "WONone":
      return true;
    case "WOAttempt":
      return attempt.invalidated || view.rec.label === "ticket-done";
    default:
      return assertNever(attempt);
  }
};

/**
 * No resource is ever held by two tickets. Occupancy is the derived phase
 * predicate, so nothing tracks it separately and nothing can disagree.
 */
export const leaseExclusive: Invariant = (config, view) =>
  projects(config).every((resource) => {
    const holders = liveTickets(view.post).filter((id) => {
      const ticket = ticketAt(view.post, id);
      return ticket.phase === "PWrapUpHolding" && leaseOf(ticket) === resource;
    });
    return holders.length <= 1;
  });

/**
 * A ticket whose kind needs no lease never takes one. Structural rather than
 * argued: it is what stops a deploy occupying a resource it has no stake in.
 */
export const noLeaseWithoutAKind: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.wrapUp.wrapUp !== "WNone" ||
      (t.phase !== "PWrapUp" && t.phase !== "PWrapUpHolding"),
  );

/**
 * A completed ticket produced something. Deliberately the weak form: the
 * stronger claim would be true by construction, and an invariant that cannot
 * fail is a defect written on purpose.
 */
export const artifactWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.phase !== "PDone" || t.artifact.artifact !== "ANone",
  );

/** Every live ticket targets a project inside the bounded universe: the arrival refusal made durable. */
export const projectsWellFormed: Invariant = (config, view) =>
  everyLiveTicket(view.post, (t) => projects(config).includes(t.project));

/**
 * Every live ticket's authored wrap-up choice is inside the bounded universe,
 * and what that catches is the resource inside the kind: `leaseExclusive`
 * counts holders per member of `projects`, so a lease outside it is serialized
 * against nothing and counted by nobody.
 */
export const wrapUpWellFormed: Invariant = (config, view) =>
  everyLiveTicket(view.post, (t) =>
    wrapUpChoices(config).some((choice) => wrapUpEquals(choice, t.wrapUp)),
  );

/** The two absorbing terminals never transition out, checked against the observed record. */
export const terminalsAbsorbing: Invariant = (_config, view) =>
  view.rec.transitions.every(
    (t) => t.from !== "PDone" && t.from !== "PRevoked",
  );

/**
 * The desk is consistent: a named wall exactly while parked, and a resume point
 * exactly where a modeled resume exists — which the cascade wall's does not,
 * because its only modeled exit is a revoke.
 */
export const deskConsistent: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      (t.phase === "PEscalated") === (t.reason !== "RsNone") &&
      (t.resumeAt !== "RNone") ===
        (t.phase === "PEscalated" && t.reason !== "RsDependencyRevoked"),
  );

/** The gate-budget wall exists only under budgeted pricing; the vocabulary is carried either way. */
export const wrapUpWallNamed: Invariant = (config, view) => {
  switch (config.wrapUpPricing.pricing) {
    case "Budgeted":
      return true;
    case "DeadlineOnly":
      return everyLiveTicket(
        view.post,
        (t) => t.reason !== "RsWrapUpBudgetExhausted",
      );
    default:
      return assertNever(config.wrapUpPricing);
  }
};

/** Every account stays a resource: bounded below by nothing overdrawing and above by nothing refunding. */
export const accountsBounded: Invariant = (config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.gasLeft >= 0 &&
      t.gasLeft <= config.gas &&
      t.reworkLeft >= 0 &&
      t.reworkLeft <= reworkBudget(config.reworkPolicy) &&
      t.wrapUpLeft >= 0 &&
      t.wrapUpLeft <= wrapUpBudget(config.wrapUpPricing),
  );

/** The live task set is exactly the current phase's anatomy, which is also the stage-index sanity check. */
export const tasksWellFormed: Invariant = (config, view) =>
  everyLiveTicket(view.post, (t) => tasksWellFormedFor(config, t));

/**
 * One ticket's anatomy: the single work set at full width, or one stage's
 * declared fan-out uniformly marked with the stage it indexes, or nothing at
 * all — dead live-task state is never carried.
 */
function tasksWellFormedFor(config: Config, ticket: Ticket): boolean {
  const start = ticket.record.length + firstTaskId;
  if (ticket.phase === "PWorking") {
    return (
      ticket.tasks.length === config.nTasks &&
      tasksWellFormedRun(ticket.tasks, start) &&
      ticket.tasks.every(
        (task) =>
          task.kind.kind === "TKWork" && !tasksWellFormedCancelled(task),
      )
    );
  }
  if (ticket.phase === "PEvaluating") {
    const stage = evalStage(ticket.tasks);
    const declared = ticket.program[stage];
    return (
      stage >= 0 &&
      declared !== undefined &&
      ticket.tasks.length === declared.fanout &&
      tasksWellFormedRun(ticket.tasks, start) &&
      ticket.tasks.every(
        (task) =>
          task.kind.kind === "TKEval" &&
          task.kind.stage === stage &&
          !tasksWellFormedCancelled(task),
      )
    );
  }
  return ticket.tasks.length === 0;
}

/** The live ids are the contiguous run directly above the retired record. */
function tasksWellFormedRun(tasks: readonly Task[], start: number): boolean {
  const ids = tasks.map((task) => task.id).sort((a, b) => a - b);
  return ids.every((value, index) => value === start + index);
}

/** Cancelled is a retirement mark, never an outcome an event can deliver live. */
function tasksWellFormedCancelled(task: Task): boolean {
  return (
    task.state.state === "TSResolved" && task.state.outcome === "TCancelled"
  );
}

/**
 * The retained record is the resolved log, one-indexed and in identity order,
 * and every retired eval task names a stage its ticket's program has.
 */
export const recordWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) =>
    t.record.every(
      (entry, index) =>
        entry.id === index + firstTaskId &&
        entry.state.state !== "TSRunning" &&
        recordWellFormedStage(entry, t.program),
    ),
  );

/** Programs are immutable, so a retired stage index never dangles. */
function recordWellFormedStage(
  entry: Task,
  program: readonly Stage[],
): boolean {
  switch (entry.kind.kind) {
    case "TKWork":
      return true;
    case "TKEval":
      return entry.kind.stage >= 0 && entry.kind.stage < program.length;
    default:
      return assertNever(entry.kind);
  }
}

/**
 * The record is append-only history: against the state before the decision,
 * nothing shrinks and nothing settled is rewritten. Tickets are never deleted,
 * so every earlier key survives.
 */
export const recordMonotone: Invariant = (_config, view) =>
  ticketIds(view.pre).every((id) => {
    const before = ticketAt(view.pre, id).record;
    const after = view.post.tickets.get(id)?.record;
    if (after === undefined || after.length < before.length) return false;
    return before.every((entry, index) => {
      const kept = after[index];
      return kept !== undefined && taskEquals(entry, kept);
    });
  });

/**
 * Identity accounting: every task a ticket ever spawned is still somewhere,
 * retired or live. A decider that dropped a set instead of retiring it is
 * invisible to the two well-formedness checks and is caught here.
 */
export const idsAccounted: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.spawned === t.record.length + t.tasks.length,
  );

/** Every live ticket carries a well-formed program: the arrival refusal made durable. */
export const programsWellFormed: Invariant = (config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.program.length >= 1 &&
      t.program.length <= config.maxStages &&
      t.program.every(
        (stage) => stage.fanout >= 1 && stage.fanout <= config.nTasks,
      ),
  );

/** Arrival's DAG-by-construction survives every step: each dep is known and strictly smaller. */
export const depsAcyclic: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) =>
    t.deps.every((d) => view.post.tickets.has(d) && d < id),
  );

/** Ids are dense from one and never reused, which is what makes every ascending fold above sound. */
export const idsDense: Invariant = (config, view) => {
  const ids = liveTickets(view.post);
  return (
    ids.every((id, index) => id === index + 1) && ids.length <= config.nTickets
  );
};

/**
 * The two walks agree — and that is all this says. It is a tautology over the
 * definitions rather than a theorem about the machine, kept for what it does
 * guard: the walks against each other, so an edit giving one a base case or an
 * edge kind the other lacks goes red here.
 */
export const stuckSubsetCovered: Invariant = (_config, view) =>
  subsetOf(stuckSet(view.post), coveredSet(view.post));

/**
 * Every ticket transitively doomed behind a revoked dep is parked with its own
 * desk task, or was settled by its own author. Always-parked rather than
 * eventually, because the cascade is atomic with the revoke.
 */
export const cascadeSafety: Invariant = (_config, view) =>
  [...revokeDoomed(view.post)].every((id) => {
    const ticket = ticketAt(view.post, id);
    return (
      ticket.phase === "PRevoked" ||
      (ticket.phase === "PEscalated" && ticket.reason === "RsDependencyRevoked")
    );
  });

/**
 * Every live ticket can still reach Done, or was settled by its author, or
 * holds a desk task a human can act on. Unlike the walks' containment this is
 * a claim about the machine, and a dependency cycle is what refutes it.
 */
export const noStructuralDeadlock: Invariant = (_config, view) => {
  const finishable = canFinishSet(view.post);
  return everyLiveTicket(
    view.post,
    (t, id) =>
      finishable.has(id) || t.phase === "PRevoked" || hasOpenHumanTask(t),
  );
};

/** Well-foundedness: the measure is bounded below, checked directly for the descent argument's own integrity. */
export const measureNonNegative: Invariant = (config, view) =>
  sysMeasure(boundsOf(config), view.post) >= 0;

/**
 * Every step strictly decreases the measure except the named stutter, churn
 * and authoring steps. There is no exemption for the stage advance: that is
 * the stage digit earning its keep.
 */
export const stepDescends: Invariant = (config, view) => {
  if (stepDescendsExempt(config, view.rec)) return true;
  const bounds = boundsOf(config);
  return sysMeasure(bounds, view.post) < sysMeasure(bounds, view.pre);
};

/** The roster of exempt steps, in the order `model/domain.qnt`'s own header names them. */
function stepDescendsExempt(config: Config, rec: StepRecord): boolean {
  return (
    rec.label === "init" ||
    rec.label === "task-done-duplicate" ||
    rec.label === "complete-duplicate" ||
    rec.label === "settled" ||
    stepDescendsChurn(config, rec) ||
    rec.label === "ticket-arrived" ||
    stepDescendsFlatRevoke(rec)
  );
}

/**
 * The uncharged operator resumes: the pre-work flavour, free under both
 * meterings because nothing was ever spent, and under free retries the
 * pipeline flavours too — the Working resume always pays.
 */
function stepDescendsChurn(config: Config, rec: StepRecord): boolean {
  if (rec.label !== "operator-retry") return false;
  return (
    rec.transitions.some((t) => t.to === "PPending") ||
    (config.opRetryPricing === "RetryFree" &&
      rec.transitions.some((t) => t.to !== "PWorking"))
  );
}

/**
 * A desk-only revoke is flat: every transition leaves a settled-rank phase and
 * the cascade parked nobody. A park or a live-rank revoke drags a rank down and
 * gets no exemption at all.
 */
function stepDescendsFlatRevoke(rec: StepRecord): boolean {
  return (
    rec.label === "ticket-revoked" &&
    rec.transitions.every((t) => phaseRank(t.from) === rankSettled)
  );
}

/** Both halves under the one name the model's bundle conjoins them by. */
export const measureDescends: Invariant = (config, view) =>
  measureNonNegative(config, view) && stepDescends(config, view);

/**
 * Every leaf predicate, in the order the model's bundle reaches them. This is
 * what a reviewer counts; `invariantBundle` is what a run checks, and
 * `test/domain/bundle.test.ts` holds both against `model/domain.qnt` itself.
 */
export const invariantLeaves: readonly NamedInvariant[] = [
  { invariant: "completionExclusive", holds: completionExclusive },
  { invariant: "revokedNeverCompletes", holds: revokedNeverCompletes },
  { invariant: "wrapUpIsolation", holds: wrapUpIsolation },
  { invariant: "quietProjectLandsCleanly", holds: quietProjectLandsCleanly },
  { invariant: "leaseExclusive", holds: leaseExclusive },
  { invariant: "noLeaseWithoutAKind", holds: noLeaseWithoutAKind },
  { invariant: "artifactWellFormed", holds: artifactWellFormed },
  { invariant: "projectsWellFormed", holds: projectsWellFormed },
  { invariant: "wrapUpWellFormed", holds: wrapUpWellFormed },
  { invariant: "terminalsAbsorbing", holds: terminalsAbsorbing },
  { invariant: "deskConsistent", holds: deskConsistent },
  { invariant: "wrapUpWallNamed", holds: wrapUpWallNamed },
  { invariant: "accountsBounded", holds: accountsBounded },
  { invariant: "tasksWellFormed", holds: tasksWellFormed },
  { invariant: "recordWellFormed", holds: recordWellFormed },
  { invariant: "recordMonotone", holds: recordMonotone },
  { invariant: "idsAccounted", holds: idsAccounted },
  { invariant: "programsWellFormed", holds: programsWellFormed },
  { invariant: "depsAcyclic", holds: depsAcyclic },
  { invariant: "idsDense", holds: idsDense },
  { invariant: "stuckSubsetCovered", holds: stuckSubsetCovered },
  { invariant: "cascadeSafety", holds: cascadeSafety },
  { invariant: "noStructuralDeadlock", holds: noStructuralDeadlock },
  { invariant: "measureNonNegative", holds: measureNonNegative },
  { invariant: "stepDescends", holds: stepDescends },
];

/** The halves the model bundles under one name, which is the only place the two rosters differ. */
const measureHalves = ["measureNonNegative", "stepDescends"];

/**
 * The bundle a run checks, derived from the leaves rather than listed beside
 * them — a second list would be a second thing to keep current, and the model's
 * own relationship between the two is exactly this substitution.
 */
export const invariantBundle: readonly NamedInvariant[] = [
  ...invariantLeaves.filter((m) => !measureHalves.includes(m.invariant)),
  { invariant: "measureDescends", holds: measureDescends },
];

/** The leaves that came back false, named. An empty list is the green answer. */
export function failedInvariants(
  config: Config,
  view: StepView,
): readonly string[] {
  return invariantLeaves
    .filter((member) => !member.holds(config, view))
    .map((member) => member.invariant);
}

/** The bundle's own verdict, as the model's `allInvariants` asks for it. */
export function allInvariants(config: Config, view: StepView): boolean {
  return invariantBundle.every((member) => member.holds(config, view));
}
