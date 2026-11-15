import type { WorkerContractPeer } from "../../src/contract/workerContract.ts";

/** What a request offers that names `release` and lists no features. */
export function workerContractPeerNaming(
  release: string | undefined,
): WorkerContractPeer {
  return { release, features: undefined };
}
