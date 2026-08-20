/**
 * The durable discovery side of a project fleet: how a dispatcher finds a
 * project with work waiting, what it verifies that readiness against, and what
 * it must prove before it stops being found.
 *
 * WHY THIS IS NOT PART OF `OperationInbox`. Acceptance and cancellation are
 * the API's transactions and these three are a dispatcher's, and
 * `docs/design/006-durable-project-dispatch.md` says runtime services do not
 * share an omnipotent credential. A port whose methods two roles answer is a
 * port no set of grants can describe — the grant is where that boundary is
 * actually enforced — so the split is by authority, and each side is given
 * only the calls its role is granted. That is also why the adapter for this
 * port takes its own pool: in deployment those pools carry different
 * credentials, and one pool answering both ports would be the omnipotent
 * credential under another name.
 *
 * READINESS IS AN INDEX AND THE INBOX IS THE AUTHORITY. A ready project whose
 * items were all consumed costs one wasted activation; an unready project
 * holding a consumable item is work nobody finds. So `ready` is what a fleet
 * polls and `consumable` is what an activation verifies itself against, and
 * neither reads anything of a project but its readiness and its inbox.
 *
 * EVERY REFUSAL IS A VALUE, as in `./projectStore.ts`. A generation another
 * acceptance superseded and an inbox item the owner had not accounted for are
 * outcomes a caller must handle, not exceptions it may ignore.
 */

import type { OperationCommand, OperationId } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";

/** One project's discovery record: the partition with work waiting, and the generation that wake-up carries. */
export interface Readiness {
  readonly partition: Partition;
  readonly generation: number;
}

/**
 * One durable inbox item, in the ordinal order acceptance allocated it. It
 * carries its operation's command because deciding it is what a writer
 * consumes it for, and a second read to fetch that would be a second
 * transaction the first one's answer could already be stale in.
 */
export interface InboxItem {
  readonly partition: Partition;
  readonly ordinal: number;
  readonly operation: OperationId;
  readonly command: OperationCommand;
}

/**
 * What clearing readiness found. `Superseded` is an acceptance that arrived
 * after the owner observed its generation, and `WorkRemains` is a consumable
 * item the owner had not accounted for.
 */
export type ReadinessCleared =
  | { readonly cleared: "Cleared" }
  | { readonly cleared: "Superseded"; readonly generation: number }
  | { readonly cleared: "WorkRemains" };

/**
 * Durable discovery over a project fleet. Only `ready` reads across
 * partitions, and it reads nothing of one but the fact that it has work.
 */
export interface ProjectDiscovery {
  /** At most `partitionsMax` projects with work waiting, which is all fleet discovery reads. */
  ready(partitionsMax: number): Promise<readonly Readiness[]>;

  /** At most `itemsMax` consumable items in ordinal order, which is what activation verifies the inbox with. */
  consumable(
    partition: Partition,
    itemsMax: number,
  ): Promise<readonly InboxItem[]>;

  /**
   * Clears readiness if the generation is still the one observed and no
   * consumable item remains, so an idle owner cannot erase a concurrent
   * wake-up.
   */
  clearReadiness(readiness: Readiness): Promise<ReadinessCleared>;
}
