/**
 * The journal of one real ticket, as the executions route answers it.
 *
 * Three cycles, two of them superseded, a stage that passed an artifact the
 * ticket no longer holds, a stage the fabric relaunched its container for, and
 * a resume that re-ran the program from its lowest stage. The list is held by
 * execution identity, which is a UUID and is an order the route no longer
 * answers in, so every suite reading it proves the derivation recovers a cycle
 * from whatever order a page reaches it in.
 */

import type {
  ExecutionSummary,
  ExecutionsResponse,
  RunTotals,
} from "../../../src/contract/responses.ts";
import type {
  ExecutionOutcome,
  ExecutionStatus,
  ExecutionTaskKind,
  RunCostBasis,
} from "../../../src/contract/rosters.ts";
import type { TicketAuthoring } from "../app/core/ticketLedger.ts";

/** What a case wants of a run's figures; everything else about them is filled in. */
export interface TotalsShape {
  readonly turns: number;
  readonly durationMs: number;
  readonly costUsdMicros: number;
  readonly model?: string;
  readonly costBasis?: string;
}

export interface ExecutionShape {
  readonly execution: string;
  readonly task: number;
  readonly taskKind: ExecutionTaskKind;
  readonly stage?: number;
  readonly status?: ExecutionStatus;
  readonly outcome?: ExecutionOutcome;
  readonly retriesSpent?: number;
  readonly request?: string;
  readonly totals?: TotalsShape;
  readonly registeredAt?: string;
  readonly terminalAt?: string;
}

const digest = "a".repeat(64);
const ledgerEpochMs = Date.parse("2026-08-26T00:00:00Z");
const ledgerTaskGapMs = 600_000;
const ledgerTokensPerTurn = 1_000;
const ledgerRunMs = 90_000;

/**
 * One task's window, in the one spelling whose text orders the way its clock
 * does. A case wanting the spellings to disagree states its own instants.
 */
function ledgerInstant(offsetMs: number): string {
  return new Date(ledgerEpochMs + offsetMs).toISOString();
}

/**
 * A run's figures around what a case asked for. `costBasis` widens because the
 * roster has one member, so a rollup over two bases has to be built rather than
 * found on any wire this console can read.
 */
function ledgerTotals(shape: TotalsShape): RunTotals {
  const tokensInput = shape.turns * ledgerTokensPerTurn;
  const usage = {
    model: shape.model ?? "claude-fable-5",
    tokensInput,
    tokensOutput: shape.turns,
    tokensCacheCreation: 0,
    tokensCacheRead: 0,
    costUsdMicros: shape.costUsdMicros,
  };
  return {
    turns: shape.turns,
    durationMs: shape.durationMs,
    durationApiMs: Math.trunc(shape.durationMs / 2),
    tokensInput,
    tokensOutput: shape.turns,
    tokensCacheCreation: 0,
    tokensCacheRead: 0,
    costUsdMicros: shape.costUsdMicros,
    costBasis: (shape.costBasis ?? "List") as RunCostBasis,
    models: [usage],
    permissionDenials: 0,
  };
}

/** One row, with everything the ledger never reads held constant. */
export function ledgerExecution(shape: ExecutionShape): ExecutionSummary {
  const { totals, ...wire } = shape;
  const registeredAt = ledgerInstant(shape.task * ledgerTaskGapMs);
  const running =
    shape.status !== undefined &&
    shape.status !== "Terminal" &&
    shape.status !== "Cancelled";
  return {
    ticket: 21,
    cluster: "rig",
    configurationRevision: "r1",
    requirementIdentity: shape.execution,
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "chuggy/worker",
    },
    requirementDigest: digest,
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Terminal",
    retriesSpent: 0,
    registeredAt,
    ...(running
      ? {}
      : {
          terminalAt: ledgerInstant(
            shape.task * ledgerTaskGapMs + (totals?.durationMs ?? ledgerRunMs),
          ),
        }),
    ...(totals === undefined ? {} : { runTotals: ledgerTotals(totals) }),
    ...wire,
  };
}

/** A page of the given rows, its cursor naming more where a case wants a short one. */
export function ledgerPage(
  shapes: readonly ExecutionShape[],
  cursor?: string,
): ExecutionsResponse {
  const executions = shapes.map(ledgerExecution);
  return cursor === undefined
    ? { executions }
    : { executions, nextCursor: cursor };
}

/** Two evaluation stages, one work task each, two reworks, a charged retry. */
export const ticket21Authoring: TicketAuthoring = {
  dependencies: [],
  program: [
    { fanout: 1, combinator: "UnanimousPass" },
    { fanout: 1, combinator: "UnanimousPass" },
  ],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 2 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};

/** The seven executions the ticket held while it was parked. */
export const ticket21Parked: readonly ExecutionShape[] = [
  {
    execution: "execution-38e5111e-2",
    task: 2,
    taskKind: "Evaluation",
    stage: 0,
    outcome: "Failed",
    totals: { turns: 12, durationMs: 180_000, costUsdMicros: 420_000 },
  },
  {
    execution: "execution-a3c138a0-5",
    task: 5,
    taskKind: "Evaluation",
    stage: 1,
    outcome: "Failed",
    totals: { turns: 14, durationMs: 210_000, costUsdMicros: 500_000 },
  },
  {
    execution: "execution-b8bdfdd4-7",
    task: 7,
    taskKind: "Evaluation",
    stage: 0,
    outcome: "Failed",
    retriesSpent: 3,
    totals: { turns: 9, durationMs: 240_000, costUsdMicros: 350_000 },
  },
  {
    execution: "execution-bfaa13b2-1",
    task: 1,
    taskKind: "Work",
    outcome: "Passed",
    totals: { turns: 40, durationMs: 600_000, costUsdMicros: 1_800_000 },
  },
  {
    execution: "execution-c004a1fa-6",
    task: 6,
    taskKind: "Work",
    outcome: "Passed",
    totals: { turns: 38, durationMs: 570_000, costUsdMicros: 1_700_000 },
  },
  {
    execution: "execution-ef9d5921-4",
    task: 4,
    taskKind: "Evaluation",
    stage: 0,
    outcome: "Passed",
    totals: { turns: 10, durationMs: 150_000, costUsdMicros: 380_000 },
  },
  {
    execution: "execution-f0410b67-3",
    task: 3,
    taskKind: "Work",
    outcome: "Passed",
    totals: { turns: 35, durationMs: 540_000, costUsdMicros: 1_600_000 },
  },
];

/** The eighth execution: the resume's fresh fan-out of the lowest stage. */
const ticket21Resume: ExecutionShape = {
  execution: "execution-c40de507-8",
  task: 8,
  taskKind: "Evaluation",
  stage: 0,
  status: "Running",
};

export const ticket21Resumed: readonly ExecutionShape[] = [
  ...ticket21Parked,
  ticket21Resume,
].sort((left, right) => (left.execution < right.execution ? -1 : 1));
