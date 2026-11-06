/**
 * A ticket's runs as its Runs tab, its run pages and its landing page draw
 * them: cycles newest first, each a list of steps named as the plan names
 * them, every run a page of its own at its task's number.
 *
 * IT READS THE LEDGER, NEVER THE PAGE AGAIN. Which cycle, stage and evaluator
 * a run belongs to is `ticketLedger.ts`'s, and every sum is `runTotals.ts`'s;
 * what this adds is the name of each step, the few words a cycle ended on and
 * the address of each run.
 *
 * A RUN'S TIME IS ITS SPAN, from its first attempt's opening to its end, so a
 * run whose worker measured nothing — a command list — still reads the time it
 * took.
 *
 * A STAGE IS NAMED BY THE PLAN its catalog selects, and by its number where the
 * configuration is no catalog or is not read yet.
 *
 * A TICKET THAT LANDS NOTHING HAS NO LANDING TO REACH, so its Landing row says
 * so rather than waiting on one.
 */

import type {
  ExecutionResponse,
  ExecutionSummary,
} from "../../../../src/contract/responses.ts";
import { durationFigure, tokenCountText } from "./figures.ts";
import type { Figure } from "./figures.ts";
import { digestShortened } from "./labels.ts";
import type { Label } from "./labels.ts";
import { runSpanRanOf } from "./runTotals.ts";
import type { RunSpan, RunSpend } from "./runTotals.ts";
import { ticketLandingSummary } from "./ticketLandings.ts";
import type { TicketLanding, TicketLandingsJoined } from "./ticketLandings.ts";
import { cycleLastSet, setVerdict, stageLabel } from "./ticketLedger.ts";
import type {
  Cycle,
  CycleStanding,
  EvaluatorRow,
  Ledger,
  SetVerdict,
  StageNames,
  StageRow,
} from "./ticketLedger.ts";
import type { Tone } from "./tones.ts";

/** One run: its task's number, which is its address, and how it stands. */
export interface TicketRunStep {
  readonly kind: "Run";
  readonly task: number;
  readonly name: string;
  readonly cycle: number;
  readonly verdict: SetVerdict;
  readonly span: RunSpan;
  readonly execution: ExecutionSummary;
  /** A generation an evaluator's resume replaced. */
  readonly superseded: boolean;
}

/** A stage of the plan with no run to show: not reached, or not on this page. */
export interface TicketRunGap {
  readonly kind: "Gap";
  readonly name: string;
  readonly words: string;
}

/** The cycle's landing, or that it has none yet; `lands` is false for a
 * ticket whose finalization lands nothing, which never has one. */
export interface TicketRunLanding {
  readonly kind: "Landing";
  readonly landing: TicketLanding | undefined;
  readonly lands: boolean;
}

export type TicketRunsRow = TicketRunStep | TicketRunGap | TicketRunLanding;

export interface TicketRunsCycle {
  readonly ordinal: number;
  readonly standing: CycleStanding;
  /** What the cycle came to, in a few words. */
  readonly outcome: string;
  readonly span: RunSpan;
  readonly spend: RunSpend;
  readonly rows: readonly TicketRunsRow[];
}

/** What the runs are read against: the names the plan gives its stages, and
 * whether the ticket's finalization lands anything. */
export interface TicketRunsPlan {
  readonly names: StageNames;
  readonly lands: boolean;
}

function ticketRunsStep(
  execution: ExecutionSummary,
  name: string,
  superseded: boolean,
): TicketRunStep {
  return {
    kind: "Run",
    task: execution.task,
    name,
    cycle:
      execution.identity.type === "WorkTask"
        ? execution.identity.value.cycle
        : execution.identity.value.workCycle,
    verdict: setVerdict([execution]),
    span: runSpanRanOf([execution]),
    execution,
    superseded,
  };
}

function ticketRunsEvaluatorSteps(
  name: string,
  evaluators: readonly EvaluatorRow[],
): readonly TicketRunStep[] {
  const many =
    evaluators.filter((row) => row.standing === "Current").length > 1;
  return evaluators.flatMap((row) =>
    row.set.executions.map((execution) =>
      ticketRunsStep(
        execution,
        many ? `${name} · ${String(row.key)}` : name,
        row.standing === "Superseded",
      ),
    ),
  );
}

function ticketRunsStageRows(
  row: StageRow,
  names: StageNames,
): readonly TicketRunsRow[] {
  const name = stageLabel(row.stage, names);
  switch (row.kind) {
    case "Ran":
      return ticketRunsEvaluatorSteps(name, row.evaluators);
    case "Skipped":
    case "Queued":
      return [{ kind: "Gap", name, words: "Not reached" }];
    case "Missing":
      return [{ kind: "Gap", name, words: "Not on this page" }];
  }
}

/** The step a cycle stopped at: its stage as the plan names it, or work. */
function ticketRunsCycleStep(cycle: Cycle, names: StageNames): string {
  const last = cycleLastSet(cycle);
  return last?.stage === undefined ? "work" : stageLabel(last.stage, names);
}

/** What a cycle came to: where it stopped, who sent it back, or its landing. */
export function ticketRunsCycleOutcome(
  cycle: Cycle,
  names: StageNames,
  landing: TicketLanding | undefined,
): string {
  const last = cycleLastSet(cycle);
  if (last === undefined) return "Work not on this page";
  const step = ticketRunsCycleStep(cycle, names);
  switch (last.verdict) {
    case "Starting":
    case "Running":
      return `${last.verdict} ${step}`;
    case "Failed":
      return cycle.standing === "Superseded" && last.stage !== undefined
        ? `Sent back by ${step}`
        : `Failed at ${step}`;
    case "Blocked":
      return `Blocked at ${step}`;
    case "Cancelled":
      return "Cancelled";
    case "Passed":
      return landing === undefined ? "Passed" : ticketLandingSummary(landing);
  }
}

function ticketRunsCycleOf(
  cycle: Cycle,
  plan: TicketRunsPlan,
  landings: TicketLandingsJoined,
): TicketRunsCycle {
  const landing = landings.byCycle.get(cycle.ordinal)?.at(-1);
  const work = (cycle.work?.executions ?? []).map((execution) =>
    ticketRunsStep(execution, "Work", false),
  );
  const stages = cycle.stages.flatMap((row) =>
    ticketRunsStageRows(row, plan.names),
  );
  const landed: readonly TicketRunsRow[] =
    landing !== undefined || cycle.standing === "Current"
      ? [{ kind: "Landing", landing, lands: plan.lands }]
      : [];
  const runs = [...work, ...stages].filter(
    (row): row is TicketRunStep => row.kind === "Run",
  );
  return {
    ordinal: cycle.ordinal,
    standing: cycle.standing,
    outcome: ticketRunsCycleOutcome(cycle, plan.names, landing),
    span: runSpanRanOf(runs.map((row) => row.execution)),
    spend: cycle.spend,
    rows: [...work, ...stages, ...landed],
  };
}

/** The ledger's cycles as the Runs tab lists them, newest first. */
export function ticketRunsOf(
  ledger: Ledger,
  landings: TicketLandingsJoined,
  plan: TicketRunsPlan,
): readonly TicketRunsCycle[] {
  return [...ledger.cycles]
    .reverse()
    .map((cycle) => ticketRunsCycleOf(cycle, plan, landings));
}

/** The run a task's number names, and none where the page holds no such run. */
export function ticketRunsFind(
  cycles: readonly TicketRunsCycle[],
  task: number,
): TicketRunStep | undefined {
  for (const cycle of cycles)
    for (const row of cycle.rows)
      if (row.kind === "Run" && row.task === task) return row;
  return undefined;
}

/** A run's own address segment, which is its task's number and nothing else. */
export function ticketRunTaskOf(segment: string): number | undefined {
  return /^[0-9]+$/u.test(segment) && Number.isSafeInteger(Number(segment))
    ? Number(segment)
    : undefined;
}

/** Whether a run can still move, which is what a live run page opens on. */
export function ticketRunLive(verdict: SetVerdict): boolean {
  return verdict === "Starting" || verdict === "Running";
}

export const ticketRunViews = [
  "Summary",
  "Transcript",
  "Details",
  "Output",
] as const;

export type TicketRunView = (typeof ticketRunViews)[number];

/** A run page's address query: the sub-tab it names, if it names one. */
export interface TicketRunQuery {
  readonly view?: TicketRunView;
}

/** The sub-tab an address names, its word read in any case. */
export function ticketRunQueryOf(
  search: Readonly<Record<string, unknown>>,
): TicketRunQuery {
  const asked = search["view"];
  const view = ticketRunViews.find(
    (each) =>
      typeof asked === "string" && each.toLowerCase() === asked.toLowerCase(),
  );
  return view === undefined ? {} : { view };
}

/** The sub-tab a run page draws: the one its address names where the run
 * offers it, and otherwise Summary, or Transcript while the run is live. */
export function ticketRunViewShown(
  asked: TicketRunView | undefined,
  offered: readonly TicketRunView[],
  live: boolean,
): TicketRunView {
  if (asked !== undefined && offered.includes(asked)) return asked;
  return live && offered.includes("Transcript") ? "Transcript" : "Summary";
}

/** How much of a digest's hex is kept either side of the cut. */
const ticketRunImageHexHead = 8;
const ticketRunImageHexTail = 6;

/** An image reference with its digest cut in the middle, the name kept whole. */
export function ticketRunImageLabel(image: string): Label {
  const at = image.lastIndexOf(":");
  const hex = image.slice(at + 1);
  const cut =
    image.includes("@") &&
    at !== -1 &&
    hex.length > ticketRunImageHexHead + ticketRunImageHexTail
      ? `${image.slice(0, at + 1)}${hex.slice(0, ticketRunImageHexHead)}…${hex.slice(-ticketRunImageHexTail)}`
      : image;
  return { text: cut, title: image };
}

/** The millis one CPU is asked as. */
const ticketRunCpuMillis = 1_000;

type TicketRunTotals = NonNullable<ExecutionSummary["runTotals"]>;

/** What a run's Details list says of it; a field absent is one the wire did not carry. */
export interface TicketRunDetails {
  readonly runner: string;
  readonly image: Label | undefined;
  readonly worker: string | undefined;
  readonly cpus: string | undefined;
  readonly waited: Figure;
  readonly attempts: number;
  readonly model: string | undefined;
  readonly turns: number | undefined;
  readonly apiTime: Figure | undefined;
  readonly tokens: string | undefined;
  readonly execution: Label;
}

function ticketRunTokens(totals: TicketRunTotals): string {
  return [
    `${tokenCountText(totals.tokensInput)} in`,
    `${tokenCountText(totals.tokensOutput)} out`,
    `${tokenCountText(totals.tokensCacheCreation)} cache write`,
    `${tokenCountText(totals.tokensCacheRead)} cache read`,
  ].join(" · ");
}

function ticketRunWaited(execution: ExecutionResponse): Figure {
  const registered = Date.parse(execution.registeredAt);
  const started =
    execution.startedAt === undefined ? NaN : Date.parse(execution.startedAt);
  return Number.isFinite(registered) && Number.isFinite(started)
    ? durationFigure(started - registered)
    : { kind: "Absent", why: "Not started" };
}

export function ticketRunDetailsOf(
  execution: ExecutionResponse,
): TicketRunDetails {
  const requirement = execution.requirement;
  const totals = execution.runTotals;
  const cpuMillis = execution.resources?.cpuMillis;
  const models = totals?.models.map((usage) => usage.model) ?? [];
  return {
    runner: [
      requirement.operatingSystem,
      requirement.architecture,
      requirement.mode.toLowerCase(),
    ].join(" · "),
    image:
      requirement.mode === "Container"
        ? ticketRunImageLabel(requirement.image)
        : undefined,
    worker:
      execution.worker === undefined
        ? undefined
        : `${execution.worker.name} ${execution.worker.version}`,
    cpus:
      cpuMillis === undefined
        ? undefined
        : String(cpuMillis / ticketRunCpuMillis),
    waited: ticketRunWaited(execution),
    attempts: execution.attempts.length,
    model: models.length === 0 ? undefined : models.join(", "),
    turns: totals?.turns,
    apiTime:
      totals === undefined ? undefined : durationFigure(totals.durationApiMs),
    tokens: totals === undefined ? undefined : ticketRunTokens(totals),
    execution: {
      text: digestShortened(execution.execution),
      title: execution.execution,
    },
  };
}

/** The mark a run, a landing or a step not reached is drawn with. */
export type TicketRunMark =
  "Check" | "Cross" | "Spin" | "Alert" | "Slash" | "Open" | "Merge";

export function ticketRunMarkOf(verdict: SetVerdict): TicketRunMark {
  switch (verdict) {
    case "Passed":
      return "Check";
    case "Failed":
      return "Cross";
    case "Starting":
    case "Running":
      return "Spin";
    case "Blocked":
      return "Alert";
    case "Cancelled":
      return "Slash";
  }
}

/** A mark and the tone it is drawn in. */
export interface TicketRunMarked {
  readonly mark: TicketRunMark;
  readonly tone: Tone;
}

/** A landing's mark: the merge mark while it merged or is under way, and its
 * failure, its escalation or its invalidation otherwise. */
export function ticketRunLandingMarked(
  landing: TicketLanding,
): TicketRunMarked {
  switch (landing.state) {
    case "Failed":
      return { mark: "Cross", tone: "fail" };
    case "Unavailable":
      return { mark: "Alert", tone: "parked" };
    case "Invalidated":
      return { mark: "Slash", tone: "retired" };
    case "Running":
    case "Held":
    case "AwaitingApproval":
    case "AwaitingMerge":
    case "Proposed":
    case "Landed":
      return { mark: "Merge", tone: "finalization" };
  }
}

/** The name a row is listed under. */
export function ticketRunsRowName(row: TicketRunsRow): string {
  return row.kind === "Landing" ? "Landing" : row.name;
}

/** The cycle whose landing the landing page draws: the newest holding one,
 * or the current cycle where none does. */
export function ticketRunsLandingCycle(
  cycles: readonly TicketRunsCycle[],
): number | undefined {
  const landed = cycles.find((cycle) =>
    cycle.rows.some(
      (row) => row.kind === "Landing" && row.landing !== undefined,
    ),
  );
  return (
    landed ??
    cycles.find((cycle) => cycle.rows.some((row) => row.kind === "Landing"))
  )?.ordinal;
}
