/**
 * The one record a tab keeps of each ticket's submission the API has not yet
 * answered for, and the whole of when that record goes away. The ticket page
 * and the inbox both press through `ticketAttemptPressed`, so one intent is one
 * identity wherever it was pressed. What each action does to the records is
 * `core/ticketActions.ts`'s.
 *
 * THE MUTATION CACHE DOES NOT KEEP THIS. A write that settled is never run
 * again and is collected once no screen observes it, so what a follow left
 * unanswered would be forgotten, and the next press would draw a second
 * identity for one intent.
 *
 * WHAT ENDS A RECORD IS THE API ANSWERING, AND NOTHING ELSE DOES: an operation
 * settled, or a submission the API declined to make. A browser that lost the
 * answer has learnt nothing about what the machine did, so a record that
 * stands is resolved by asking again, on a mount or a press, and is held for
 * as long as the tab lives where the API never answers. A tab holds at most
 * one per ticket.
 */

import { createSlice } from "@reduxjs/toolkit";
import type {
  PayloadAction,
  ThunkAction,
  UnknownAction,
} from "@reduxjs/toolkit";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  operationFollowing,
  operationIdBytesCount,
  operationSubmitting,
} from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import {
  ticketAttemptOf,
  ticketAttemptWith,
  ticketAttemptWithout,
} from "../core/ticketActions.ts";
import type {
  TicketAction,
  TicketAttempt,
  TicketAttempts,
} from "../core/ticketActions.ts";
import { drawBytes } from "./ports.ts";

/** Which ticket of which project a record is about. */
interface TicketAttemptAt {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}

const ticketAttemptsEmpty: TicketAttempts = {};

export const ticketAttempts = createSlice({
  name: "ticketAttempts",
  initialState: ticketAttemptsEmpty,
  reducers: {
    ticketAttemptHeldAt: (
      attempts,
      action: PayloadAction<
        TicketAttemptAt & { readonly attempt: TicketAttempt }
      >,
    ) =>
      ticketAttemptWith(
        attempts,
        action.payload.partition,
        action.payload.ticket,
        action.payload.attempt,
      ),
    ticketAttemptDroppedAt: (
      attempts,
      action: PayloadAction<TicketAttemptAt>,
    ) =>
      ticketAttemptWithout(
        attempts,
        action.payload.partition,
        action.payload.ticket,
      ),
  },
  selectors: {
    ticketAttemptAt: (attempts, partition: PartitionIdentity, ticket: number) =>
      ticketAttemptOf(attempts, partition, ticket),
  },
});

export const { ticketAttemptHeldAt, ticketAttemptDroppedAt } =
  ticketAttempts.actions;

export const { ticketAttemptAt } = ticketAttempts.selectors;

/** What a press follows, and the step its follow starts from. */
export interface TicketAttemptPress {
  readonly held: TicketAttempt;
  readonly startedFrom: OperationStep;
}

/**
 * ONE INTENT IS ONE IDENTITY: a press draws one only where nothing is held, and
 * otherwise polls what is held, even where the press names another action,
 * because what stands is a submission the machine may be working on. A drawn
 * identity is held before the submission is made, because an acceptance no
 * screen saw is still an acceptance.
 */
export function ticketAttemptPressed(
  partition: PartitionIdentity,
  ticket: number,
  action: TicketAction,
): ThunkAction<
  TicketAttemptPress,
  { readonly ticketAttempts: TicketAttempts },
  unknown,
  UnknownAction
> {
  return (dispatch, getState) => {
    const standing = ticketAttemptAt(getState(), partition, ticket);
    if (standing !== undefined)
      return {
        held: standing,
        startedFrom: operationFollowing(standing.operation),
      };
    const held = {
      action,
      operation: base64urlFromBytes(drawBytes(operationIdBytesCount)),
    };
    dispatch(ticketAttemptHeldAt({ partition, ticket, attempt: held }));
    return { held, startedFrom: operationSubmitting() };
  };
}
