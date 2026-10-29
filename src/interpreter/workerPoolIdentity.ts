/** Who a poll acts as, and where what it hands out is named from: shared by both kinds of work a pool is handed. */
import type { Principal } from "./principal.ts";
import type { Partition, TenantId } from "./projectStore.ts";

/** One registered pool as its principal resolves it: whose it is, and the principal a claim is current under. */
export interface WorkerPoolIdentity {
  readonly partition: Partition;
  readonly pool: string;
  readonly principal: Principal;
}

/** One member's personal runner as its principal resolves it: its tenant and owner, and no project, since what it serves is its allowlist. */
export interface PersonalRunnerIdentity {
  readonly tenant: TenantId;
  readonly owner: Principal;
  readonly principal: Principal;
}

/** One member's chat host as its principal resolves it: its tenant and owner, and no project, since what it serves is every project its owner may read. */
export interface ChatHostIdentity {
  readonly tenant: TenantId;
  readonly owner: Principal;
  readonly principal: Principal;
}

/** A project's pool as the pool plane admitted it. */
export type DedicatedPoolIdentity = WorkerPoolIdentity & {
  readonly kind: "Dedicated";
};

/** Whoever the pool plane admitted: a project's pool, a member's personal runner, or a member's chat host. */
export type PoolPlaneIdentity =
  | DedicatedPoolIdentity
  | (PersonalRunnerIdentity & { readonly kind: "Personal" })
  | (ChatHostIdentity & { readonly kind: "ChatHost" });

/** Whoever the pool plane admitted that may take an execution: a project's pool or a member's personal runner. */
export type WorkerPoolExecutionPoller = Exclude<
  PoolPlaneIdentity,
  { readonly kind: "ChatHost" }
>;

/** Draws an assignment's identity and the one-shot bearer its harness answers under. */
export type WorkerPoolMint = () => string;
