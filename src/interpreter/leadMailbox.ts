/**
 * The doors the selector's own role has onto one project's lead mailbox. It
 * declares the shapes and names no adapter, exactly as `./sessionPlane.ts` does
 * for the worker plane.
 *
 * OPENING IS A DOOR HERE AND CLOSING IS NOT. A project whose lead has closed
 * must be able to decide again, and the record is what rebuilds one, so the
 * successor is the runtime's to open. Ending a lead decides that a project's
 * continuous context is over, which is provisioning, and no runtime role may
 * do it.
 *
 * READING AND WITHDRAWING NAME THE TURN AND NOTHING ELSE. The turn is globally
 * unique and its door joins it to the project's lead, so a process that did not
 * offer a turn can still settle it — which is what lets a restarted selector
 * withdraw the turn its predecessor left in flight instead of holding a permit
 * against a decision nobody can end.
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

/**
 * Where a successor lead's identity comes from. It is a draw and not a
 * derivation, exactly as a thread's is: a lead identity carries nothing a
 * reader may act on, and a name derived from the decision that opened it would
 * make one cycle's reference outlive the cycle.
 */
export interface LeadSessionMint {
  session(): SessionId;
}

/** Everything a successor is opened as that the project does not already hold. */
export interface LeadOpening {
  readonly partition: Partition;
  readonly session: SessionId;
  /** Whose authorization the lead acts under, which is the selector's own. */
  readonly principal: string;
  readonly credentialSlot: string;
  readonly systemPrompt: string;
}

/** What opening found: a successor written, or the open lead that was already there. */
export interface LeadOpened {
  readonly opened: "Opened" | "AlreadyOpen";
  readonly session: SessionId;
}

/** The durable doors the selector's own role has onto one project's lead mailbox. */
export interface LeadMailbox {
  /** The project's lead session, or nothing where the project has never had one. */
  lead(partition: Partition): Promise<LeadSessionStanding | undefined>;
  /**
   * Opens the project's lead where none is open. It is idempotent on that: the
   * durable door answers `AlreadyOpen` with the session that stands, so two
   * selector processes racing one project end with one lead between them.
   */
  openLead(opening: LeadOpening): Promise<LeadOpened>;
  offer(input: {
    readonly partition: Partition;
    readonly turn: SessionTurnId;
    readonly input: string;
  }): Promise<LeadTurnOffered>;
  /** Keyed by the turn alone, which is globally unique and joined to the lead. */
  turn(turn: SessionTurnId): Promise<LeadTurnStanding | undefined>;
  withdraw(turn: SessionTurnId): Promise<LeadTurnWithdrawn>;
}
