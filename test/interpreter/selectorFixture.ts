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
