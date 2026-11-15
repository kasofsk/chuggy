/**
 * A member takes a released ticket, which makes them its owner, and its taker
 * returns it to its creator.
 *
 * WORK MOVES ONTO A MEMBER'S RUNNER AND ACCOUNT ONLY BY THAT MEMBER'S OWN ACT.
 * A take names no member: the store records the caller's own authority, so no
 * door here makes anyone but the caller an owner. The site's selector is the
 * lead's identity, a developer on every project with a lead and authorized as
 * a member, so its kind cannot refuse it; it is refused by name before its
 * permit is asked. A session bearer never reaches this door: its routes are
 * refused to every session.
 *
 * THE PERMIT IS `Mutate`, the one filing a draft asks, since filing is what
 * makes a member an owner and a take is that same ownership of work already
 * filed. A caller who may read and not mutate is told so, apart from one who
 * cannot read the project, as an epic's write tells them.
 */

import type {
  TicketTakeOutcomeKind,
  TicketTakeRefusalCode,
} from "../contract/rosters.ts";
import type { TicketId } from "../domain/ids.ts";
import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** Which of the two acts: taking a ticket, or returning it to its creator. */
export type TicketTakeKind = "Take" | "Return";

/** Why the store wrote nothing, beside a ticket it does not hold: every refusal but the agent's, which is decided here. */
export const ticketTakeStoreRefusals = [
  "Unreleased",
  "TicketDone",
  "TicketRevoked",
  "NotTaker",
] as const satisfies readonly TicketTakeRefusalCode[];
export type TicketTakeStoreRefusal = (typeof ticketTakeStoreRefusals)[number];

/** What the store's door answered. */
export type TicketTakeStored =
  | { readonly stored: "MissingTicket" }
  | { readonly stored: "Refused"; readonly reason: TicketTakeStoreRefusal }
  | {
      readonly stored: TicketTakeOutcomeKind;
      /** The member the ticket's next execution is placed for now, absent where none is. */
      readonly owner?: string;
    };

/** The door a take or a return is written through, under the caller's own authority. */
export interface TicketTakeStore {
  write(
    partition: Partition,
    ticket: TicketId,
    kind: TicketTakeKind,
    authority: Authority,
  ): Promise<TicketTakeStored>;
}

/** What a take or a return answers: not found, forbidden the permit, refused, or done. */
export type TicketTakeWritten =
  | { readonly result: "NotFound" }
  | { readonly result: "Forbidden" }
  | { readonly result: "Refused"; readonly reason: TicketTakeRefusalCode }
  | {
      readonly result: "Written";
      readonly outcome: TicketTakeOutcomeKind;
      readonly owner?: string;
    };

/** A project's takes and returns, as the API serves them. */
export interface TicketTakes {
  write(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
    kind: TicketTakeKind,
  ): Promise<TicketTakeWritten>;
}

/** The principals that are agents rather than people, which is the site's selector where the deployment names one. */
export interface TicketTakeAgents {
  readonly selector?: Principal;
}

async function ticketTakesWrite(
  access: ProjectAccess,
  store: TicketTakeStore,
  agents: TicketTakeAgents,
  request: {
    readonly principal: Principal;
    readonly partition: Partition;
    readonly ticket: TicketId;
    readonly kind: TicketTakeKind;
  },
): Promise<TicketTakeWritten> {
  const { principal, partition, ticket, kind } = request;
  if ((await access.authorize(principal, partition, "Read")) === undefined)
    return { result: "NotFound" };
  if (principal === agents.selector)
    return { result: "Refused", reason: "TakerNotAPerson" };
  const authority = await access.authorize(principal, partition, "Mutate");
  if (authority === undefined) return { result: "Forbidden" };
  const stored = await store.write(partition, ticket, kind, authority);
  switch (stored.stored) {
    case "MissingTicket":
      return { result: "NotFound" };
    case "Refused":
      return { result: "Refused", reason: stored.reason };
    case "Taken":
    case "Returned":
    case "AlreadyOwner":
      return {
        result: "Written",
        outcome: stored.stored,
        ...(stored.owner === undefined ? {} : { owner: stored.owner }),
      };
  }
}

export function ticketTakes(
  access: ProjectAccess,
  store: TicketTakeStore,
  agents: TicketTakeAgents,
): TicketTakes {
  return {
    write: (principal, partition, ticket, kind) =>
      ticketTakesWrite(access, store, agents, {
        principal,
        partition,
        ticket,
        kind,
      }),
  };
}
