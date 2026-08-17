/**
 * What the desk needs of the world beside the ports: the allowlist a verified
 * subject is looked up in, the annex the board joins against the live core, and
 * the desk's own log read back.
 *
 * IT IS DECLARED HERE FOR THE REASON `ports.ts` GIVES. An adapter is one answer
 * to a contract and the contract is what every answer owes, so the layer that
 * calls out declares it and the composition root hands an answer to whoever
 * needs one. That is also what lets the face that renders the board read a
 * store it may not import, under `no-adapter-sees-another`.
 *
 * THE ANNEX IS NOT THE MACHINE'S. Title, brief, task type and author are what a
 * ticket carries that no decider reads — `Core` has no field for one, and no
 * enablement predicate mentions them — so the arrival and its annex row are two
 * writes and this contract does not pretend otherwise. A crash between them
 * leaves a draft whose annex is missing, and `annexes` answering nothing for a
 * ticket is exactly how the board learns to render it as one.
 *
 * ABSENCE FROM `userBySubject` IS THE REFUSAL, which is why it answers a value
 * rather than throwing: a verified subject with no row is a caller this
 * deployment declines to serve, not a failure of the lookup.
 *
 * THE CREDENTIAL GRANT IS CONFIGURATION, NOT STATE. `credentialsFor` joins the
 * ticket's annexed author — written by the authenticated desk at arrival, and
 * rewritten by nothing a work task can reach — to that subject's stored
 * references and git identity, so what reaches a spawn is decided by the
 * operator surface alone. It answers a value because absence is the refusal
 * here as in `userBySubject`, and failing closed on it is the caller's.
 */

import type { Effect } from "../domain/effect.ts";
import type { TicketId } from "../domain/ids.ts";

/** A caller this deployment admits: the verified subject, what to call them, and whether they may act as an operator. */
export interface RegistryUser {
  readonly subject: string;
  readonly display: string;
  readonly admin: boolean;
}

/** A subject's stored grant: the reference the spawn resolves material through, and the git identity the wrap-up authors with. */
export interface UserCredentials {
  readonly apiKeyRef: string;
  readonly gitName: string;
  readonly gitEmail: string;
}

/** What an author writes onto a ticket and the machine never reads. */
export interface TicketAnnex {
  readonly title: string;
  readonly brief: string;
  readonly taskType: string;
  readonly author: string;
}

/**
 * The registry: the allowlist, and the annex keyed by the dense ticket id. The
 * whole annex is read at once because the fleet is bounded by `nTickets` and
 * the board renders all of it.
 */
export interface Registry {
  /** The row a verified subject has, or nothing — and nothing is the refusal. */
  userBySubject(subject: string): Promise<RegistryUser | undefined>;

  /** Writes the row for a subject, replacing whatever it held. */
  upsertUser(subject: string, display: string, admin: boolean): Promise<void>;

  /** Writes the subject's grant, replacing whatever it held; the desk stores references, never material. */
  upsertCredentials(
    subject: string,
    credentials: UserCredentials,
  ): Promise<void>;

  /** The grant of the ticket's annexed author, or nothing — and nothing is what a configured spawn fails closed on. */
  credentialsFor(ticket: TicketId): Promise<UserCredentials | undefined>;

  /** The annex row for an arrival, written beside the journaled decision rather than inside it. */
  writeAnnex(ticket: TicketId, annex: TicketAnnex): Promise<void>;

  /** Every annex row this store holds, keyed by the ticket it annotates. */
  annexes(): Promise<ReadonlyMap<TicketId, TicketAnnex>>;
}

/** One desk emission as the desk stored it, under the identity two deliveries of it share. */
export interface DeskEvent {
  readonly key: string;
  readonly effect: Effect;
  readonly ticket: TicketId;
}

/** The desk's log read back: what the machine told the desk about one ticket, in the order it was first told. */
export interface DeskLog {
  eventsFor(ticket: TicketId): Promise<readonly DeskEvent[]>;
}
