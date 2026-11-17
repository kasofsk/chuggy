import type { WorkerPoolAssignments } from "../../src/interpreter/workerPool.ts";

/** A durable side holding nothing, which is what a pool with no work to take meets. */
export const workerPoolAssignmentsIdle: WorkerPoolAssignments = {
  claim: () => Promise.resolve(undefined),
  ownersDeferredTo: () => Promise.resolve([]),
  claimPersonal: () => Promise.resolve(undefined),
  waiting: () => Promise.resolve(false),
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
