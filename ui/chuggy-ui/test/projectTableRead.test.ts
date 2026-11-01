/**
 * The line of the screen that is not drawing: what the ticket read takes its
 * page count from.
 *
 * It is the query's own read handed the entry by the bridge, and replacing
 * either half silently undoes a fix the rows depend on, so it is driven here
 * against a real query cache and a recording transport rather than a renderer.
 */

import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";

import { panelQueryOptions } from "../app/browser/api.ts";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  ticketFilterList,
  ticketListAskDefault,
} from "../app/core/projectTableFilters.ts";
import { projectTicketRowsEmpty } from "../app/core/projectTicketPages.ts";
import { ticketRowsQuery } from "../app/core/ticketQueries.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };

function recording(): { readonly ports: ApiPorts; readonly urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    ports: {
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(
              JSON.stringify({
                partition,
                sequence: 1,
                tickets: [
                  {
                    ticket: urls.length,
                    phase: "Pending",
                    sequence: 1,
                    ...ticketInstants,
                  },
                ],
                nextCursor: `after-${String(urls.length)}`,
              }),
            ),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

test("the ticket read takes its page count from the entry it is replacing", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(ticketFilterList(partition, ticketListAskDefault).key, {
    ...projectTicketRowsEmpty,
    pagesRead: 3,
    next: { read: 0, cursor: "after-0" },
  });
  const held = recording();
  await client.fetchQuery(
    panelQueryOptions(
      held.ports,
      false,
      ticketRowsQuery(partition, ticketListAskDefault),
    ),
  );
  expect(held.urls.length).toBe(3);
});

test("a first read of an entry nothing has written asks for one page", async () => {
  const held = recording();
  await new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }).fetchQuery(
    panelQueryOptions(
      held.ports,
      false,
      ticketRowsQuery(partition, ticketListAskDefault),
    ),
  );
  expect(held.urls.length).toBe(1);
});
