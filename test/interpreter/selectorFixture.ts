import type { SelectorRuntimeSettings } from "../../src/interpreter/selector.ts";

/**
 * The operational context every selector suite observes. It is one fixture
 * rather than one copy per suite, because the shape is the contract and a copy
 * that drifts is a suite asserting a context the tree no longer builds.
 */

export const selectorOperationalContext = {
  version: 2,
  observedAt: "2026-08-21T12:00:00.000Z",
  observedAtEpochMs: 1_777_000_000_000,
  reviewFeedback: [],
  activeWork: { queued: 0, admitted: 0, launching: 0, running: 0 },
  capacity: {
    account: "project",
    accountMaximum: 4,
    accountActive: 0,
    accountReservationDeficit: 0,
    clusterSlotsMax: 10,
    clusterActive: 2,
  },
  backlog: {
    project: { queued: 0, ceiling: 100 },
    installation: { queued: 0, ceiling: 1_000 },
  },
} as const;

/** The installation settings the selector suites run a project under where a case sets none. */
export const selectorRuntimeSettings: SelectorRuntimeSettings = {
  revision: 1,
  mode: "Running",
  dispatchMode: "Automatic",
  basePrompt: "prompt",
  modelAllowlist: ["*"],
  toolAllowlist: ["*"],
  limits: {
    tokensPerDecision: 8192,
    millisecondsPerDecision: 120_000,
    toolCallsPerDecision: 20,
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 1,
    autoCompactWindow: 200_000,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
  },
  operationalContextMaxAgeMs: 30_000,
};
