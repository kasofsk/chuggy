/**
 * What an escalated ticket's card offers of its overrides: the fields the
 * contract says a parked ticket may change, seeded from what the ticket holds,
 * and the change that makes it hold what was typed.
 *
 * THE CHANGE CARRIES THE WHOLE OF WHAT THE TICKET IS TO HOLD. A field the card
 * does not draw is sent as the ticket holds it, because the change replaces
 * every override, and one left out would move what the ticket was released to
 * run.
 *
 * WHAT IS TYPED BELONGS TO ONE ESCALATION. It is held beside the action it was
 * typed against, so a ticket parked again later starts from what it holds
 * rather than from what was typed for the wall before.
 */

import {
  configurationOverridesSchema,
  parkedTicketOverrideFields,
} from "../../../../src/contract/configurationOverrides.ts";
import type { ConfigurationOverrides } from "../../../../src/contract/configurationOverrides.ts";
import type { PublicMutation } from "../../../../src/contract/requests.ts";
import type {
  NativeActionResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";

import { overridesHeldOf, overridesNestedOf } from "./ticketOverrides.ts";
import type { CreationOverrides, OverrideField } from "./ticketOverrides.ts";

/** The fields a parked ticket's card draws, in the contract's order. */
export const parkedOverrideFields: readonly OverrideField[] =
  parkedTicketOverrideFields;

function parkedOverrideFieldDrawn(field: string): boolean {
  return parkedOverrideFields.some((drawn) => drawn === field);
}

/**
 * The escalation a card's overrides are fenced to: the open one a resume
 * answers, where that resume starts a worker again. A ticket parked because
 * its finalization reached no result resumes into finalizing, which starts
 * none, so it is offered no overrides.
 */
export function parkedOverridesFence(
  ticket: TicketResponse,
  open: readonly NativeActionResponse[] | undefined,
): NativeActionResponse | undefined {
  if (ticket.phase !== "Escalated" || ticket.escalation === undefined)
    return undefined;
  if (ticket.escalation.kind === "FinalizationUnavailableEscalated")
    return undefined;
  return open?.find(
    (action) =>
      action.kind === "TicketEscalation" && action.admits.includes("Resume"),
  );
}

/** What the ticket holds of the fields its card draws. */
export function parkedOverridesHeld(
  overrides: ConfigurationOverrides | undefined,
): CreationOverrides {
  return Object.fromEntries(
    Object.entries(overridesHeldOf(overrides)).filter(([field]) =>
      parkedOverrideFieldDrawn(field),
    ),
  );
}

/** What was typed on one escalation's card. */
export interface ParkedOverridesTyped {
  readonly action: string;
  readonly overrides: CreationOverrides;
}

/** What the card draws for this escalation: what was typed for it, or else what the ticket holds. */
export function parkedOverridesShown(
  typed: ParkedOverridesTyped | undefined,
  fence: NativeActionResponse,
  overrides: ConfigurationOverrides | undefined,
): CreationOverrides {
  return typed?.action === fence.action
    ? typed.overrides
    : parkedOverridesHeld(overrides);
}

function parkedOverridesSame(
  left: CreationOverrides,
  right: CreationOverrides,
): boolean {
  return parkedOverrideFields.every(
    (field) => JSON.stringify(left[field]) === JSON.stringify(right[field]),
  );
}

/** Whether what was typed for this escalation is not what the ticket holds. */
export function parkedOverridesUnsaved(
  typed: ParkedOverridesTyped | undefined,
  fence: NativeActionResponse | undefined,
  overrides: ConfigurationOverrides | undefined,
): boolean {
  return (
    fence !== undefined &&
    typed?.action === fence.action &&
    !parkedOverridesSame(typed.overrides, parkedOverridesHeld(overrides))
  );
}

/** The change one card sends, or why what it holds is not one a ticket may hold. */
export type ParkedOverridesChange =
  | { readonly change: "Mutation"; readonly mutation: PublicMutation }
  | { readonly change: "Invalid" };

/**
 * The change that makes the ticket hold what was typed: the typed fields in
 * place of the ones the card draws, and every other field as the ticket holds
 * it, judged by the contract's own schema.
 */
export function parkedOverridesChange(
  ticket: TicketResponse,
  fence: NativeActionResponse,
  shown: CreationOverrides,
): ParkedOverridesChange {
  const kept = Object.fromEntries(
    Object.entries(overridesHeldOf(ticket.overrides)).filter(
      ([field]) => !parkedOverrideFieldDrawn(field),
    ),
  );
  const parsed = configurationOverridesSchema.safeParse(
    overridesNestedOf({ ...kept, ...shown }) ?? {},
  );
  if (!parsed.success) return { change: "Invalid" };
  return {
    change: "Mutation",
    mutation: {
      mutation: "ChangeTicketOverrides",
      ticket: ticket.ticket,
      action: fence.action,
      authorizingSequence: fence.authorizingSequence,
      overrides: parsed.data,
    },
  };
}
