/**
 * What a parked ticket's card offers of its overrides: the fields the contract
 * lets a parked ticket change, seeded from what the ticket holds, and the
 * change they become.
 *
 * THE TICKET AND NOT ITS DRAFT SAYS WHAT A PARKED TICKET RUNS UNDER. A change
 * replaces what the ticket holds and leaves the draft as it was released, so
 * the card seeds from the ticket's own read.
 *
 * A CHANGE SENDS THE WHOLE OF WHAT THE TICKET IS TO HOLD. The fields the card
 * does not draw are sent as the ticket holds them, so a change of the model
 * keeps work instructions the ticket was released overriding.
 *
 * ONLY A RESUME THAT STARTS A WORKER IS OFFERED ONE. A ticket parked because
 * its finalization was unavailable resumes into finalization, which runs no
 * worker an override could change.
 */

import {
  configurationOverridesSchema,
  parkedOverrideFields,
} from "../../../../src/contract/configurationOverrides.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";

import type { TicketAction } from "./ticketActions.ts";
import {
  overrideFields,
  overridesHeldOf,
  overridesNestedOf,
} from "./ticketOverrides.ts";
import type { CreationOverrides, OverrideField } from "./ticketOverrides.ts";

/** The fields a parked ticket's card draws, in the order the form draws them. */
export const parkedOverrideFieldsDrawn: readonly OverrideField[] =
  overrideFields.filter((field) =>
    parkedOverrideFields.some((parked) => parked === field),
  );

function parkedOverridesDrawn(field: string): boolean {
  return parkedOverrideFieldsDrawn.some((drawn) => drawn === field);
}

/** The open escalation a change is fenced to, which is the one its Resume answers. */
export interface ParkedOverridesFence {
  readonly action: string;
  readonly authorizingSequence: number;
}

/**
 * The fence a parked ticket's card changes its overrides at, or none where it
 * offers no change: a ticket not parked, one whose resume starts no worker, or
 * one whose Resume is not among the answers the card draws.
 */
export function parkedOverridesFence(
  ticket: TicketResponse,
  answered: readonly TicketAction[],
): ParkedOverridesFence | undefined {
  if (ticket.phase !== "Escalated") return undefined;
  if (
    ticket.escalation === undefined ||
    ticket.escalation.kind === "FinalizationUnavailableEscalated"
  )
    return undefined;
  for (const answer of answered) {
    const mutation = answer.mutation;
    if (
      answer.action === "Resume" &&
      mutation.mutation === "ResolveNativeAction"
    )
      return {
        action: mutation.action,
        authorizingSequence: mutation.authorizingSequence,
      };
  }
  return undefined;
}

/** What the ticket holds of the fields the card draws, as a form holds them. */
export function parkedOverridesSeed(ticket: TicketResponse): CreationOverrides {
  return Object.fromEntries(
    Object.entries(overridesHeldOf(ticket.overrides)).filter(([field]) =>
      parkedOverridesDrawn(field),
    ),
  );
}

/** Whether what the card holds differs from what the ticket holds. */
export function parkedOverridesUnsaved(
  ticket: TicketResponse,
  held: CreationOverrides,
): boolean {
  const seed = parkedOverridesSeed(ticket);
  return parkedOverrideFieldsDrawn.some(
    (field) => JSON.stringify(held[field]) !== JSON.stringify(seed[field]),
  );
}

/** The whole of what the ticket is to hold: what the card holds, and the ticket's own for every field it does not draw. */
export function parkedOverridesSent(
  ticket: TicketResponse,
  held: CreationOverrides,
): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(overridesHeldOf(ticket.overrides)).filter(
      ([field]) => !parkedOverridesDrawn(field),
    ),
  );
  const drawn = Object.fromEntries(
    Object.entries(held).filter(([field]) => parkedOverridesDrawn(field)),
  );
  return overridesNestedOf({ ...kept, ...drawn }) ?? {};
}

export type ParkedOverridesMutation = Extract<
  PublicMutation,
  { readonly mutation: "ChangeTicketOverrides" }
>;

/** The mutation one save submits, or none where what is held is not overrides the contract reads. */
export function parkedOverridesMutation(
  ticket: TicketResponse,
  fence: ParkedOverridesFence,
  held: CreationOverrides,
): ParkedOverridesMutation | undefined {
  const overrides = configurationOverridesSchema.safeParse(
    parkedOverridesSent(ticket, held),
  );
  if (!overrides.success) return undefined;
  return {
    mutation: "ChangeTicketOverrides",
    ticket: ticket.ticket,
    action: fence.action,
    authorizingSequence: fence.authorizingSequence,
    overrides: overrides.data,
  };
}

/** Why Resume waits while the card holds a change nobody saved. */
export const parkedOverridesResumeWithheld =
  "Save or discard the overrides first";
