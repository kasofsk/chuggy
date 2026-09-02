/**
 * The doors the selector's own role has onto one project's lead mailbox. It
 * declares the shapes and names no adapter, exactly as `./sessionPlane.ts` does
 * for the worker plane.
 *
 * A TURN'S IDENTITY IS THE DECISION'S. Offering is therefore idempotent: a
 * retry of one decision finds the turn it already enqueued rather than putting
 * a second one in the mailbox, and nothing has to reconcile two turns that
 * meant the same thing.
 *
 * THE MEASUREMENT IS THE POD'S AND NEVER THE MODEL'S. `enforcePolicyControls`
 * checks the model, the tools, the tokens and the duration a decision spent; a
 * decision document that carried its own token count would be a control the
 * thing being controlled fills in. So `SessionTurnMeasured` is what the pod read
 * from the runtime's own messages, and a turn that reports none is a decision
 * with no provenance rather than a decision that spent nothing.
 */

import type {
  SessionId,
  SessionState,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnMeasured,
  SessionTurnState,
} from "./agentSession.ts";
import type { Partition } from "./projectStore.ts";

/** The project's lead session as the selector may see it, which is not the whole row. */
export interface LeadSessionStanding {
  readonly session: SessionId;
  readonly state: SessionState;
  /** Absent until the session's first turn has bound one, which is what makes a turn a seeding turn. */
  readonly agentReference?: string;
}

/** What offering a turn found, carrying the ordinal only where the mailbox holds one. */
export type LeadTurnOffered =
  | {
      readonly offered: "Enqueued" | "AlreadyEnqueued";
      readonly ordinal: number;
    }
  | { readonly offered: "NoLead" | "Closed" | "Backlogged" };

/** Where one offered turn stands, and everything it has produced so far. */
export interface LeadTurnStanding {
  readonly state: SessionTurnState;
  readonly result?: string;
  readonly failure?: SessionTurnFailure;
  readonly measured?: SessionTurnMeasured;
}

/** What withdrawing found: a turn moved out of the mailbox, one already ended, or none. */
export type LeadTurnWithdrawn = "Withdrawn" | "AlreadyEnded" | "NoTurn";

/** The durable doors the selector's own role has onto one project's lead mailbox. */
export interface LeadMailbox {
  /** The project's lead session, or nothing where the project has none. */
  lead(partition: Partition): Promise<LeadSessionStanding | undefined>;
  offer(input: {
    readonly partition: Partition;
    readonly turn: SessionTurnId;
    readonly input: string;
  }): Promise<LeadTurnOffered>;
  turn(
    partition: Partition,
    turn: SessionTurnId,
  ): Promise<LeadTurnStanding | undefined>;
  withdraw(
    partition: Partition,
    turn: SessionTurnId,
  ): Promise<LeadTurnWithdrawn>;
}
