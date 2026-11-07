/**
 * The Overview's steps block: the current cycle as the three phases every
 * ticket passes through — Work, Evaluation and Finalization — each a column
 * of boxes, the evaluation one box per stage of the plan in the plan's order.
 *
 * IT READS THE LEDGER AND THE PLAN. Which run a box stands for is
 * `ticketLedger.ts`'s, and what a box that has not run will run is
 * `ticketPlan.ts`'s; what this adds is which of those a box draws, its mark,
 * and the tone each column's edge takes once it has run.
 *
 * A BOX THAT HAS NOT RUN SAYS WHAT WILL RUN, until the cycle can no longer
 * reach it: then it was not reached.
 */

import type { RunTimed } from "./runTotals.ts";
import {
  cycleLabel,
  cycleLastSet,
  stageEvaluatorsCurrent,
  stageLabel,
} from "./ticketLedger.ts";
import type {
  Cycle,
  EvaluatorRow,
  Ledger,
  RanStage,
  SetVerdict,
  StageRow,
  TaskSet,
} from "./ticketLedger.ts";
import {
  ticketLandingFragment,
  ticketLandingPullLabel,
} from "./ticketLandings.ts";
import type { TicketLanding } from "./ticketLandings.ts";
import type { TicketPlan, TicketPlanStage } from "./ticketPlan.ts";
import {
  ticketRunLandingMarked,
  ticketRunLive,
  ticketRunMarkOf,
  ticketRunsCycleOutcome,
} from "./ticketRuns.ts";
import type { TicketRunMark } from "./ticketRuns.ts";
import { verdictTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

/** What a box says under its name: the runs whose times and waits it sums,
 * or a few words. */
export type TicketStepLine =
  | {
      readonly line: "Ran";
      readonly runs: readonly RunTimed[];
      readonly live: boolean;
    }
  | { readonly line: "Words"; readonly words: string };

/** Where a box leads: its run's page, the landing's, or nowhere. */
export type TicketStepAddress =
  | { readonly to: "Run"; readonly task: number }
  | { readonly to: "Landing" }
  | undefined;

/** One evaluator of a stage that runs several side by side. */
export interface TicketStepEvaluator {
  readonly name: string;
  readonly mark: TicketRunMark;
  readonly tone: Tone;
  readonly line: TicketStepLine | undefined;
  readonly address: TicketStepAddress;
}

export interface TicketStepBox {
  readonly name: string;
  /** None for a landing a ticket that lands nothing never has. */
  readonly mark: TicketRunMark | undefined;
  readonly tone: Tone;
  readonly line: TicketStepLine;
  readonly address: TicketStepAddress;
  /** A stage's evaluators, where it runs more than one. */
  readonly evaluators: readonly TicketStepEvaluator[];
}

export type TicketStepPhase = "Work" | "Evaluation" | "Finalization";

export interface TicketStepColumn {
  readonly phase: TicketStepPhase;
  /** The tone of the column's top edge, none until it has run. */
  readonly edge: Tone | undefined;
  readonly boxes: readonly TicketStepBox[];
}

export interface TicketSteps {
  /** The current cycle, none before the first run. */
  readonly cycle: number | undefined;
  /** What the cycle before it came to, as one line. */
  readonly previous: string | undefined;
  readonly columns: readonly TicketStepColumn[];
}

export interface TicketStepsReads {
  readonly ledger: Ledger | undefined;
  readonly plan: TicketPlan;
  /** Each cycle's landings, in the read's order. */
  readonly landings: ReadonlyMap<number, readonly TicketLanding[]>;
  /** Whether the ticket has stopped where it is: parked, done or revoked. */
  readonly settled: boolean;
  /** The clock a held or waiting landing's age is read against. */
  readonly nowMs: number;
}

const ticketStepsNotReached = "Not reached";
const ticketStepsNotStarted = "Not started";

function ticketStepsWords(words: string): TicketStepLine {
  return { line: "Words", words };
}

/** What a box that has not run says: what will run, or that it was not reached. */
function ticketStepsAhead(
  runs: string | undefined,
  stopped: boolean,
): TicketStepLine {
  if (stopped) return ticketStepsWords(ticketStepsNotReached);
  return ticketStepsWords(runs ?? ticketStepsNotStarted);
}

function ticketStepsWaiting(
  name: string,
  runs: string | undefined,
  stopped: boolean,
): TicketStepBox {
  return {
    name,
    mark: "Open",
    tone: "retired",
    line: ticketStepsAhead(runs, stopped),
    address: undefined,
    evaluators: [],
  };
}

/** What a box or an evaluator that ran draws. */
interface TicketStepRan {
  readonly name: string;
  readonly mark: TicketRunMark;
  readonly tone: Tone;
  readonly line: TicketStepLine;
  readonly address: TicketStepAddress;
}

/** A run's box: its mark, how long it ran, and its page. */
function ticketStepsRan(name: string, set: TaskSet): TicketStepRan {
  const last = [...set.executions]
    .sort((left, right) => left.task - right.task)
    .at(-1);
  return {
    name,
    mark: ticketRunMarkOf(set.verdict),
    tone: verdictTone(set.verdict),
    line: {
      line: "Ran",
      runs: set.executions,
      live: ticketRunLive(set.verdict),
    },
    address: last === undefined ? undefined : { to: "Run", task: last.task },
  };
}

function ticketStepsEvaluator(
  evaluator: TicketPlanStage["evaluators"][number],
  ran: EvaluatorRow | undefined,
  stopped: boolean,
): TicketStepEvaluator {
  if (ran === undefined)
    return {
      name: evaluator.name,
      mark: "Open",
      tone: "retired",
      line: stopped ? ticketStepsWords(ticketStepsNotReached) : undefined,
      address: undefined,
    };
  return ticketStepsRan(evaluator.name, ran.set);
}

/** A stage that ran: one box, its evaluators listed inside it where it runs
 * several, each with its own mark and page. */
function ticketStepsStageRan(
  stage: TicketPlanStage,
  row: RanStage,
  stopped: boolean,
): TicketStepBox {
  const current = stageEvaluatorsCurrent(row);
  const keys = [
    ...stage.evaluators,
    ...current
      .filter((ran) => !stage.evaluators.some((each) => each.key === ran.key))
      .map((ran) => ({
        key: ran.key,
        name: `Evaluator ${String(ran.key)}`,
        runs: undefined,
      })),
  ];
  const one = keys.length <= 1 ? current[0] : undefined;
  if (one !== undefined)
    return { ...ticketStepsRan(stage.name, one.set), evaluators: [] };
  return {
    name: stage.name,
    mark: ticketRunMarkOf(row.verdict),
    tone: verdictTone(row.verdict),
    line: ticketStepsWords(`${String(keys.length)} side by side`),
    address: undefined,
    evaluators: keys.map((evaluator) =>
      ticketStepsEvaluator(
        evaluator,
        current.find((ran) => ran.key === evaluator.key),
        stopped,
      ),
    ),
  };
}

/** A stage before it has run: what it will run, its evaluators listed where
 * it runs several. */
function ticketStepsStageAhead(
  stage: TicketPlanStage,
  stopped: boolean,
): TicketStepBox {
  const only = stage.evaluators.length === 1 ? stage.evaluators[0] : undefined;
  if (stage.evaluators.length <= 1)
    return ticketStepsWaiting(stage.name, only?.runs, stopped);
  return {
    ...ticketStepsWaiting(stage.name, undefined, false),
    line: stopped
      ? ticketStepsWords(ticketStepsNotReached)
      : ticketStepsWords(`${String(stage.evaluators.length)} side by side`),
    evaluators: stage.evaluators.map((evaluator) =>
      ticketStepsEvaluator(evaluator, undefined, false),
    ),
  };
}

function ticketStepsStage(
  stage: TicketPlanStage,
  row: StageRow | undefined,
  stopped: boolean,
): TicketStepBox {
  switch (row?.kind) {
    case "Ran":
      return ticketStepsStageRan(stage, row, stopped);
    case "Skipped":
      return ticketStepsStageAhead(stage, true);
    case "Missing":
      return {
        ...ticketStepsWaiting(stage.name, undefined, false),
        line: ticketStepsWords("Not on this page"),
      };
    case "Queued":
    case undefined:
      return ticketStepsStageAhead(stage, stopped);
  }
}

/** The plan's stages, and any the cycle ran beyond them, named by number. */
function ticketStepsStages(
  plan: TicketPlan,
  cycle: Cycle | undefined,
): readonly TicketPlanStage[] {
  const beyond = (cycle?.stages ?? [])
    .filter((row) => row.stage > plan.stages.length)
    .map((row) => ({
      stage: row.stage,
      name: stageLabel(row.stage, plan.names),
      evaluators: [],
    }));
  return [...plan.stages, ...beyond];
}

/** What a landing's box says: its pull request once it merged or was
 * proposed, why it failed where it did, what holds it while it waits, and its
 * state otherwise. */
function ticketStepsLandingWords(
  landing: TicketLanding,
  nowMs: number,
): string {
  switch (landing.state) {
    case "Failed":
      return landing.failure ?? landing.word;
    case "Landed":
    case "Proposed":
      return landing.link === undefined
        ? landing.word
        : ticketLandingPullLabel(landing.link);
    case "Held":
    case "AwaitingMerge":
    case "Unavailable":
      return ticketLandingFragment(landing, nowMs).text ?? landing.word;
    case "Running":
    case "AwaitingApproval":
    case "Invalidated":
      return landing.word;
  }
}

function ticketStepsLanding(
  plan: TicketPlan,
  landing: TicketLanding | undefined,
  stopped: boolean,
  nowMs: number,
): TicketStepBox {
  if (!plan.lands)
    return {
      name: "Landing",
      mark: undefined,
      tone: "retired",
      line: ticketStepsWords("None"),
      address: undefined,
      evaluators: [],
    };
  if (landing === undefined)
    return ticketStepsWaiting("Landing", plan.landing, stopped);
  return {
    name: "Landing",
    ...ticketRunLandingMarked(landing),
    line: ticketStepsWords(ticketStepsLandingWords(landing, nowMs)),
    address: { to: "Landing" },
    evaluators: [],
  };
}

/** Whether a set settled on something other than a pass. */
function ticketStepsFailed(verdict: SetVerdict): boolean {
  return (
    verdict === "Failed" || verdict === "Blocked" || verdict === "Cancelled"
  );
}

/** Whether the cycle can no longer reach a step it has not run. */
function ticketStepsStopped(
  cycle: Cycle | undefined,
  settled: boolean,
): boolean {
  if (cycle === undefined) return false;
  const last = cycleLastSet(cycle);
  return settled || (last !== undefined && ticketStepsFailed(last.verdict));
}

function ticketStepsEdges(
  cycle: Cycle | undefined,
  landing: TicketLanding | undefined,
): Readonly<Record<TicketStepPhase, Tone | undefined>> {
  const ran = (cycle?.stages ?? []).filter(
    (row): row is RanStage => row.kind === "Ran",
  );
  const work = cycle?.work;
  return {
    Work:
      work === undefined
        ? undefined
        : ticketStepsFailed(work.verdict)
          ? "parked"
          : "live",
    Evaluation:
      ran.length === 0
        ? undefined
        : ran.some((row) => ticketStepsFailed(row.verdict))
          ? "parked"
          : "evaluation",
    Finalization:
      landing === undefined
        ? undefined
        : ticketRunLandingMarked(landing).tone === "finalization"
          ? "finalization"
          : "parked",
  };
}

/** What the cycle before the current one came to, as its heading's aside. */
function ticketStepsPrevious(reads: TicketStepsReads): string | undefined {
  const previous = reads.ledger?.cycles.at(-2);
  if (previous === undefined) return undefined;
  const outcome = ticketRunsCycleOutcome(
    previous,
    reads.plan.names,
    reads.landings.get(previous.ordinal)?.at(-1),
  );
  return `${cycleLabel(previous.ordinal)} ${outcome.charAt(0).toLowerCase()}${outcome.slice(1)}`;
}

export function ticketStepsOf(reads: TicketStepsReads): TicketSteps {
  const { plan } = reads;
  const cycle = reads.ledger?.cycles.at(-1);
  const landing =
    cycle === undefined ? undefined : reads.landings.get(cycle.ordinal)?.at(-1);
  const stopped = ticketStepsStopped(cycle, reads.settled);
  const edges = ticketStepsEdges(cycle, landing);
  const work =
    cycle?.work === undefined
      ? ticketStepsWaiting("Work", plan.work, stopped)
      : { ...ticketStepsRan("Work", cycle.work), evaluators: [] };
  return {
    cycle: cycle?.ordinal,
    previous: ticketStepsPrevious(reads),
    columns: [
      { phase: "Work", edge: edges.Work, boxes: [work] },
      {
        phase: "Evaluation",
        edge: edges.Evaluation,
        boxes: ticketStepsStages(plan, cycle).map((stage) =>
          ticketStepsStage(
            stage,
            cycle?.stages.find((row) => row.stage === stage.stage),
            stopped,
          ),
        ),
      },
      {
        phase: "Finalization",
        edge: edges.Finalization,
        boxes: [ticketStepsLanding(plan, landing, stopped, reads.nowMs)],
      },
    ],
  };
}
