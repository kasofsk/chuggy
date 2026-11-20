import type { WorkerPoolAssignments } from "../../src/interpreter/workerPool.ts";

/** A durable side holding nothing, which is what a runner with no work to take meets. */
export const workerPoolAssignmentsIdle: WorkerPoolAssignments = {
  claimPersonal: () => Promise.resolve(undefined),
  waitingPersonal: () => Promise.resolve(false),
  allowlisted: () => Promise.resolve([]),
  credentialOutcomes: () => Promise.resolve([]),
  credentialPauses: () => Promise.resolve([]),
  polled: () => Promise.resolve(),
  renew: () => Promise.resolve(true),
  refuse: () => Promise.resolve(false),
  release: () => Promise.resolve(false),
  held: () => Promise.resolve(false),
  heldImages: () => Promise.resolve([]),
};
