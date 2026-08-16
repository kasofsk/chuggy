/**
 * `model/tests/chuggy_test.qnt`'s FIXTURE VOCABULARY, once: the instances both
 * domain suites read, the four task builders, the two programs, and the
 * single-ticket fixture family the revoke and measure sections share.
 *
 * WHY IT IS ITS OWN FILE. Both suites mirror the same model suite against the
 * same fixtures, and `.chug/tasks/check-duplication.sh` is at threshold 0 with
 * tests deliberately in scope. Its header draws the line this file sits on: a
 * test's SCENARIO may repeat, its HARNESS is extracted. The model has ONE
 * `jDraft`; so does this tree.
 *
 * EVERY TICKET HERE COMES OUT OF A DECIDER, never out of a record literal that
 * happens to look like one — issue #13's rule, applied to the fixtures rather
 * than only to the helpers. `draft` is `freshTicket`, `escalated` is
 * `escalate`, `revokeOne` is `decideRevoke`. The one exception is `jParkDep`,
 * and it is an exception in the model too: see its note.
 *
 * WHY IT IS NAMED `.test.ts` AND DECLARES NO TEST. That suffix is this tree's
 * file class for "exists only for the suite", enforced by
 * `.dependency-cruiser.mjs`'s `domain-not-through-its-tests` and
 * `no-shipped-test-fixtures` rules — no module that ships may import one.
 * Naming it `fixtures.ts` would make it domain source: pure, and shipped, and
 * neither of those is true of it.
 */

import { decideRevoke, escalate, freshTicket, type Config } from "./domain.ts";
import { firstTaskId, spawnTasks } from "./measure.ts";
import type {
  Core,
  Decision,
  Reason,
  Resume,
  Stage,
  Task,
  TaskOutcome,
  Ticket,
  WrapUp,
} from "./measure.ts";

// === The instances =========================================================
// `chuggy_test` imports `chuggy_domain` five times and `mc/mc_chuggy.qnt`
// three more; these are the three whose CONSTS both suites read. The rest
// differ only in fields the reading suite does not exercise, and are built
// locally where they are needed.

/**
 * `chuggy_test`'s DB — the reference instance: Budgeted(1) gate pricing,
 * charged retries, two arrivals, two repos.
 */
export const cfgBudgeted: Config = {
  nTickets: 2,
  nTasks: 2,
  reworkPolicy: { tag: "RWBudget", budget: 1 },
  gas: 3,
  wrapUpPricing: { tag: "Budgeted", budget: 1 },
  opRetryPricing: "RetryCharged",
  maxStages: 2,
  nRepos: 2,
};

/** `chuggy_test`'s DD — the DeadlineOnly branch: no gate account to spend. */
export const cfgDeadlineOnly: Config = {
  ...cfgBudgeted,
  nTickets: 1,
  wrapUpPricing: { tag: "DeadlineOnly" },
};

/** `mc/mc_chuggy.qnt`'s retryfree instance: free resumes, and two gas. */
export const cfgRetryFree: Config = {
  ...cfgBudgeted,
  gas: 2,
  wrapUpPricing: { tag: "DeadlineOnly" },
  opRetryPricing: "RetryFree",
};

/** The lease every fixture below authors, and its repo-2 twin. */
export const wx1: WrapUp = { tag: "WExclusive", resource: 1 };
export const wx2: WrapUp = { tag: "WExclusive", resource: 2 };

// === Task and program vocabulary ===========================================

/** A RESOLVED work task. */
export function wt(id: number, outcome: TaskOutcome): Task {
  return { id, kind: { tag: "TKWork" }, state: { tag: "TSResolved", outcome } };
}

/** A RESOLVED eval task of stage `stage`. */
export function et(id: number, stage: number, outcome: TaskOutcome): Task {
  return {
    id,
    kind: { tag: "TKEval", stage },
    state: { tag: "TSResolved", outcome },
  };
}

/** A RUNNING work task. */
export function wr(id: number): Task {
  return { id, kind: { tag: "TKWork" }, state: { tag: "TSRunning" } };
}

/** A RUNNING eval task of stage `stage`. */
export function er(id: number, stage: number): Task {
  return { id, kind: { tag: "TKEval", stage }, state: { tag: "TSRunning" } };
}

/**
 * `chuggy_test`'s progU2 — exactly `defaultProgram` at these consts: one
 * unanimous stage at full fan-out.
 */
export const progU2: readonly Stage[] = [
  { fanout: 2, combinator: "CUnanimousPass" },
];

/**
 * `chuggy_test`'s progStaged — two stages, so a program can ADVANCE rather
 * than only pass, and so the two combinators appear in one program.
 */
export const progStaged: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
  { fanout: 2, combinator: "CAnyPass" },
];

// === Cores =================================================================

/** A Core over the given ids, in the model's `Map(...)` order. */
export function core(entries: readonly (readonly [number, Ticket])[]): Core {
  return { tickets: new Map(entries) };
}

/** The single-ticket Core the model writes as `{ tickets: Map(1 -> j) }`. */
export function solo(j: Ticket): Core {
  return core([[1, j]]);
}

// === Tickets, each through the decider that defines it =====================

/**
 * `DB::freshTicket(Set(), progU2, 1, WExclusive(1))` at a chosen instance —
 * the Draft an arrival produces, through the seam, carrying the accounts that
 * instance grants.
 */
export function draft(
  cfg: Config,
  program: readonly Stage[] = progU2,
  repo = 1,
  resource = 1,
  deps: ReadonlySet<number> = new Set(),
): Ticket {
  return freshTicket(cfg, deps, program, repo, {
    tag: "WExclusive",
    resource,
  });
}

/**
 * The parked ticket `model/domain.qnt`'s `escalate` produces, read back out of
 * the Decision. The `label` is the model's own label for the wall being built:
 * the measure suite asserts no label by design, and naming it is what makes a
 * fixture cite the decision it stands for.
 */
export function escalated(
  j: Ticket,
  reason: Reason,
  resumeAt: Resume,
  label: string,
): Ticket {
  return oneTicket(escalate(solo(j), 1, resumeAt, reason, label).post);
}

/** `decideRevoke` on the single-ticket Core: the whole Decision. */
export function revokeOne(j: Ticket): Decision {
  return decideRevoke(solo(j), 1);
}

/** The one ticket of a single-ticket Core. */
function oneTicket(c: Core): Ticket {
  const jb = c.tickets.get(1);
  if (jb === undefined) {
    throw new Error("fixtures: the single-ticket Core has no ticket 1");
  }
  return jb;
}

// === The revoke fixture family =============================================
// `chuggy_test`'s eight single-ticket fixtures — one per live phase and all
// THREE desk-reason flavors of the one parked phase — plus the landed ticket
// its cross-repo section hand-builds. Accounts are deliberately part-spent, so
// an equality over them is not vacuously "full grant == full grant".

/** `chuggy_test`'s `spent`. */
export function spent(j: Ticket): Ticket {
  return { ...j, gasLeft: 2, reworkLeft: 0, wrapUpLeft: 1 };
}

/**
 * A HAND-BUILT FIXTURE STATES ITS OWN `spawned`, and the model's fixtures now
 * do too (model PR #27, ledger #17). The ghost counter is bumped only by
 * `spawnOn`, and a literal task set or record never goes through it — so a
 * fixture that hands itself either one and keeps `freshTicket`'s 0 breaks
 * `idsAccounted`, which makes it a state the machine cannot reach. That is not
 * cosmetic: `decideWorkReduce` READS the counter, stamping
 * `ASome(retired.spawned)` as the artifact identity, so a short counter
 * answers a question the machine answers differently.
 *
 * Every fixture in this tree that gives itself a history therefore carries the
 * accounted count, `record.length + tasks.length`; `freshTicket`'s 0 is already
 * that count for a fixture with no history.
 */
export const jDraft: Ticket = spent(draft(cfgBudgeted));
export const jPend: Ticket = { ...jDraft, phase: "PPending" };
export const jWork: Ticket = {
  ...jDraft,
  phase: "PWorking",
  tasks: spawnTasks({ tag: "TKWork" }, firstTaskId, 2),
  spawned: 2,
};
/** One passed, one failed — a stage `CAnyPass` passes and a unanimous one fails. */
export const mixedE0: readonly Task[] = [
  et(1, 0, "TPassed"),
  et(2, 0, "TFailed"),
];
export const jEval: Ticket = {
  ...jDraft,
  phase: "PEvaluating",
  tasks: mixedE0,
  spawned: 2,
};
export const jLand: Ticket = { ...jDraft, phase: "PWrapUp" };
export const jGated: Ticket = { ...jDraft, phase: "PWrapUpHolding" };
export const jEsc: Ticket = escalated(
  jDraft,
  "RsReworkBudgetExhausted",
  "REvaluating",
  "ticket-escalated rework_budget_exhausted",
);
export const jParkPre: Ticket = escalated(
  jDraft,
  "RsRevalidationFailed",
  "RPending",
  "ticket-escalated revalidation_failed",
);
/**
 * NOT an `escalate`, and not one in the model either: the cascade parks a
 * doomed dependent inside `decideRevoke`, stamping no resume and retiring
 * nothing, which is why `chuggy_test` writes this fixture as a record literal
 * too. What `decideRevoke` actually produces for a parked dependent is pinned
 * in `domain.test.ts` (cascadeEndToEndTest), field by field.
 */
export const jParkDep: Ticket = {
  ...jDraft,
  phase: "PEscalated",
  reason: "RsDependencyRevoked",
};
/** `chuggy_test`'s cXDepDone ticket 1 — a landed ticket, hand-built there too. */
export const jDone: Ticket = {
  ...draft(cfgBudgeted),
  phase: "PDone",
  completions: 1,
};
