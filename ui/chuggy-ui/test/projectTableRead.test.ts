/**
 * The line of the screen that is not drawing: what the ticket read takes its
 * page count from.
 *
 * It is one expression in a component, and replacing it silently undoes a fix
 * the rows depend on, so it is driven here against a real query cache and a
 * recording transport rather than a renderer.
 */

import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";

import { ticketRowsRead } from "../app/browser/ProjectTable.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import {
  ticketFilterList,
  ticketListAskDefault,
} from "../app/core/projectTableFilters.ts";
import { projectTicketRowsEmpty } from "../app/core/projectTicketPages.ts";
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
  await ticketRowsRead(client, held.ports, partition, ticketListAskDefault);
  expect(held.urls.length).toBe(3);
});

test("a first read of an entry nothing has written asks for one page", async () => {
  const held = recording();
  await ticketRowsRead(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    held.ports,
    partition,
    ticketListAskDefault,
  );
  expect(held.urls.length).toBe(1);
});
