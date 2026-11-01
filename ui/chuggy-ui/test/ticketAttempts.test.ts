/**
 * The record a tab keeps of each ticket's unanswered submission: one per
 * ticket, ended only by being dropped, and reached by a press wherever one
 * stands.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { consoleStore } from "../app/browser/store.ts";
import {
  ticketAttemptAt,
  ticketAttemptDroppedAt,
  ticketAttemptHeldAt,
  ticketAttemptPressed,
} from "../app/browser/ticketAttempts.ts";
import {
  operationFollowing,
  operationSubmitting,
} from "../app/core/operationFollow.ts";
import type { TicketAttempt } from "../app/core/ticketActions.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const borealis: PartitionIdentity = { tenant: "acme", project: "borealis" };

function resuming(ticket: number, operation: string): TicketAttempt {
  return {
    action: {
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket },
    },
    operation,
  };
}

test("what ends a held record is the console dropping it, and only that ticket's", () => {
  const store = consoleStore();
  const attempt = (partition: PartitionIdentity, ticket: number) =>
    ticketAttemptAt(store.getState(), partition, ticket);
  store.dispatch(
    ticketAttemptHeldAt({
      partition: atlas,
      ticket: 11,
      attempt: resuming(11, "op-one"),
    }),
  );
  store.dispatch(
    ticketAttemptHeldAt({
      partition: atlas,
      ticket: 12,
      attempt: resuming(12, "op-two"),
    }),
  );
  store.dispatch(
    ticketAttemptHeldAt({
      partition: borealis,
      ticket: 11,
      attempt: resuming(11, "op-three"),
    }),
  );
  store.dispatch(ticketAttemptDroppedAt({ partition: atlas, ticket: 11 }));
  expect(attempt(atlas, 11)).toBeUndefined();
  expect(attempt(atlas, 12)).toEqual(resuming(12, "op-two"));
  expect(attempt(borealis, 11)).toEqual(resuming(11, "op-three"));
});

test("a press where nothing stands draws an identity and holds it before it is sent", () => {
  const store = consoleStore();
  const action = resuming(11, "unused").action;
  const pressed = store.dispatch(ticketAttemptPressed(atlas, 11, action));
  expect(pressed.startedFrom).toEqual(operationSubmitting());
  expect(pressed.held.action).toEqual(action);
  expect(ticketAttemptAt(store.getState(), atlas, 11)).toEqual(pressed.held);
});

test("a press where a record stands follows it, even where it names another action", () => {
  const store = consoleStore();
  store.dispatch(
    ticketAttemptHeldAt({
      partition: atlas,
      ticket: 11,
      attempt: resuming(11, "op-one"),
    }),
  );
  const pressed = store.dispatch(
    ticketAttemptPressed(atlas, 11, {
      action: "Revoke",
      mutation: { mutation: "RevokeTicket", ticket: 11 },
    }),
  );
  expect(pressed).toEqual({
    held: resuming(11, "op-one"),
    startedFrom: operationFollowing("op-one"),
  });
  expect(ticketAttemptAt(store.getState(), atlas, 11)).toEqual(
    resuming(11, "op-one"),
  );
});
