/**
 * The project decision transaction: the one commit that turns an accepted
 * operation into a journaled decision or into a durable refusal.
 *
 * WHY THIS IS ONE CALL AND NOT SIX. The journal entry, the operation outcome,
 * the inbox acknowledgement and the projection are one transaction in
 * `docs/design/006-durable-project-dispatch.md`, and a port offering them
 * separately would invite an implementation that journaled a decision and then
 * failed to settle the operation that authorized it — a project whose head has
 * moved and whose client is still waiting. So the whole decision is the
 * argument, and the fences are arguments too: the lease carries the owner, the
 * fencing epoch, the recovery epoch and the expected head, and no caller can
 * present a decision without presenting what authorizes it.
 *
 * WHY IT IS NOT A METHOD ON `./projectStore.ts`. That port is answered by the
 * dispatcher role as this one is, so authority does not split them — the
 * module graph does. A decision names the operation that caused it, operation
 * identity is `./operationInbox.ts`'s, and that module already reads
 * `./projectStore.ts`; putting the decision there would make the two import
 * each other. `./projectDiscovery.ts` is the same arrangement for the same
 * reason.
 *
 * THE CAUSE IS THE IDENTITY OF THE DECISION, WHICH IS WHY IT IS CHECKED FIRST.
 * 006 resolves an ambiguous commit by reading the durable operation rather
 * than assuming failure, so a retry that presents a head the commit it never
 * heard about has already moved must answer with the recorded outcome and not
 * with a stale-head refusal. That ordering is the whole of the resolution:
 * `AlreadyTerminal` is decided before the lifecycle, the lease and the head
 * are looked at, and a still-pending operation falls through to the fences and
 * is decided again.
 *
 * A REFUSAL WRITES NO ENTRY. It settles the operation, acknowledges the item
 * and moves nothing else, so the head, the projection and the journal are
 * exactly as they were — which is what makes a refusal replayable as an
 * absence rather than as a decision the machine did not take.
 *
 * EVERY REFUSAL IS A VALUE, as in `./projectStore.ts`. A fenced lease, a stale
 * head, a project no longer active and an operation somebody else already
 * settled are outcomes a caller must handle, not exceptions it may ignore.
 */

import type { Entry } from "../actor/journal.ts";
import type { Phase } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import {
  asAuthorityKind,
  type AuthorityKind,
  type OperationId,
} from "./operationInbox.ts";
import type { Lease, Lifecycle } from "./projectStore.ts";

/**
 * The finite vocabulary a refused operation answers with. It is closed because
 * 006 requires a stable safe code, and an open one is a code a client cannot
 * branch on.
 */
export type RefusalCode = "CommandUnreadable" | "NotEnabled";

/** Every refusal code, in the order this file declares them, so a suite and a CHECK can iterate rather than restate. */
export const allRefusalCodes: readonly RefusalCode[] = [
  "CommandUnreadable",
  "NotEnabled",
];

/**
 * The authority a project writer settles an operation under. A refusal has no
 * journal entry to record the owner on, so this and the settled subject are
 * the only audit trail it leaves.
 */
export const projectWriterAuthorityKind: AuthorityKind =
  asAuthorityKind("ProjectWriter");

/** One row of the primary projection: where a ticket currently stands. */
export interface TicketProjection {
  readonly ticket: TicketId;
  readonly phase: Phase;
}

/**
 * What the decision writes besides the operation outcome. The projection is
 * the rows this decision changed rather than the whole fleet, because a
 * decision that rewrote every ticket would cost the project's size per commit.
 */
export type DecisionOutcome =
  | {
      readonly outcome: "Journaled";
      readonly entry: Entry;
      readonly projection: readonly TicketProjection[];
    }
  | { readonly outcome: "Refused"; readonly code: RefusalCode };

/** One decision offered for commit: what authorizes it, what caused it, and what it writes. */
export interface Decision {
  readonly lease: Lease;
  readonly cause: OperationId;
  readonly outcome: DecisionOutcome;
}

/**
 * What a terminal operation records about itself, which is what an ambiguous
 * commit is resolved by reading. A success carries the sequence it decided at
 * so a client reads its own write and a writer resumes at the right head.
 */
export type OperationOutcome =
  | { readonly settled: "Succeeded"; readonly seq: number }
  | { readonly settled: "Refused"; readonly code: RefusalCode }
  | { readonly settled: "Cancelled" };

/**
 * What a decision found. `Committed` carries the lease the commit advanced, so
 * no caller rebuilds one from a head and a lease it was holding separately.
 */
export type Decided =
  | { readonly decided: "Committed"; readonly lease: Lease }
  | { readonly decided: "Refused" }
  | { readonly decided: "AlreadyTerminal"; readonly outcome: OperationOutcome }
  | { readonly decided: "StaleHead"; readonly head: number }
  | { readonly decided: "Fenced"; readonly fencingEpoch: number }
  | { readonly decided: "NotActive"; readonly lifecycle: Lifecycle };

/**
 * The durable decision transaction for one project partition. It reads and
 * writes nothing outside the partition its lease names.
 */
export interface ProjectDecision {
  /**
   * Commits one decision under the locked partition row, or refuses it by
   * naming the fence that stopped it.
   */
  decide(decision: Decision): Promise<Decided>;
}
