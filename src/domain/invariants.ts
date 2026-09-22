/**
 * The safety invariants, one predicate per name `model/domain.qnt` declares.
 *
 * EVERY ONE IS A PURE FUNCTION OF A STEP VIEW — the states either side of a
 * decision and the record it wrote. That is what lets the same predicates
 * judge a replayed golden, a randomized walk and a unit fixture without any of
 * them knowing which is which.
 *
 * THE ROSTER AT THE BOTTOM IS THE POINT. The model bundles these under
 * `allInvariants`, and `test/domain/bundle.test.ts` holds the roster here
 * against the model's own text: an invariant added there and not here is a
 * failure rather than a silent gap. It is not a list a reader is asked to
 * trust.
 */

import { type Config } from "./config.ts";
import { liveTickets, ticketAt } from "./ticketGraph.ts";
import { coveredSet, stuckSet, subsetOf } from "./derived.ts";
import type {
  TicketGraph,
  StepRecord,
  Task,
  Ticket,
} from "./generated/modelTypes.ts";
import { type TicketId } from "./ids.ts";
import {
  evalStage,
  taskEquals,
  taskIdentityEquals,
  taskIdentityValid,
  taskOrdinal,
  taskOwner,
  tasksInOrdinalOrder,
  workTaskOf,
} from "./task.ts";

/** What one invariant is evaluated against: the last decision, and the states either side of it. */
export interface StepView {
  readonly pre: TicketGraph;
  readonly rec: StepRecord;
  readonly post: TicketGraph;
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
  graph: TicketGraph,
  holds: (ticket: Ticket, id: TicketId) => boolean,
): boolean {
  return liveTickets(graph).every((id) => holds(ticketAt(graph, id), id));
}

/**
 * A ticket completes at most once, and holds a completion exactly while it is
 * Done. The count is the model's stored ledger, which is what makes a
 * double-spend visible rather than merely absent.
 */
export const completionExclusive: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.completions <= 1 && (t.completions === 1) === (t.phase === "Done"),
  );

/** A revoked ticket never completed on the way out. */
export const revokedNeverCompletes: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.phase !== "Revoked" || t.completions === 0,
  );

/** Nothing is Done without having produced the artifact its dependents read. */
export const artifactWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => t.phase !== "Done" || t.artifact !== "NoArtifact",
  );

/** Terminal outcomes absorb: no transition ever leaves one. */
export const terminalsAbsorbing: Invariant = (_config, view) =>
  view.rec.transitions.every((t) => !["Done", "Revoked"].includes(t.from));

/**
 * The desk's one equivalence. A ticket names a wall exactly while it is
 * parked; where that wall resumes is derived from it and total, so a desk task
 * cannot offer a continuation the deciders would refuse.
 */
export const deskConsistent: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) => (t.phase === "Escalated") === (t.escalation !== "NoEscalation"),
  );

/** Never cancelled, which is a retirement mark rather than an outcome events deliver. */
function liveTaskIsNotCancelled(task: Task): boolean {
  return !(task.state !== "Outstanding" && task.state.value === "Cancelled");
}

/**
 * The live task set is exactly the current phase's anatomy: the work task of
 * the cycle just started while Work, one run of one stage's fan-out judging
 * that cycle while Evaluation, and empty everywhere else. Dead live-task state
 * is never carried, and cancelled never appears live.
 */
export const tasksWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) => {
    const live = tasksInOrdinalOrder(t.tasks);
    if (t.phase === "Work") {
      return (
        t.tasks.size === 1 &&
        live.every(
          (task) =>
            taskIdentityEquals(
              task.identity,
              workTaskOf(id, t.workCyclesStarted),
            ) && liveTaskIsNotCancelled(task),
        )
      );
    }
    if (t.phase === "Evaluation") {
      const stage = evalStage(t.tasks);
      const declared = t.program[stage];
      return (
        stage >= 0 &&
        declared !== undefined &&
        t.tasks.size === declared.fanout &&
        live.every(
          (task) =>
            task.identity.type === "EvaluationTask" &&
            task.identity.value.ticket === id &&
            task.identity.value.workCycle === t.workCyclesStarted &&
            task.identity.value.stage === stage + 1 &&
            liveTaskIsNotCancelled(task),
        ) &&
        live.every((task, index) => taskOrdinal(task.identity) === index + 1)
      );
    }
    return t.tasks.size === 0;
  });

/** The retained record belongs to its ticket, is fully settled, and indexes into the program. */
export const recordWellFormed: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) =>
    t.record.every((task) => {
      if (taskOwner(task.identity) !== id) return false;
      if (task.state === "Outstanding") return false;
      if (task.identity.type === "WorkTask") return true;
      const stage = task.identity.value.stage - 1;
      return stage >= 0 && stage < t.program.length;
    }),
  );

/** History is append-only: no decision rewrites or shortens a retained record. */
export const recordMonotone: Invariant = (_config, view) =>
  liveTickets(view.pre).every((id) => {
    if (!view.post.tickets.has(id)) return false;
    const before = ticketAt(view.pre, id).record;
    const after = ticketAt(view.post, id).record;
    return (
      after.length >= before.length &&
      before.every((task, index) => {
        const kept = after[index];
        return kept !== undefined && taskEquals(task, kept);
      })
    );
  });

/**
 * Every task ever spawned is either retired into the record or live in the
 * set, and the work-cycle counter is what the ticket's work tasks show — the
 * counter being stored so a spawn site can mint from it.
 */
export const idsAccounted: Invariant = (_config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.spawned === t.record.length + t.tasks.size &&
      t.workCyclesStarted ===
        [...t.record, ...t.tasks].filter(
          (task) => task.identity.type === "WorkTask",
        ).length,
  );

/** The contract's own predicate over every task the machine is waiting on. */
export const taskIdentitiesValid: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t) =>
    [...t.tasks].every((task) => taskIdentityValid(task.identity)),
  );

/** Every authored program is one a release could have drawn. */
export const programsWellFormed: Invariant = (config, view) =>
  everyLiveTicket(
    view.post,
    (t) =>
      t.program.length >= 1 &&
      t.program.length <= config.maxStages &&
      t.program.every((s) => s.fanout >= 1 && s.fanout <= config.nTasks),
  );

/**
 * Everything this ticket transitively waits on, as a bounded fixpoint over
 * actual keys. A pass that changes anything adds at least one id, so the
 * fleet's own size is house rule 9's explicit bound.
 */
function dependencyClosure(
  graph: TicketGraph,
  id: TicketId,
): ReadonlySet<number> {
  const seen = new Set<number>(ticketAt(graph, id).deps);
  for (let pass = 0; pass < liveTickets(graph).length; pass++) {
    for (const d of [...seen]) {
      if (!graph.tickets.has(d)) continue;
      for (const further of ticketAt(graph, d as TicketId).deps)
        seen.add(further);
    }
  }
  return seen;
}

/** Dependencies name live tickets, and no ticket waits on itself through any chain. */
export const depsAcyclic: Invariant = (_config, view) =>
  everyLiveTicket(view.post, (t, id) => {
    const live = new Set<number>(liveTickets(view.post));
    return (
      [...t.deps].every((d) => live.has(d)) &&
      !dependencyClosure(view.post, id).has(id)
    );
  });

/**
 * Ids come from the universe a release draws from, and the fleet stays within
 * its bound. They are sparse by construction, so this is a membership claim
 * rather than a density one.
 */
export const ticketIdsWellFormed: Invariant = (config, view) => {
  const universeCeiling = config.nTickets * 2;
  const live = liveTickets(view.post);
  return (
    live.every((id) => id >= 1 && id <= universeCeiling) &&
    live.length <= config.nTickets
  );
};

/** Nothing is stuck without a desk task reachable from it: the visibility guarantee. */
export const stuckSubsetCovered: Invariant = (_config, view) =>
  subsetOf(stuckSet(view.post), coveredSet(view.post));

/**
 * Every predicate the model's bundle names, in the order it names them.
 * `test/domain/bundle.test.ts` holds this roster against `model/domain.qnt`
 * itself rather than against a copy of it.
 */
export const invariantBundle: readonly NamedInvariant[] = [
  { invariant: "completionExclusive", holds: completionExclusive },
  { invariant: "revokedNeverCompletes", holds: revokedNeverCompletes },
  { invariant: "artifactWellFormed", holds: artifactWellFormed },
  { invariant: "terminalsAbsorbing", holds: terminalsAbsorbing },
  { invariant: "deskConsistent", holds: deskConsistent },
  { invariant: "tasksWellFormed", holds: tasksWellFormed },
  { invariant: "recordWellFormed", holds: recordWellFormed },
  { invariant: "recordMonotone", holds: recordMonotone },
  { invariant: "idsAccounted", holds: idsAccounted },
  { invariant: "taskIdentitiesValid", holds: taskIdentitiesValid },
  { invariant: "programsWellFormed", holds: programsWellFormed },
  { invariant: "depsAcyclic", holds: depsAcyclic },
  { invariant: "ticketIdsWellFormed", holds: ticketIdsWellFormed },
  { invariant: "stuckSubsetCovered", holds: stuckSubsetCovered },
];

/** The members that came back false, named. An empty list is the green answer. */
export function failedInvariants(
  config: Config,
  view: StepView,
): readonly string[] {
  return invariantBundle
    .filter((member) => !member.holds(config, view))
    .map((member) => member.invariant);
}

/** The bundle's own verdict, as the model's `allInvariants` asks for it. */
export function allInvariants(config: Config, view: StepView): boolean {
  return invariantBundle.every((member) => member.holds(config, view));
}
