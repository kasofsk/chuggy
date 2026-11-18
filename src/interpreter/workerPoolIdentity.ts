/** Who a poll acts as, and where what it hands out is named from: shared by both kinds of work the plane hands out. */
import type { Principal } from "./principal.ts";
import type { TenantId } from "./projectStore.ts";

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

/** Whoever the pool plane admitted: a member's personal runner, or a member's chat host. */
export type PoolPlaneIdentity =
  | (PersonalRunnerIdentity & { readonly kind: "Personal" })
  | (ChatHostIdentity & { readonly kind: "ChatHost" });

/** Whoever the pool plane admitted that may take an execution: a member's personal runner. */
export type WorkerPoolExecutionPoller = Extract<
  PoolPlaneIdentity,
  { readonly kind: "Personal" }
>;

/** Draws an assignment's identity and the one-shot bearer its harness answers under. */
export type WorkerPoolMint = () => string;
