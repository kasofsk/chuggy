/** Who a poll acts as, and where what it hands out is named from: shared by both kinds of work a pool is handed. */
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";

/** One registered pool as its principal resolves it: whose it is, and the principal a claim is current under. */
export interface WorkerPoolIdentity {
  readonly partition: Partition;
  readonly pool: string;
  readonly principal: Principal;
}

/** Draws an assignment's identity and the one-shot bearer its harness answers under. */
export type WorkerPoolMint = () => string;
