/**
 * The two lines of the screen that are not drawing: what the ticket read takes
 * its page count from, and what a walk's second page asks for.
 *
 * Both are one expression in a component, and replacing either silently undoes
 * a fix the rows depend on, so each is driven here — the first against a real
 * query cache and a recording transport, and neither against a renderer.
 */

import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import { ticketRowsRead } from "../app/browser/ProjectTable.tsx";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { projectExecutionPage } from "../app/core/projectExecutionIndex.ts";
import {
  ticketFilterAll,
  ticketFilterKey,
} from "../app/core/projectTableFilters.ts";
import { projectTicketRowsEmpty } from "../app/core/projectTicketPages.ts";

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
                  { ticket: urls.length, phase: "Pending", sequence: 1 },
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
  const client = new QueryClient();
  client.setQueryData(ticketFilterKey(partition, ticketFilterAll), {
    ...projectTicketRowsEmpty,
    pagesRead: 3,
    nextCursor: "after-0",
  });
  const held = recording();
  await ticketRowsRead(client, held.ports, partition, ticketFilterAll);
  expect(held.urls.length).toBe(3);
});

test("a first read of an entry nothing has written asks for one page", async () => {
  const held = recording();
  await ticketRowsRead(
    new QueryClient(),
    held.ports,
    partition,
    ticketFilterAll,
  );
  expect(held.urls.length).toBe(1);
});

test("a walk's first page carries no cursor and its next carries the one it was given", () => {
  expect(projectExecutionPage("All", undefined).after).toBeUndefined();
  expect(projectExecutionPage("All", "opaque").after).toBe("opaque");
});

test("a walk states the size it wants and names only the selection it filters", () => {
  expect(projectExecutionPage("All", undefined).limit).toBe(
    nativeHttpPageItemsMax,
  );
  expect(projectExecutionPage("All", undefined).state).toBeUndefined();
  expect(projectExecutionPage("NonTerminal", undefined).state).toBe(
    "NonTerminal",
  );
});
