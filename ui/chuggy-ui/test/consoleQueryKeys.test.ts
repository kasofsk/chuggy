/**
 * A console query's key carries the type of what is held under it, and the
 * cache's own reads and writes take their type from it: a key read or written
 * at another type does not compile. The typecheck over this file is what
 * asserts it, each `@ts-expect-error` failing that check the moment the line
 * under it compiles; the cases run the same lines so each stays a call the
 * cache accepts at run time.
 */

import { QueryClient } from "@tanstack/react-query";
import { expect, expectTypeOf, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import { consoleListQuery } from "../app/core/consoleQuery.ts";
import type { InboxPages } from "../app/core/inboxList.ts";
import { projectAbilitiesQuery } from "../app/core/projectQueries.ts";
import { inboxQuery, ticketQuery } from "../app/core/ticketQueries.ts";

const atlas = { tenant: "acme", project: "atlas" };

test("a resource's key is read and written at its own type and no other", () => {
  const client = new QueryClient();
  const key = ticketQuery(atlas, 3).queryKey;
  const held = client.getQueryData(key);
  expectTypeOf(held).toEqualTypeOf<TicketResponse | undefined>();
  // @ts-expect-error what a ticket's key holds taken as something that is not a ticket
  const misread: string | undefined = held;
  // @ts-expect-error a ticket's key written with something that is not a ticket
  client.setQueryData(key, "not a ticket");
  expect(misread).toBeUndefined();
  expect(client.getQueryData(key)).toBe("not a ticket");
});

test("a list's key is read and written at its entry's type and no other", () => {
  const client = new QueryClient();
  const key = inboxQuery(atlas).queryKey;
  expectTypeOf(client.getQueryData(key)).toEqualTypeOf<
    InboxPages | undefined
  >();
  // @ts-expect-error the inbox's entry written with something that is not its pages
  client.setQueryData(key, 3);
  expect(client.getQueryData(key)).toBe(3);
});

test("a list read is made only from a list carrying its refresh", () => {
  const list = inboxQuery(atlas).list;
  const read = () => Promise.resolve({ outcome: "Absent" as const });
  expect(consoleListQuery(list, read).queryKey).toBe(list.key);
  expect(() =>
    consoleListQuery(
      // @ts-expect-error a list assembled with no refresh is not a list
      { kind: "Ticket", key: list.key, alongside: {} },
      read,
    ),
  ).not.toThrow();
});

test("a read no frame names cannot be asked to be kept", () => {
  // @ts-expect-error the abilities take no keeping, since no frame names them
  const asked = projectAbilitiesQuery(atlas, "Streamed");
  expect(asked.kept).toBe("Read");
});
