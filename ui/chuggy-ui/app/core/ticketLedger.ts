/**
 * A ticket's executions read as the machine's own structure: cycles, each
 * holding the work run that produced an artifact and, once it began, the
 * evaluation of it — a stage in the order the program declares, and within a
 * stage the evaluators the roster names.
 *
 * NOTHING HERE TRUSTS ARRIVAL ORDER. The route answers in `(ticket, task)`
 * ascending, so a page usually arrives in the order this reads it in — but
 * `ExecutionsResponse` is a list with no ordering in its type, and a live frame
 * is folded into a page already read. `task` is the wire's number for a
 * task, ascending within a ticket, read only to keep a stage's own rows in a
 * stable order; which cycle, stage, generation and evaluator a row belongs to
 * comes off its `identity` and is never inferred from where the row sits on
 * the page.
 *
 * AN EVALUATOR DRAWS A ROW AT EVERY GENERATION IT HAS REACHED. `resumeBlocked`
 * in `model/ticket-domain/evaluation/evaluation.qnt` re-asks only the
 * evaluators a stage blocked, bumping their generation while every evaluator
 * it did not re-ask keeps its `Produced` row; so two evaluators of one stage
 * can sit at different generations at once, and an evaluator a stage resumed
 * holds an earlier generation the ledger does not drop — it is marked
 * `Superseded` rather than merged away, because a sum over the rows a page
 * draws must equal the sum the page already charges the cycle. A stage's
 * `verdict` and `expected` still read off each evaluator's highest generation
 * only. There is one evaluation instance per work cycle — nothing here groups
 * by a "program run".
 *
 * IT IS TOTAL OVER THE PAGES THE ROSTERS ADMIT, not only over the pages the
 * machine produces or the route can page to. Ordering by `(ticket, task)` makes
 * a short page a prefix of the ticket's history, so pagination alone no longer
 * cuts a cycle in half; the shapes are inputs regardless, because the rosters
 * admit them — `executions` is a list whose type promises neither an order nor
 * a whole ticket, and an evaluation task's `stage`, `generation` and
 * `evaluator` are each an unbounded count. So a cycle whose work run is
 * missing, a gap between two stages and a stage the authored program does not
 * declare each get a row of their own rather than being merged into a
 * neighbour.
 *
 * EVERY LOOP IS BOUNDED BY SOMETHING DECLARED. A cycle draws one row per
 * stage the authoring declares and one per stage the page holds beyond it,
 * bounded by `nativeHttpDraftStagesMax` and by the page; within a stage, one
 * row per evaluator per generation the page holds for it, bounded by the
 * page. A task's `stage`, `generation` and
 * `evaluator` are each unbounded counts and are never loop bounds, because one
 * row naming a stage in the millions would otherwise build that many rows.
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
 * run cut off it, a stage row with no evaluators, a stage short of the roster
 * it was authored with — so a sum is never read as the ticket's own.
 */

import type {
  DraftResponse,
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";
import type { ExecutionTaskKind } from "../../../../src/contract/rosters.ts";
import { identityCycle, runSpanOf, runSpendOf } from "./runTotals.ts";
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

/** One evaluator's own row, at one generation: its key, the set it holds
 * there, and whether this is the generation it now stands at. */
export interface EvaluatorRow {
  readonly key: number;
  readonly generation: number;
  readonly set: TaskSet;
  readonly standing: CycleStanding;
}

export interface RanStage {
  readonly kind: "Ran";
  readonly stage: number;
  readonly evaluators: readonly EvaluatorRow[];
  readonly expected: number;
  readonly verdict: SetVerdict;
  readonly span: RunSpan;
}

/**
 * One line of a cycle's evaluation: the stage ran, or it was short-circuited,
 * or it has not started, or the page simply does not hold it.
 */
export type StageRow =
  | RanStage
  | { readonly kind: "Skipped"; readonly stage: number; readonly after: number }
  | { readonly kind: "Queued"; readonly stage: number; readonly after: number }
  | { readonly kind: "Missing"; readonly stage: number };

export interface Cycle {
  readonly ordinal: number;
  readonly work: TaskSet | undefined;
  readonly artifact: CycleArtifact;
  readonly stages: readonly StageRow[];
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

/** Whether the route holds more of this ticket than the page it answered with. */
function pageTruncated(page: ExecutionsResponse): boolean {
  return page.nextCursor !== undefined;
}

/**
 * A settled set's figures, over whichever tasks named it and against the width
 * it was expected to hold — one, always, for a work task or one evaluator.
 */
function taskSetOf(
  executions: readonly ExecutionSummary[],
  expected: number,
): TaskSet {
  return {
    executions,
    expected,
    verdict: setVerdict(executions),
    span: runSpanOf(executions),
  };
}

/**
 * An execution that answered nothing: a wall, or an evaluator whose process
 * died, which the machine treats as a stop to resume rather than a judgement.
 */
export function executionStopped(row: ExecutionSummary): boolean {
  return (
    row.outcome === "Blocked" ||
    (row.outcome === "ProcessFailed" && row.identity.type === "EvaluationTask")
  );
}

/**
 * A set settles only once no task can still move, and a stopped task is a wall
 * of its own rather than a failure the unanimous rule gets to weigh. An
 * execution read on its own is a set of one and settles like one.
 */
export function setVerdict(
  executions: readonly ExecutionSummary[],
): SetVerdict {
  if (
    executions.some(
      (row) => row.status !== "Terminal" && row.status !== "Cancelled",
    )
  )
    return "Running";
  if (executions.every((row) => row.status === "Cancelled")) return "Cancelled";
  if (executions.some(executionStopped)) return "Blocked";
  return executions.every((row) => row.outcome === "Passed")
    ? "Passed"
    : "Failed";
}

/**
 * A cycle's tasks, gathered by what they are: the work run, and every
 * evaluation row it holds, in the order the wire issued them.
 */
interface CycleBucket {
  work: ExecutionSummary[] | undefined;
  evaluations: ExecutionSummary[];
}

function cycleBucket(
  cycles: Map<number, CycleBucket>,
  cycle: number,
): CycleBucket {
  const held = cycles.get(cycle);
  if (held !== undefined) return held;
  const fresh: CycleBucket = { work: undefined, evaluations: [] };
  cycles.set(cycle, fresh);
  return fresh;
}

/**
 * The page's rows sorted into the cycle their own identity names, each
 * cycle's rows held in task order.
 */
function cycleBucketsOf(page: ExecutionsResponse): Map<number, CycleBucket> {
  const ordered = [...page.executions].sort(
    (left, right) => left.task - right.task,
  );
  const cycles = new Map<number, CycleBucket>();
  for (const row of ordered) {
    const identity = row.identity;
    const bucket = cycleBucket(cycles, identityCycle(identity));
    if (identity.type === "WorkTask") {
      bucket.work = [...(bucket.work ?? []), row];
      continue;
    }
    bucket.evaluations = [...bucket.evaluations, row];
  }
  return cycles;
}

/**
 * The width an evaluation stage was expected to hold: the authoring's own
 * evaluator count, or the page's own count where the stage is outside the
 * program the ticket was authored with.
 */
function stageExpected(
  stage: number,
  evaluators: number,
  authoring: TicketAuthoring,
): number {
  return authoring.program[stage - 1]?.evaluators.length ?? evaluators;
}

interface StageAggregate {
  readonly stage: number;
  readonly evaluators: readonly EvaluatorRow[];
  readonly expected: number;
  readonly verdict: SetVerdict;
  readonly span: RunSpan;
}

/**
 * One evaluator's rows, current generation first: an earlier generation is a
 * fact the ledger keeps rather than merges away, drawn beneath the generation
 * that replaced it.
 */
function evaluatorRowsOf(
  key: number,
  byGeneration: ReadonlyMap<number, ExecutionSummary>,
): readonly EvaluatorRow[] {
  const highest = Math.max(...byGeneration.keys());
  return [...byGeneration.entries()]
    .sort(([left], [right]) => right - left)
    .map(([generation, execution]) => ({
      key,
      generation,
      set: taskSetOf([execution], 1),
      standing: generation === highest ? "Current" : "Superseded",
    }));
}

/**
 * A cycle's evaluation rows folded into one aggregate per stage: every
 * generation an evaluator key names, held apart from the others under the
 * same key, since a resume re-asks only the evaluators a stage blocked and
 * leaves the rest at the generation that produced them. The stage's own
 * `verdict`, `expected` and `span` read off each key's highest generation
 * only — the earlier ones are rows, not inputs to the stage's own facts.
 */
function stageAggregatesOf(
  rows: readonly ExecutionSummary[],
  authoring: TicketAuthoring,
): Map<number, StageAggregate> {
  const byStage = new Map<number, Map<number, Map<number, ExecutionSummary>>>();
  for (const row of rows) {
    if (row.identity.type !== "EvaluationTask") continue;
    const { stage, generation, evaluator } = row.identity.value;
    const stageMap =
      byStage.get(stage) ?? new Map<number, Map<number, ExecutionSummary>>();
    byStage.set(stage, stageMap);
    const evaluatorMap =
      stageMap.get(evaluator) ?? new Map<number, ExecutionSummary>();
    stageMap.set(evaluator, evaluatorMap);
    evaluatorMap.set(generation, row);
  }
  const aggregates = new Map<number, StageAggregate>();
  for (const [stage, stageMap] of byStage) {
    const evaluators: EvaluatorRow[] = [...stageMap.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([key, byGeneration]) => evaluatorRowsOf(key, byGeneration));
    const current = evaluators.filter((row) => row.standing === "Current");
    const executions = current.flatMap((row) => row.set.executions);
    aggregates.set(stage, {
      stage,
      evaluators,
      expected: stageExpected(stage, current.length, authoring),
      verdict: setVerdict(executions),
      span: runSpanOf(executions),
    });
  }
  return aggregates;
}

/** An evaluator's rows at their current generation only, which is the width a
 * roster's shortfall is measured against. */
export function stageEvaluatorsCurrent(
  stage: RanStage,
): readonly EvaluatorRow[] {
  return stage.evaluators.filter((row) => row.standing === "Current");
}

/**
 * A failure or a cancellation ends the program; a block parks it instead, so
 * the stages after it stay ahead of it — queued, not skipped, because the
 * plan they belong to still exists once a resume lifts the block.
 */
function stageStopped(verdict: SetVerdict): boolean {
  return verdict === "Failed" || verdict === "Cancelled";
}

/** What a stage the authoring declares holds: an aggregate, a gap, or a reason nothing ran. */
function programStageRow(
  stage: number,
  aggregates: ReadonlyMap<number, StageAggregate>,
  highest: number,
): StageRow {
  const aggregate = aggregates.get(stage);
  if (aggregate !== undefined) return { kind: "Ran", ...aggregate };
  const last = aggregates.get(highest);
  if (stage < highest || last === undefined) return { kind: "Missing", stage };
  return stageStopped(last.verdict)
    ? { kind: "Skipped", stage, after: highest }
    : { kind: "Queued", stage, after: highest };
}

/**
 * One row per stage the authoring declares and one per stage this cycle holds
 * beyond it, so a stage outside the program is drawn without its own stage
 * number ever becoming a count of rows.
 */
function stageRowsOf(
  aggregates: ReadonlyMap<number, StageAggregate>,
  declared: number,
): readonly StageRow[] {
  if (aggregates.size === 0) return [];
  const highest = Math.max(...aggregates.keys());
  const rows: StageRow[] = [];
  for (let stage = 1; stage <= declared; stage++)
    rows.push(programStageRow(stage, aggregates, highest));
  for (const [stage, aggregate] of [...aggregates].sort(
    (left, right) => left[0] - right[0],
  ))
    if (stage > declared) rows.push({ kind: "Ran", ...aggregate });
  return rows;
}

/** The model stamps an artifact on exactly the edge a work set passes on. */
function cycleArtifactOf(work: TaskSet | undefined): CycleArtifact {
  if (work === undefined) return "Unknown";
  return work.verdict === "Passed" ? "Produced" : "None";
}

/**
 * Whether the page can have held every execution of this cycle: its work run
 * is on the page, no stage row is missing one, and no stage is short of the
 * roster it was authored with.
 */
function cycleComplete(
  work: TaskSet | undefined,
  stages: readonly StageRow[],
  truncated: boolean,
): boolean {
  if (truncated || work === undefined) return false;
  if (stages.some((row) => row.kind === "Missing")) return false;
  return stages.every(
    (row) =>
      row.kind !== "Ran" || stageEvaluatorsCurrent(row).length >= row.expected,
  );
}

function cycleFacts(
  bucket: CycleBucket,
  authoring: TicketAuthoring,
  standing: CycleStanding,
  page: ExecutionsResponse,
): Omit<Cycle, "ordinal"> {
  const work =
    bucket.work === undefined ? undefined : taskSetOf(bucket.work, 1);
  const stages = stageRowsOf(
    stageAggregatesOf(bucket.evaluations, authoring),
    authoring.program.length,
  );
  const held = [...(bucket.work ?? []), ...bucket.evaluations];
  return {
    work,
    artifact: cycleArtifactOf(work),
    stages,
    standing,
    span: runSpanOf(held),
    spend: runSpendOf(held),
    complete: cycleComplete(work, stages, pageTruncated(page)),
  };
}

/**
 * The page's executions as the cycles that produced them, newest last. A page
 * cursor names more is truncated, and the counts drawn from it are low
 * rather than wrong.
 */
export function ticketLedger(
  page: ExecutionsResponse,
  authoring: TicketAuthoring,
): Ledger {
  const buckets = [...cycleBucketsOf(page).entries()].sort(
    ([left], [right]) => left - right,
  );
  const truncated = pageTruncated(page);
  const cycles: readonly Cycle[] = buckets.map(([cycle, bucket], index) => ({
    ordinal: cycle,
    ...cycleFacts(
      bucket,
      authoring,
      index === buckets.length - 1 ? "Current" : "Superseded",
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

/** The last stage this cycle holds, which is the one the machine priced its exit from. */
export function cycleLastSet(cycle: Cycle): ClosedSet | undefined {
  const ran = cycle.stages.filter((row): row is RanStage => row.kind === "Ran");
  const last = ran.at(-1);
  if (last !== undefined)
    return {
      taskKind: "Evaluation",
      stage: last.stage,
      verdict: last.verdict,
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

/**
 * Stages are numbered from one, as the form a ticket is authored on numbers
 * them — the identity's own stage, with nothing added to it.
 */
export function stageLabel(stage: number, stageCount: number): string {
  const named = String(stage);
  return stageCount >= stage
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
