/**
 * A ticket's executions read as the machine's own structure: cycles, each
 * holding the work run that produced an artifact and the program runs that
 * evaluated it.
 *
 * NOTHING HERE TRUSTS ARRIVAL ORDER. The ticket-scoped route orders by
 * execution identity and an identity is a UUID with the task ordinal suffixed
 * onto it, so the page arrives in an order unrelated to time; `task` is the
 * ticket-wide ordinal the model issues in sequence, and sorting by it is what
 * makes a cycle recoverable at all.
 *
 * A FAN-OUT SET IS WHAT ONE SPAWN PRODUCED, and it is named by the request the
 * row carries or by the identity stem every task of one request shares. A row
 * the wire wrote before it named the request has only the stem, so the stem is
 * what answers for one and is never the rule where a request is there to read.
 *
 * IT READS THE WIRE'S CURSOR UNDER EITHER OF ITS NAMES. The field that says the
 * route has more of this ticket is being renamed, and this module has to
 * compile against the contract before and after: `ExecutionsPage` is what both
 * shapes satisfy and `pageTruncated` is the only thing that looks, so the
 * rename reaches one function rather than the file. Both names go when the
 * older one does.
 *
 * IT IS TOTAL OVER THE PAGES THE ROSTERS ADMIT, not only over the pages the
 * machine produces. Identity order means a short page is cut at no point in
 * particular, so a cycle whose work run is missing, a gap between two stages
 * and a stage the authored program does not declare are all inputs, and each
 * has a row of its own rather than being merged into a neighbour.
 *
 * EVERY LOOP IS BOUNDED BY SOMETHING DECLARED. A run draws one row per stage
 * the authoring declares and one per set the page holds beyond it, which are
 * bounded by `nativeHttpDraftStagesMax` and by the page; the wire's `stage` is
 * an unbounded count and is never a loop bound, because one row naming a stage
 * in the millions would otherwise build that many rows.
 *
 * WHAT IT EMITS IS FACTS, and the three labels at the end are the only strings
 * in it: each names a row the ledger numbered, and every word a reader is given
 * about what those facts mean belongs to whatever draws them. Time and money
 * are facts like any other, so a set and a cycle each carry the span they ran
 * over and a cycle and the page each carry what the executions under them
 * spent, unrounded, unformatted and in the units the wire sends.
 *
 * A ROLLUP SAYS HOW MUCH OF ITSELF IT COULD SEE. `complete` is false wherever
 * the page cannot have held every execution of a cycle — a short page, a work
 * run cut off it, a stage row with no set, a fan-out holding fewer tasks than
 * its stage was authored with — so a sum is never read as the ticket's own.
 */

import type {
  DraftResponse,
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";
import type {
  EvaluationCombinator,
  ExecutionTaskKind,
} from "../../../../src/contract/rosters.ts";
import { runSpanOf, runSpendOf } from "./runTotals.ts";
import type { RunSpan, RunSpend } from "./runTotals.ts";

/** The authoring the ledger reads, which is the draft read's own record. */
export type TicketAuthoring = DraftResponse["authoring"];

/** How a fan-out set settled, once every task in it is accounted for. */
export type SetVerdict =
  "Passed" | "Failed" | "Running" | "Cancelled" | "Blocked";

/** Whether the ticket's current artifact is this cycle's, or a later one's. */
export type CycleStanding = "Current" | "Superseded";

/** What the cycle's work run left behind, `Unknown` where the page holds no run. */
export type CycleArtifact = "Produced" | "None" | "Unknown";

export interface TaskSet {
  readonly executions: readonly ExecutionSummary[];
  readonly expected: number;
  readonly verdict: SetVerdict;
  readonly span: RunSpan;
}

export interface RanStage {
  readonly kind: "Ran";
  readonly stage: number;
  readonly set: TaskSet;
}

/**
 * One line of a program run: the stage ran, or it was short-circuited, or it
 * has not started, or the page simply does not hold it.
 */
export type StageRow =
  | RanStage
  | { readonly kind: "Skipped"; readonly stage: number; readonly after: number }
  | { readonly kind: "Queued"; readonly stage: number; readonly after: number }
  | { readonly kind: "Missing"; readonly stage: number };

export interface ProgramRun {
  readonly ordinal: number;
  readonly stages: readonly StageRow[];
  readonly standing: CycleStanding;
}

export interface Cycle {
  readonly ordinal: number;
  readonly work: TaskSet | undefined;
  readonly artifact: CycleArtifact;
  readonly programRuns: readonly ProgramRun[];
  readonly standing: CycleStanding;
  readonly span: RunSpan;
  readonly spend: RunSpend;
  readonly complete: boolean;
}

export interface Ledger {
  readonly cycles: readonly Cycle[];
  readonly truncated: boolean;
  readonly span: RunSpan;
  readonly spend: RunSpend;
  readonly complete: boolean;
}

/** A settled set named by what it was for, which is all a wall reader needs of it. */
export interface ClosedSet {
  readonly taskKind: ExecutionTaskKind;
  readonly stage: number | undefined;
  readonly verdict: SetVerdict;
}

interface SpawnedSet {
  readonly taskKind: ExecutionTaskKind;
  readonly stage: number | undefined;
  readonly executions: readonly ExecutionSummary[];
}

interface CycleSets {
  readonly work: SpawnedSet | undefined;
  readonly evaluations: readonly SpawnedSet[];
}

/**
 * A summary whether or not the wire names the request its set was spawned
 * under, which both contracts this module compiles against satisfy.
 */
type SpawnedExecution = ExecutionSummary & {
  readonly request?: string | undefined;
};

/**
 * A page under either name its cursor has had. Nothing outside `pageTruncated`
 * reads one, so the wire's rename lands in one function.
 */
export type ExecutionsPage = {
  readonly executions: ExecutionsResponse["executions"];
  readonly nextAfter?: string | undefined;
  readonly nextCursor?: string | undefined;
};

/** Whether the route holds more of this ticket than the page it answered with. */
function pageTruncated(page: ExecutionsResponse): boolean {
  const held: ExecutionsPage = page;
  return (held.nextAfter ?? held.nextCursor) !== undefined;
}

const executionTaskSuffix = /-\d+$/;

/** The scheduler suffixes the task ordinal onto one stem per spawned request. */
function executionStem(execution: string): string {
  return execution.replace(executionTaskSuffix, "");
}

/**
 * Which spawn this execution belongs to, by the request identity where a row
 * carries one and by the identity stem otherwise. No parsed read carries one
 * yet, so the stem is what answers today.
 */
function executionRequest(row: SpawnedExecution): string {
  return row.request ?? executionStem(row.execution);
}

function executionSetKey(row: SpawnedExecution): string {
  return `${executionRequest(row)} ${row.taskKind} ${String(row.stage)}`;
}

/** The page in task order, cut at every change of spawn, kind or stage. */
function spawnedSets(page: ExecutionsResponse): readonly SpawnedSet[] {
  const ordered: readonly SpawnedExecution[] = [...page.executions].sort(
    (left, right) => left.task - right.task,
  );
  const sets: SpawnedSet[] = [];
  let key: string | undefined;
  for (const row of ordered) {
    const open = sets.at(-1);
    if (open !== undefined && executionSetKey(row) === key) {
      sets[sets.length - 1] = {
        ...open,
        executions: [...open.executions, row],
      };
      continue;
    }
    sets.push({
      taskKind: row.taskKind,
      stage: row.stage,
      executions: [row],
    });
    key = executionSetKey(row);
  }
  return sets;
}

/**
 * A set settles only once no task can still move, and a blocked task is a wall
 * of its own rather than a failure the combinator gets to weigh.
 */
function setVerdict(
  executions: readonly ExecutionSummary[],
  combinator: EvaluationCombinator,
): SetVerdict {
  if (
    executions.some(
      (row) => row.status !== "Terminal" && row.status !== "Cancelled",
    )
  )
    return "Running";
  if (executions.every((row) => row.status === "Cancelled")) return "Cancelled";
  if (executions.some((row) => row.outcome === "Blocked")) return "Blocked";
  switch (combinator) {
    case "UnanimousPass":
      return executions.every((row) => row.outcome === "Passed")
        ? "Passed"
        : "Failed";
    case "AnyPass":
      return executions.some((row) => row.outcome === "Passed")
        ? "Passed"
        : "Failed";
  }
}

/** The authored stage this set ran, absent where the set is outside the program. */
function stageOf(
  set: SpawnedSet,
  authoring: TicketAuthoring,
): TicketAuthoring["program"][number] | undefined {
  if (set.taskKind === "Work" || set.stage === undefined) return undefined;
  return authoring.program[set.stage];
}

/**
 * A work set combines as the model's work reduce does, and an evaluation set
 * as its stage's authored combinator says.
 */
function taskSetOf(set: SpawnedSet, authoring: TicketAuthoring): TaskSet {
  const stage = stageOf(set, authoring);
  const combinator: EvaluationCombinator =
    set.taskKind === "Work"
      ? "UnanimousPass"
      : (stage?.combinator ?? "UnanimousPass");
  const expected =
    set.taskKind === "Work"
      ? authoring.workFanout
      : (stage?.fanout ?? set.executions.length);
  return {
    executions: set.executions,
    expected,
    verdict: setVerdict(set.executions, combinator),
    span: runSpanOf(set.executions),
  };
}

/** Every work set opens a cycle; a page that opens on an evaluation opens one without a work run. */
function cycleSetsOf(sets: readonly SpawnedSet[]): readonly CycleSets[] {
  const cycles: CycleSets[] = [];
  for (const set of sets) {
    if (set.taskKind === "Work") {
      cycles.push({ work: set, evaluations: [] });
      continue;
    }
    const open = cycles.at(-1);
    if (open === undefined) {
      cycles.push({ work: undefined, evaluations: [set] });
      continue;
    }
    cycles[cycles.length - 1] = {
      ...open,
      evaluations: [...open.evaluations, set],
    };
  }
  return cycles;
}

/**
 * Stages are recomputed per cycle and never resumed mid-sequence, so a stage
 * that does not advance on its predecessor is a fresh run of the program.
 */
function runSetsOf(
  evaluations: readonly SpawnedSet[],
): readonly (readonly SpawnedSet[])[] {
  const runs: SpawnedSet[][] = [];
  for (const set of evaluations) {
    const open = runs.at(-1);
    const previous = open?.at(-1);
    if (open === undefined || previous === undefined) {
      runs.push([set]);
      continue;
    }
    if ((set.stage ?? 0) <= (previous.stage ?? 0)) runs.push([set]);
    else open.push(set);
  }
  return runs;
}

/** A short-circuit stops the run; anything else leaves the later stages ahead of it. */
function stageStopped(verdict: SetVerdict): boolean {
  return (
    verdict === "Failed" || verdict === "Cancelled" || verdict === "Blocked"
  );
}

/** What a stage the authoring declares holds: a set, a gap, or a reason nothing ran. */
function programStageRow(
  stage: number,
  ran: ReadonlyMap<number, TaskSet>,
  highest: number,
): StageRow {
  const set = ran.get(stage);
  if (set !== undefined) return { kind: "Ran", stage, set };
  const last = ran.get(highest);
  if (stage < highest || last === undefined) return { kind: "Missing", stage };
  return stageStopped(last.verdict)
    ? { kind: "Skipped", stage, after: highest }
    : { kind: "Queued", stage, after: highest };
}

/**
 * One row per stage the authoring declares and one per set this run holds
 * beyond it, so a stage outside the program is drawn without the wire's own
 * stage number ever becoming a count of rows.
 */
function stageRowsOf(
  run: readonly SpawnedSet[],
  authoring: TicketAuthoring,
): readonly StageRow[] {
  const ran = new Map<number, TaskSet>();
  for (const set of run) ran.set(set.stage ?? 0, taskSetOf(set, authoring));
  const highest = Math.max(...ran.keys());
  const declared = authoring.program.length;
  const rows: StageRow[] = [];
  for (let stage = 0; stage < declared; stage++)
    rows.push(programStageRow(stage, ran, highest));
  for (const [stage, set] of [...ran].sort((left, right) => left[0] - right[0]))
    if (stage >= declared) rows.push({ kind: "Ran", stage, set });
  return rows;
}

function programRunsOf(
  cycle: CycleSets,
  authoring: TicketAuthoring,
): readonly ProgramRun[] {
  const runs = runSetsOf(cycle.evaluations);
  return runs.map((run, index) => ({
    ordinal: index + 1,
    stages: stageRowsOf(run, authoring),
    standing: index === runs.length - 1 ? "Current" : "Superseded",
  }));
}

/** The model stamps an artifact on exactly the edge a work set passes on. */
function cycleArtifactOf(work: TaskSet | undefined): CycleArtifact {
  if (work === undefined) return "Unknown";
  return work.verdict === "Passed" ? "Produced" : "None";
}

/** Every set a cycle holds, which is its work run and each stage that ran. */
function cycleSetsHeld(
  work: TaskSet | undefined,
  runs: readonly ProgramRun[],
): readonly TaskSet[] {
  const ran = runs.flatMap((run) =>
    run.stages.flatMap((row) => (row.kind === "Ran" ? [row.set] : [])),
  );
  return work === undefined ? ran : [work, ...ran];
}

/**
 * Whether the page can have held every execution of this cycle: its work run
 * is on the page, no stage row is missing one, and no set is short of the
 * fan-out its stage was authored with.
 */
function cycleComplete(
  work: TaskSet | undefined,
  runs: readonly ProgramRun[],
  truncated: boolean,
): boolean {
  if (truncated || work === undefined) return false;
  if (runs.some((run) => run.stages.some((row) => row.kind === "Missing")))
    return false;
  return cycleSetsHeld(work, runs).every(
    (set) => set.executions.length >= set.expected,
  );
}

function cycleOf(
  cycle: CycleSets,
  authoring: TicketAuthoring,
  standing: CycleStanding,
  page: ExecutionsResponse,
): Omit<Cycle, "ordinal"> {
  const work =
    cycle.work === undefined ? undefined : taskSetOf(cycle.work, authoring);
  const programRuns = programRunsOf(cycle, authoring);
  const held = cycleSetsHeld(work, programRuns).flatMap(
    (set) => set.executions,
  );
  return {
    work,
    artifact: cycleArtifactOf(work),
    programRuns,
    standing,
    span: runSpanOf(held),
    spend: runSpendOf(held),
    complete: cycleComplete(work, programRuns, pageTruncated(page)),
  };
}

/**
 * The page's executions as the cycles that produced them, newest last. A page
 * cursor names more of is truncated, and the counts drawn from it are low
 * rather than wrong.
 */
export function ticketLedger(
  page: ExecutionsResponse,
  authoring: TicketAuthoring,
): Ledger {
  const grouped = cycleSetsOf(spawnedSets(page));
  const truncated = pageTruncated(page);
  const cycles: readonly Cycle[] = grouped.map((cycle, index) => ({
    ordinal: index + 1,
    ...cycleOf(
      cycle,
      authoring,
      index === grouped.length - 1 ? "Current" : "Superseded",
      page,
    ),
  }));
  return {
    cycles,
    truncated,
    span: runSpanOf(page.executions),
    spend: runSpendOf(page.executions),
    complete: !truncated && cycles.every((cycle) => cycle.complete),
  };
}

/** The last set this cycle holds, which is the one the machine priced its exit from. */
export function cycleLastSet(cycle: Cycle): ClosedSet | undefined {
  const run = cycle.programRuns.at(-1);
  const ran = (run?.stages ?? []).filter(
    (row): row is RanStage => row.kind === "Ran",
  );
  const last = ran.at(-1);
  if (last !== undefined)
    return {
      taskKind: "Evaluation",
      stage: last.stage,
      verdict: last.set.verdict,
    };
  if (cycle.work === undefined) return undefined;
  return {
    taskKind: "Work",
    stage: undefined,
    verdict: cycle.work.verdict,
  };
}

/** What the ticket last had running, which is what a wall interrupted. */
export function ledgerLastSet(ledger: Ledger): ClosedSet | undefined {
  const cycle = ledger.cycles.at(-1);
  return cycle === undefined ? undefined : cycleLastSet(cycle);
}

/** Stages are numbered from one in a label, as the form a ticket is authored on numbers them. */
export function stageLabel(stage: number, stageCount: number): string {
  const named = String(stage + 1);
  return stageCount > stage
    ? `Stage ${named} of ${String(stageCount)}`
    : `Stage ${named}`;
}

export function cycleLabel(ordinal: number): string {
  return `Cycle ${String(ordinal)}`;
}

/** The fabric's own relaunches of a container, which are below the cycle and are not rework. */
export function retriesLabel(retriesSpent: number): string | undefined {
  return retriesSpent < 1
    ? undefined
    : `Relaunched ${String(retriesSpent)}× by fabric`;
}
