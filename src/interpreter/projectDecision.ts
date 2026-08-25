/**
 * The project decision transaction: the one commit that turns an accepted
 * decision input into a journaled decision or into a durable refusal.
 *
 * WHY THIS IS ONE CALL AND NOT SIX. The journal entry, the input outcome and
 * the projection are one transaction in
 * issue #180, and a port offering them
 * separately would invite an implementation that journaled a decision and then
 * failed to settle the operation that authorized it — a project whose head has
 * moved and whose client is still waiting. So the whole decision is the
 * argument, and the fences are arguments too: the lease carries the owner, the
 * fencing epoch, the recovery epoch and the expected head, and no caller can
 * present a decision without presenting what authorizes it.
 *
 * WHY IT IS NOT A METHOD ON `./projectStore.ts`. That port is answered by the
 * ticket-service role as this one is, so authority does not split them — the
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
 * AN ANSWERED ACTION WRITES NO ENTRY EITHER, AND IT IS NOT A REFUSAL. The two
 * answers a finalization approval admits name no domain command, so `Core`
 * learns nothing and there is nothing to journal; the input settles carrying
 * which of the offered answers was given, and the head and the projection are
 * exactly as they were.
 *
 * A REFUSAL WRITES NO ENTRY. It settles the decision input
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
import type { DispatchCandidate } from "./dispatchView.ts";
import type { FinalizationEvidence } from "./finalizerPreparation.ts";
import type { NativeActionResolution } from "./ticketCommand.ts";

/**
 * The finite vocabulary a refused operation answers with. It is closed because
 * 006 requires a stable safe code, and an open one is a code a client cannot
 * branch on.
 */
export type RefusalCode =
  | "NotEnabled"
  | "AuthoringChanged"
  | "ConfigurationInvalid"
  | "TicketChanged"
  | "SelectionChanged";

/** Every refusal code, in the order this file declares them, so a suite and a CHECK can iterate rather than restate. */
export const allRefusalCodes: readonly RefusalCode[] = [
  "NotEnabled",
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
];

export interface ConfigurationPin {
  readonly configurationRevision: string;
  readonly configurationDigest: string;
}

export interface DraftReleaseFence extends ConfigurationPin {
  readonly ticket: number;
  readonly authoringVersion: number;
  readonly configurationCanonical: string;
  readonly finalizationInput?: {
    readonly repository: string;
    readonly requestedRef: string;
    readonly resolvedCommit: string;
  };
}

/**
 * The authority a project writer settles an operation under. A refusal has no
 * journal entry to record the owner on, so this and the settled subject are
 * the only audit trail it leaves.
 */
export const projectTicketWriterAuthorityKind: AuthorityKind = asAuthorityKind(
  "ProjectTicketWriter",
);

export type DecisionCause =
  | { readonly kind: "Operation"; readonly id: OperationId }
  | { readonly kind: "Continuation"; readonly id: string };

/** One row of the primary projection: where a ticket currently stands. */
export interface TicketProjection {
  readonly ticket: TicketId;
  readonly phase: Phase;
  readonly dependable: boolean;
}

/**
 * The bundle a spawn request pins, minted from the same journal position the
 * request is, so a retried decision reproduces the identity rather than a second
 * bundle. A cancellation authorizes no work and pins none.
 */
export interface ExecutionRequestBundle {
  readonly bundle: string;
  readonly evidence?: FinalizationEvidence;
  readonly source?: {
    readonly repository: string;
    readonly targetRef?: string;
    readonly targetCommit: string;
    readonly manifests: readonly string[];
  };
}

/** The kind part of a spawn bundle's derived identity, which the schema's backfill spells too. */
export const inputBundleIdentityKind = "InputBundle";

/** The request kinds that authorize work, which are the ones that pin a bundle. */
export const spawnRequestKinds: readonly ExecutionRequestPlan["kind"][] = [
  "SpawnWork",
  "SpawnEvaluation",
];

export interface ExecutionRequestPlan {
  readonly request: string;
  readonly effectPosition: number;
  readonly ticket: TicketId;
  readonly ticketVersion: number;
  readonly kind: "SpawnWork" | "SpawnEvaluation" | "CancelTicketWork";
  readonly bundle?: ExecutionRequestBundle;
  readonly tasks: readonly (
    | { readonly task: number; readonly kind: "Work" }
    | {
        readonly task: number;
        readonly kind: "Evaluation";
        readonly stage: number;
      }
  )[];
}

export interface NativeActionPlan {
  readonly action: string;
  readonly effectPosition: number;
  readonly ticket: TicketId;
  readonly version: number;
  readonly kind: "TicketEscalation" | "HandoffBlock";
  readonly reason: string;
  readonly capability: "ResolveTicket";
  readonly resolutions: readonly NativeActionResolution[];
}

/**
 * Which of the answers an open action offered was given, at the fence that
 * authorized it. `open` is false where the action stopped being answerable
 * between acceptance and decision.
 */
export interface NativeActionAnswer {
  readonly action: string;
  readonly authorizingSeq: number;
  readonly resolution: NativeActionResolution;
  readonly open: boolean;
}

export interface DecisionMaterialization {
  readonly continuation?: {
    readonly continuation: string;
    readonly kind: "ReduceWork" | "ReduceEvaluation";
    readonly ticket: TicketId;
    readonly expectedTicketVersion: number;
    readonly expectedPhase: Phase;
    readonly taskSetGeneration: number;
  };
  readonly actions: readonly NativeActionPlan[];
  readonly execution: readonly ExecutionRequestPlan[];
  readonly finalization: readonly {
    readonly request: string;
    readonly effectPosition: number;
    readonly ticket: TicketId;
    readonly ticketVersion: number;
    readonly requestGeneration: number;
    readonly kind: "RunFinalizer" | "PromoteForHandoff" | "PublishHandoff";
    readonly acceptedPromotion?: {
      readonly repository: string;
      readonly commit: string;
      readonly configurationRevision: string;
      readonly configurationDigest: string;
    };
  }[];
  readonly fulfillFinalizationFor: readonly TicketId[];
  readonly withdrawActionsFor: readonly TicketId[];
  readonly resolveAction?: NativeActionAnswer;
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
      readonly materialization: DecisionMaterialization;
      readonly dispatchView?: {
        readonly digest: string;
        readonly candidates: readonly DispatchCandidate[];
      };
    }
  | { readonly outcome: "Refused"; readonly code: RefusalCode }
  | { readonly outcome: "Answered"; readonly answer: NativeActionAnswer }
  | { readonly outcome: "Stale" };

/** One decision offered for commit: what authorizes it, what caused it, and what it writes. */
export interface Decision {
  readonly lease: Lease;
  readonly cause: DecisionCause;
  readonly outcome: DecisionOutcome;
  readonly draftRelease?: DraftReleaseFence;
}

/**
 * What a terminal operation records about itself, which is what an ambiguous
 * commit is resolved by reading. A success carries the sequence it decided at
 * so a client reads its own write and a writer resumes at the right head.
 */
export type DecisionInputOutcome =
  | { readonly settled: "Succeeded"; readonly seq: number }
  | { readonly settled: "Refused"; readonly code: RefusalCode }
  | { readonly settled: "Answered" }
  | { readonly settled: "Cancelled" }
  | { readonly settled: "Stale" };

/**
 * What a decision found. `Committed` carries the lease the commit advanced, so
 * no caller rebuilds one from a head and a lease it was holding separately.
 */
export type Decided =
  | { readonly decided: "Committed"; readonly lease: Lease }
  | { readonly decided: "Refused" }
  | { readonly decided: "Answered" }
  | { readonly decided: "Stale" }
  | {
      readonly decided: "AlreadyTerminal";
      readonly outcome: DecisionInputOutcome;
    }
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

  /** Replaces the replayable dispatch projection under the same ownership fences as decisions. */
  rebuildDispatchView?(
    lease: Lease,
    view: {
      readonly digest: string;
      readonly candidates: readonly DispatchCandidate[];
    },
  ): Promise<void>;
}
