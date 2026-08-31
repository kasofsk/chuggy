/**
 * How long the record of an attempt lasts, which is the one thing about it the
 * cache must not decide.
 *
 * The entry has no reader, and an entry with no reader is collected on a timer
 * armed once when it is built — so a record left on the cache's default would
 * go part-way through a follow that is still running, and the panel remounting
 * after that would submit again. These cases read the built query rather than
 * the constant beside it, because a default registered against the wrong key is
 * a default that reads exactly like one that works.
 */

import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  ticketAttemptDropped,
  ticketAttemptHeld,
  ticketAttemptRead,
} from "../app/browser/ticketAttemptHeld.ts";
import { ticketAttemptKey } from "../app/core/ticketActions.ts";
import type { TicketAttempt } from "../app/core/ticketActions.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

function resuming(ticket: number, operation: string): TicketAttempt {
  return {
    action: {
      action: "Resume",
      mutation: { mutation: "ResumeTicket", ticket },
    },
    operation,
  };
}

function gcTimeOf(client: QueryClient, ticket: number): number | undefined {
  return client
    .getQueryCache()
    .find({ queryKey: ticketAttemptKey(atlas, ticket) })?.gcTime;
}

test("a held record is built with no expiry of the cache's own", () => {
  const client = new QueryClient();
  ticketAttemptHeld(client, atlas, 11, resuming(11, "op-one"));
  expect(gcTimeOf(client, 11)).toBe(Number.POSITIVE_INFINITY);
  expect(ticketAttemptRead(client, atlas, 11)).toEqual(resuming(11, "op-one"));
});

/** One registration covers the partition's held scope, so a reader who submits
 * on many tickets leaves one behind and not one per ticket. */
test("the one registration answers for a ticket nothing has been held for", () => {
  const client = new QueryClient();
  ticketAttemptHeld(client, atlas, 11, resuming(11, "op-one"));
  expect(client.getQueryDefaults(ticketAttemptKey(atlas, 12)).gcTime).toBe(
    Number.POSITIVE_INFINITY,
  );
  ticketAttemptHeld(client, atlas, 12, resuming(12, "op-two"));
  expect(gcTimeOf(client, 12)).toBe(Number.POSITIVE_INFINITY);
});

test("what ends a held record is the console dropping it", () => {
  const client = new QueryClient();
  ticketAttemptHeld(client, atlas, 11, resuming(11, "op-one"));
  ticketAttemptHeld(client, atlas, 12, resuming(12, "op-two"));
  ticketAttemptDropped(client, atlas, 11);
  expect(ticketAttemptRead(client, atlas, 11)).toBeUndefined();
  expect(ticketAttemptRead(client, atlas, 12)).toEqual(resuming(12, "op-two"));
});
