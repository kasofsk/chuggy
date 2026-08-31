/**
 * The journal of one real ticket, as the executions route answers it.
 *
 * Three cycles, two of them superseded, a stage that passed an artifact the
 * ticket no longer holds, a stage the fabric relaunched its container for, and
 * a resume that re-ran the program from its lowest stage. The list is built in
 * the order the route sends it — by execution identity, which is a UUID — so
 * every suite reading it is reading arrival order rather than time order.
 */

import type {
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../src/contract/responses.ts";
import type {
  ExecutionOutcome,
  ExecutionStatus,
  ExecutionTaskKind,
} from "../../../src/contract/rosters.ts";
import type { TicketAuthoring } from "../app/core/ticketLedger.ts";

export interface ExecutionShape {
  readonly execution: string;
  readonly task: number;
  readonly taskKind: ExecutionTaskKind;
  readonly stage?: number;
  readonly status?: ExecutionStatus;
  readonly outcome?: ExecutionOutcome;
  readonly retriesSpent?: number;
}

const digest = "a".repeat(64);

/** One row, with everything the ledger never reads held constant. */
export function ledgerExecution(shape: ExecutionShape): ExecutionSummary {
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
    registeredAt: "2026-08-26T00:00:00Z",
    ...shape,
  };
}

/** A page of the given rows, `nextAfter` naming more where a case wants a short one. */
export function ledgerPage(
  shapes: readonly ExecutionShape[],
  nextAfter?: string,
): ExecutionsResponse {
  const executions = shapes.map(ledgerExecution);
  return nextAfter === undefined ? { executions } : { executions, nextAfter };
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

/**
 * The seven executions the ticket held while it was parked, listed as the route
 * lists them.
 */
export const ticket21Parked: readonly ExecutionShape[] = [
  {
    execution: "execution-38e5111e-2",
    task: 2,
    taskKind: "Evaluation",
    stage: 0,
    outcome: "Failed",
  },
  {
    execution: "execution-a3c138a0-5",
    task: 5,
    taskKind: "Evaluation",
    stage: 1,
    outcome: "Failed",
  },
  {
    execution: "execution-b8bdfdd4-7",
    task: 7,
    taskKind: "Evaluation",
    stage: 0,
    outcome: "Failed",
    retriesSpent: 3,
  },
  {
    execution: "execution-bfaa13b2-1",
    task: 1,
    taskKind: "Work",
    outcome: "Passed",
  },
  {
    execution: "execution-c004a1fa-6",
    task: 6,
    taskKind: "Work",
    outcome: "Passed",
  },
  {
    execution: "execution-ef9d5921-4",
    task: 4,
    taskKind: "Evaluation",
    stage: 0,
    outcome: "Passed",
  },
  {
    execution: "execution-f0410b67-3",
    task: 3,
    taskKind: "Work",
    outcome: "Passed",
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
